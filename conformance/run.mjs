/**
 * Spec-conformance suite: the clients in this repo, driven by the spec's own
 * host and client implementations in a real browser.
 *
 * Why it exists, and why it is not a vitest file: every bridge in this repo is
 * hand-written, and a hand-written parser agrees with its own author's mistakes.
 * `happy-dom` cannot help either — the deviations this catches are about frame
 * *ordering* across a real `postMessage` boundary between two documents. So the
 * host is `@modelcontextprotocol/ext-apps`'s `AppBridge`, the browser is
 * Chromium, and the only thing under test is our wire behaviour.
 *
 * Three scenarios:
 *
 *  1. `connect()` (source) as an app, under the spec's `AppBridge`.
 *  2. The vendored `connectUI` IIFE as an app, under the same host.
 *  3. The spec's own `App` as an app, against the Synapse dev preview host —
 *     the one direction the other two cannot cover, because the thing in
 *     question is our host, not our client.
 *
 * Run it with `npm run conformance`. It prints one row per behaviour and exits
 * non-zero if any fails.
 */

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

import * as esbuild from "esbuild";
import { chromium } from "playwright";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const OUT = join(HERE, ".out");

/** The artifact the Python package ships and a `ui://` component inlines. */
const VENDORED_IIFE = join(REPO, "python/nimblebrain_synapse/_assets/synapse-ui.iife.js");

const PAGES = ["host", "app-connect", "app-connectui", "app-official"];

const page = (title, scripts) =>
  `<!DOCTYPE html>
<html>
  <head><meta charset="utf-8" /><title>${title}</title></head>
  <body style="margin:0">
${scripts.map((s) => `    <script type="module" src="${s}"></script>`).join("\n")}
  </body>
</html>
`;

// The connectUI page loads the vendored bundle as a classic script first, so
// `window.SynapseUI` exists before the module runs — exactly the order a
// self-contained component uses.
const connectUiPage = `<!DOCTYPE html>
<html>
  <head><meta charset="utf-8" /><title>app-connectui</title></head>
  <body style="margin:0">
    <script src="synapse-ui.iife.js"></script>
    <script type="module" src="app-connectui.js"></script>
  </body>
</html>
`;

async function build() {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  await esbuild.build({
    entryPoints: PAGES.map((p) => join(HERE, "pages", `${p}.ts`)),
    outdir: OUT,
    bundle: true,
    format: "esm",
    target: "es2022",
    platform: "browser",
    sourcemap: "inline",
    logLevel: "warning",
  });

  await writeFile(join(OUT, "host.html"), page("host", ["host.js"]));
  await writeFile(join(OUT, "app-connect.html"), page("app-connect", ["app-connect.js"]));
  await writeFile(join(OUT, "app-official.html"), page("app-official", ["app-official.js"]));
  await writeFile(join(OUT, "app-connectui.html"), connectUiPage);

  let vendored;
  try {
    vendored = await readFile(VENDORED_IIFE);
  } catch {
    throw new Error(
      `vendored client not found at ${VENDORED_IIFE} — it is a committed file, refreshed by hand from dist/synapse-ui.iife.global.js`,
    );
  }
  await writeFile(join(OUT, "synapse-ui.iife.js"), vendored);
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

/**
 * Serve `dir`, plus any extra routes, on an ephemeral port. A route is an HTML
 * string, or a `(req, res) => void` handler for anything that is not a page.
 */
async function serve(dir, routes = {}) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const route = routes[url.pathname];
    if (typeof route === "function") {
      route(req, res);
      return;
    }
    if (route) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(route);
      return;
    }
    const name = url.pathname === "/" ? "/index.html" : url.pathname;
    try {
      const body = await readFile(join(dir, name));
      res.writeHead(200, { "content-type": MIME[extname(name)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    port,
    close: () =>
      new Promise((resolve) => {
        server.close(resolve);
        // An open event stream never ends on its own, and `close` waits for it.
        server.closeAllConnections();
      }),
  };
}

/**
 * The dev server's `GET /__events`: an event stream the `/__preview` page holds
 * open for the server's notifications. Served open and silent, because no MCP
 * server runs here — without it the page's `EventSource` 404s.
 */
function openEventStream(_req, res) {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  res.write(": open\n\n");
}

/**
 * Load `url`, wait for a finished report to appear at `window[readyKey]`, and
 * return it.
 *
 * `inFrame` reads from the child frame instead of the top document. Scenario 3
 * needs it: there the app is the thing reporting, and it is framed by our
 * preview page across an origin boundary, so the parent cannot reach into it.
 */
async function drive(browser, url, readyKey, { inFrame = false } = {}) {
  const ctx = await browser.newContext();
  const tab = await ctx.newPage();
  const consoleErrors = [];
  tab.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  tab.on("pageerror", (e) => consoleErrors.push(String(e)));
  await tab.goto(url);

  const ready = (key) => Boolean(window[key] && (window[key].done || window[key].finished));
  let target = tab;
  if (inFrame) {
    const element = await tab.waitForSelector("iframe", { timeout: 15000 });
    target = await element.contentFrame();
    if (!target) {
      await ctx.close();
      return { report: null, consoleErrors: ["the iframe had no document"] };
    }
  }

  try {
    await target.waitForFunction(ready, readyKey, { timeout: 15000 });
  } catch {
    // Fall through: report whatever the page managed to publish, which says far
    // more than a bare timeout does.
  }
  const report = await target.evaluate((key) => window[key] ?? null, readyKey).catch(() => null);
  await ctx.close();
  return { report, consoleErrors };
}

// --- Assertions -------------------------------------------------------------

const rows = [];
let failures = 0;

function check(scenario, name, why, predicate) {
  let ok = false;
  let detail = "";
  try {
    const outcome = predicate();
    ok = outcome === true;
    if (!ok && typeof outcome === "string") detail = outcome;
  } catch (e) {
    detail = String(e);
  }
  if (!ok) failures += 1;
  rows.push({ scenario, name, why, ok, detail });
}

const step = (results, key) => results?.[key] ?? null;
const stepOk = (results, key) => {
  const s = step(results, key);
  if (!s) return `no result recorded for "${key}"`;
  if (s.ok !== true) return `failed: ${s.error}`;
  return true;
};
const frameIndex = (wire, method) => wire.findIndex((f) => f.method === method);
const frame = (log, method) => log.find((f) => f.method === method) ?? null;

function assertSpecHostScenario(name, report, opts) {
  const wire = report?.wire ?? [];
  const handled = report?.handled ?? [];
  const app = report?.app ?? null;

  check(name, "host reachable", "the bridge connected and the app finished", () => {
    if (report?.error) return report.error;
    if (!app) return "the app published no results";
    return app.finished === true || "the app never finished its script";
  });

  // --- The deviation this suite was built to catch -------------------------
  check(
    name,
    "ui/initialize is the app's first frame",
    "a strict host drops anything sent before the handshake and leaves the frame hidden",
    () => {
      if (wire.length === 0) return "no frames captured";
      const first = wire[0].method;
      return first === "ui/initialize" || `first frame was "${first}"`;
    },
  );
  check(
    name,
    "no size-changed before initialized",
    "the spec's own client reports size only after the handshake completes",
    () => {
      const sizeIdx = frameIndex(wire, "ui/notifications/size-changed");
      if (sizeIdx === -1) return true; // never sent at all is also correct here
      const initializedIdx = frameIndex(wire, "ui/notifications/initialized");
      if (initializedIdx === -1) return "initialized was never sent";
      return sizeIdx > initializedIdx || "size-changed preceded initialized";
    },
  );

  // --- Parity: what the client relies on the bridge for --------------------
  check(name, "tools/call reaches the host", "the pull path", () => {
    const call = frame(handled, "tools/call");
    return call !== null || "the host never handled a tools/call";
  });
  check(name, "host-context change is delivered", "theme and context updates", () =>
    opts.hostContextChanged(app),
  );

  for (const [rowName, why, predicate] of opts.extra) {
    check(name, rowName, why, () => predicate(app, handled, wire));
  }
}

// --- Run --------------------------------------------------------------------

await build();

// This package ships **two** hand-written bridge hosts — the standalone
// `synapse preview` harness and the dev server's `/__preview` page — and a
// spec client has to reach both. They are TypeScript, so bundle the page
// builders and import those. Reading the real exports is the point: asserting
// against a copy of a handshake would prove nothing about what either answers.
async function loadPageBuilder(entry, name) {
  const outfile = join(OUT, `${name}.mjs`);
  await esbuild.build({
    entryPoints: [join(REPO, entry)],
    outfile,
    bundle: true,
    format: "esm",
    platform: "node",
    packages: "external",
    logLevel: "warning",
  });
  return import(outfile);
}
const { previewHostHtml } = await loadPageBuilder("src/preview/server.ts", "preview-host");
const { vitePreviewHostHtml } = await loadPageBuilder("src/vite/plugin.ts", "vite-host");

const browser = await chromium.launch();
let uiServer;
let previewServer;
try {
  // The preview page hard-codes `http://localhost:<uiPort>/` as its iframe src,
  // so the app has to answer at the root of the port the page is told about.
  // Take a port first, then render the page against it.
  const officialPage = page("app-official", ["app-official.js"]);
  // The dev-server host frames `/` on its own origin, so it is served from the
  // same place the app is.
  uiServer = await serve(OUT, {
    "/": officialPage,
    "/index.html": officialPage,
    "/vite-preview": vitePreviewHostHtml("conformance-app"),
    "/__events": openEventStream,
  });
  previewServer = await serve(OUT, {
    "/preview": previewHostHtml(uiServer.port, 1),
  });

  const base = `http://127.0.0.1:${uiServer.port}`;

  // 1. connect(), under the spec's AppBridge.
  {
    const { report, consoleErrors } = await drive(
      browser,
      `${base}/host.html?app=connect`,
      "__conformance",
    );
    assertSpecHostScenario("connect()", report, {
      hostContextChanged: (app) =>
        app?.hostContextChanged?.theme === "dark" ||
        `hostContextChanged was ${JSON.stringify(app?.hostContextChanged)}`,
      extra: [
        [
          "tool-result sent at initialized is caught",
          "options.on registers before initialized, so the race is not lost",
          (app) =>
            app?.toolResult?.answer === 42 || `toolResult was ${JSON.stringify(app?.toolResult)}`,
        ],
        [
          "tools/call names no target server",
          "an app reaches its own server and nothing else — a host scopes the call to whatever mounted the app, so there is no target to carry",
          (_app, handled) => {
            const call = handled.find((f) => f.method === "tools/call");
            if (!call) return "no tools/call handled";
            if ("server" in call.params) return "params carry a top-level `server`";
            const meta = call.params._meta ?? {};
            return !("ai.nimblebrain/server" in meta) || `_meta was ${JSON.stringify(meta)}`;
          },
        ],
        [
          "resources/read reaches the host",
          "the resource pull path",
          (app) => stepOk(app, "readServerResource"),
        ],
        [
          "resources/list_changed is delivered",
          "the signal useDataSync is built on",
          (app) => app?.resourcesListChanged === true || "the notification never arrived",
        ],
        [
          "a custom synapse/* request survives, app to host",
          "an extension method must pass through a spec host's transport",
          // Asserted on the wire, not on the call's return: `pickFile` goes on
          // to negotiate a whole upload protocol the harness does not
          // implement, and what this row claims is that the method reached a
          // spec host at all.
          (_app, handled) =>
            handled.some((f) => f.method === "synapse/request-file") ||
            "synapse/request-file never reached the host",
        ],
        [
          "a custom synapse/* notification survives, host to app",
          "the other direction, which uses a different code path",
          (app) =>
            app?.dataChanged?.source === "agent" ||
            `dataChanged was ${JSON.stringify(app?.dataChanged)}`,
        ],
        [
          "tasks/get and tasks/result work over generic request",
          "the tasks utility has no ext-apps typed surface, so it rides the generic path",
          (app) => {
            const get = stepOk(app, "tasksGet");
            if (get !== true) return `tasks/get ${get}`;
            const result = stepOk(app, "tasksResult");
            if (result !== true) return `tasks/result ${result}`;
            return (
              app.tasksGet.value?.status === "completed" ||
              `tasks/get returned ${JSON.stringify(app.tasksGet.value)}`
            );
          },
        ],
        [
          "the host's tasks capability survives the handshake",
          "a host publishes it in `hostCapabilities.experimental`, the one slot a spec client's handshake parse keeps. If `connect()` cannot read it there, `callToolAsTask` refuses to send on every host — and the row below passes without the host ever being asked",
          (app) =>
            app?.supportsTasks === true ||
            `supportsTasks was ${JSON.stringify(app?.supportsTasks)}`,
        ],
        [
          "a task-augmented tools/call is refused by a spec host",
          "pinned, not desired: the spec's AppBridge throws on `params.task`, so `callToolAsTask` is a NimbleBrain-host capability today. If this row starts failing, ext-apps has opened the door and the tasks helper can go portable.",
          (app) => {
            const s = step(app, "callToolAsTask");
            if (!s) return "no result recorded";
            return s.ok === false || "it succeeded — see why-it-matters";
          },
        ],
        ["ui/message reaches the host", "the follow-up path", (app) => stepOk(app, "sendMessage")],
        ["ui/open-link reaches the host", "the link path", (app) => stepOk(app, "openLink")],
        [
          "ui/update-model-context reaches the host",
          "the model-context path",
          (app) => stepOk(app, "updateModelContext"),
        ],
        [
          "ui/download-file carries the file as an embedded resource",
          "a host will not fetch a link an app names, so a file only reaches the user when its bytes travel in the request — text as `text`, binary as base64 `blob`",
          (app, handled) => {
            for (const key of ["downloadFile", "downloadFileBlob"]) {
              const ok = stepOk(app, key);
              if (ok !== true) return `${key} ${ok}`;
            }
            const blocks = handled
              .filter((f) => f.method === "ui/download-file")
              .flatMap((f) => f.params?.contents ?? []);
            const byUri = (uri) => blocks.find((b) => b.resource?.uri === uri);
            if (blocks.length !== 2) return `expected 2 blocks, got ${JSON.stringify(blocks)}`;
            if (blocks.some((b) => b.type !== "resource")) {
              return `a block was not an embedded resource: ${JSON.stringify(blocks)}`;
            }
            const text = byUri("file:///a.txt")?.resource;
            if (text?.text !== "abc" || text.mimeType !== "text/plain") {
              return `text block was ${JSON.stringify(text)}`;
            }
            const bin = byUri("file:///b.bin")?.resource;
            if (typeof bin?.blob !== "string") return `binary block was ${JSON.stringify(bin)}`;
            const bytes = [...Buffer.from(bin.blob, "base64")];
            return (
              JSON.stringify(bytes) === JSON.stringify([0, 1, 127, 128, 254, 255]) ||
              `binary block decoded to ${JSON.stringify(bytes)}`
            );
          },
        ],
        [
          "no uncaught console errors",
          "a spec host logs a rejected frame rather than failing the call",
          () => consoleErrors.length === 0 || consoleErrors.join(" | "),
        ],
      ],
    });
  }

  // 2. The vendored connectUI IIFE, under the same host.
  {
    const { report, consoleErrors } = await drive(
      browser,
      `${base}/host.html?app=connectui`,
      "__conformance",
    );
    assertSpecHostScenario("connectUI (vendored IIFE)", report, {
      hostContextChanged: (app) =>
        app?.themeChanged === "dark" || `themeChanged was ${JSON.stringify(app?.themeChanged)}`,
      extra: [
        [
          "detects a framed host without an override",
          "a component ships one build and must place itself",
          (app) => app?.host === "claude" || `host() returned ${JSON.stringify(app?.host)}`,
        ],
        [
          "tool-result arrives as data",
          "the push path the client is built around",
          (app) => app?.data?.answer === 42 || `data was ${JSON.stringify(app?.data)}`,
        ],
        ["callTool resolves", "the pull path", (app) => stepOk(app, "callTool")],
        ["ui/open-link reaches the host", "the link path", (app) => stepOk(app, "openLink")],
        [
          "ui/message reaches the host",
          "sendPrompt, which rides ui/message on a standard host",
          (_app, handled) =>
            handled.some((f) => f.method === "ui/message") || "no ui/message handled",
        ],
        [
          "no uncaught console errors",
          "a spec host logs a rejected frame rather than failing the call",
          () => consoleErrors.length === 0 || consoleErrors.join(" | "),
        ],
      ],
    });
  }

  // 3. The spec's own App, against each of our hand-written hosts.
  //
  // Both, not one. They are separate hand-written implementations of the same
  // handshake, and the first round of this suite pointed at one of them — so
  // the fixes followed the suite and the other kept all the same defects. A
  // host this package ships is a host this suite drives.
  const ourHosts = [
    ["preview host (synapse preview)", `http://127.0.0.1:${previewServer.port}/preview`],
    ["preview host (dev server /__preview)", `${base}/vite-preview`],
  ];
  for (const [name, url] of ourHosts) {
    const { report, consoleErrors } = await drive(browser, url, "__results", { inFrame: true });
    check(
      name,
      "the spec's own App connects",
      "a host must answer with hostInfo/hostCapabilities, treat request id 0 as an id, and publish only style variables the spec's enum names — a spec client refuses the whole result otherwise, and an App-based app renders nowhere but the real host",
      () => {
        if (!report) return "the app published no results";
        if (report.connect?.ok !== true) return `connect failed: ${report.connect?.error}`;
        return (
          report.hostInfo?.name === "nimblebrain" ||
          `hostInfo was ${JSON.stringify(report.hostInfo)}`
        );
      },
    );
    check(
      name,
      "no uncaught console errors",
      "a rejected frame is logged, not thrown",
      () => consoleErrors.length === 0 || consoleErrors.join(" | "),
    );
  }
} finally {
  await browser.close();
  await previewServer?.close();
  await uiServer?.close();
}

// --- Report -----------------------------------------------------------------

let scenario = "";
for (const row of rows) {
  if (row.scenario !== scenario) {
    scenario = row.scenario;
    process.stdout.write(`\n${scenario}\n`);
  }
  const mark = row.ok ? "  ok  " : " FAIL ";
  process.stdout.write(`${mark} ${row.name}\n`);
  if (!row.ok) {
    process.stdout.write(`       why it matters: ${row.why}\n`);
    process.stdout.write(`       ${row.detail}\n`);
  }
}

process.stdout.write(`\n${rows.length - failures}/${rows.length} conformance checks passed\n`);
process.exit(failures === 0 ? 0 : 1);

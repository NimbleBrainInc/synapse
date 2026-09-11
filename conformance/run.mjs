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

/** Serve `dir`, plus any extra routes, on an ephemeral port. */
async function serve(dir, routes = {}) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const route = routes[url.pathname];
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
  return { port, close: () => new Promise((resolve) => server.close(resolve)) };
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

// `src/preview/server.ts` is TypeScript, so bundle the page builder and import
// that. Reading the real export is the point: asserting against a copy of the
// preview's handshake would prove nothing about what the preview answers.
const previewModule = join(OUT, "preview-host.mjs");
await esbuild.build({
  entryPoints: [join(REPO, "src/preview/server.ts")],
  outfile: previewModule,
  bundle: true,
  format: "esm",
  platform: "node",
  packages: "external",
  logLevel: "warning",
});
const { previewHostHtml } = await import(previewModule);

const browser = await chromium.launch();
let uiServer;
let previewServer;
try {
  // The preview page hard-codes `http://localhost:<uiPort>/` as its iframe src,
  // so the app has to answer at the root of the port the page is told about.
  // Take a port first, then render the page against it.
  const officialPage = page("app-official", ["app-official.js"]);
  uiServer = await serve(OUT, { "/": officialPage, "/index.html": officialPage });
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
          "tools/call carries the server in _meta",
          "a sibling of name/arguments is stripped by every spec client and host",
          (_app, handled) => {
            const calls = handled.filter((f) => f.method === "tools/call");
            if (calls.length === 0) return "no tools/call handled";
            const cross = calls.find((f) => f.params?.name === "list_items");
            if (!cross) return "the cross-server call never arrived";
            if ("server" in cross.params) return "params still carry a top-level `server`";
            const meta = cross.params._meta ?? {};
            return (
              meta["ai.nimblebrain/server"] === "other-server" ||
              `_meta was ${JSON.stringify(meta)}`
            );
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
          "no uncaught console errors",
          "a spec host logs a rejected frame rather than failing the call",
          () => consoleErrors.length === 0 || consoleErrors.join(" | "),
        ],
      ],
    });
  }

  // 2. The vendored connectUI IIFE, under the same host.
  {
    const { report } = await drive(browser, `${base}/host.html?app=connectui`, "__conformance");
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
      ],
    });
  }

  // 3. The spec's own App, against our dev preview host.
  {
    const { report } = await drive(
      browser,
      `http://127.0.0.1:${previewServer.port}/preview`,
      "__results",
      { inFrame: true },
    );
    check(
      "preview host",
      "the spec's own App connects",
      "the preview must answer with hostInfo/hostCapabilities, or an App-based app renders only in the real host",
      () => {
        if (!report) return "the app published no results";
        if (report.connect?.ok !== true) return `connect failed: ${report.connect?.error}`;
        return (
          report.hostInfo?.name === "nimblebrain" ||
          `hostInfo was ${JSON.stringify(report.hostInfo)}`
        );
      },
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

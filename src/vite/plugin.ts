import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { join, resolve } from "node:path";
import type { Plugin, ViteDevServer } from "vite";
import {
  LIST_RESOURCES_METHOD,
  READ_RESOURCE_METHOD,
  RESOURCE_LIST_CHANGED_METHOD,
  TOOLS_CALL_METHOD,
} from "../event-map.js";

/**
 * The server-bound requests this host proxies, which is exactly what its
 * handshake announces: `serverTools` for the tool call, `serverResources` for
 * the two resource methods. An allowlist in both directions — the page sends
 * nothing else to `/__mcp`, and `/__mcp` forwards nothing else to the server,
 * so a method the host never announced cannot reach the server through it.
 *
 * Adding a method here without adding the matching capability below, or the
 * reverse, is the bug this list exists to make obvious: a host that answers
 * what it does not announce is unusable, and one that announces what it does
 * not answer leaves the caller waiting on a reply nobody will send.
 */
const PROXIED_SERVER_METHODS: readonly string[] = [
  TOOLS_CALL_METHOD,
  READ_RESOURCE_METHOD,
  LIST_RESOURCES_METHOD,
];

export interface SynapseVitePluginOptions {
  /** App name. If omitted, reads from ../manifest.json */
  appName?: string;
  /** Path to manifest.json. Default: ../manifest.json (relative to ui/) */
  manifest?: string;
  /**
   * Shell command to start the MCP server. If omitted, derived from manifest.
   * The server runs in stdio mode — stdin/stdout JSON-RPC.
   */
  serverCmd?: string;
  /** Set to false to disable the preview host page at /__preview */
  preview?: boolean;
}

interface Manifest {
  name: string;
  version?: string;
  server?: {
    type?: string;
    entry_point?: string;
    mcp_config?: {
      command?: string;
      args?: string[];
    };
  };
}

/**
 * Synapse Vite plugin — full local dev experience for MCP apps.
 *
 * What it does:
 * - Reads ../manifest.json to get app name and server config
 * - Spawns the MCP server as a child process (stdio mode)
 * - Serves a preview host page at /__preview that iframes your app
 * - Proxies the iframe's tool calls and resource reads through POST /__mcp to
 *   the server, the pair its handshake announces as `serverTools` and
 *   `serverResources`
 * - Forwards the server's `notifications/resources/list_changed` to the iframe
 *   (over GET /__events), as an MCP Apps host does, so `useDataSync` fires
 * - Handles the ext-apps handshake so Synapse hooks work
 * - HMR works inside the iframe — edit .tsx, see changes instantly
 *
 * Usage in vite.config.ts:
 *   import { synapseVite } from "@nimblebrain/synapse/vite";
 *   export default { plugins: [react(), viteSingleFile(), synapseVite()] };
 *
 * Then: cd ui && npm run dev && open http://localhost:5173/__preview
 */
export function synapseVite(options: SynapseVitePluginOptions = {}): Plugin {
  const enablePreview = options.preview !== false;
  let manifest: Manifest | null = null;
  let appName = options.appName ?? "app";
  let serverProcess: ChildProcess | null = null;
  const pendingRequests = new Map<
    string,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  // Preview pages listening on GET /__events for the server's notifications.
  const eventClients = new Set<ServerResponse>();

  /**
   * Hand a server notification to every open preview page, which posts it into
   * the app iframe. Only the one an MCP Apps host forwards to a view is passed
   * on; anything else the server says stays between it and the dev server.
   */
  function forwardNotification(msg: { method?: unknown; params?: unknown }): void {
    if (msg.method !== RESOURCE_LIST_CHANGED_METHOD) return;
    const frame = `data: ${JSON.stringify({ method: msg.method, params: msg.params ?? {} })}\n\n`;
    for (const client of eventClients) client.write(frame);
  }
  let serverBuffer = "";

  function loadManifest(root: string): Manifest | null {
    const manifestPath = options.manifest
      ? resolve(options.manifest)
      : resolve(root, "..", "manifest.json");

    if (!existsSync(manifestPath)) return null;
    try {
      return JSON.parse(readFileSync(manifestPath, "utf-8"));
    } catch {
      return null;
    }
  }

  function deriveServerCmd(m: Manifest, root: string): string | null {
    if (options.serverCmd) return options.serverCmd;
    const cfg = m.server?.mcp_config;
    if (!cfg?.command) return null;

    const serverDir = resolve(root, "..");
    let cmd = cfg.command;
    const args = cfg.args ?? [];

    // Python projects: use `uv run` if pyproject.toml exists
    if (cmd === "python" && existsSync(join(serverDir, "pyproject.toml"))) {
      cmd = "uv run python";
    }

    return `cd ${JSON.stringify(serverDir)} && ${cmd} ${args.join(" ")}`;
  }

  function startServer(cmd: string): void {
    serverProcess = spawn(cmd, {
      shell: true,
      stdio: ["pipe", "pipe", "pipe"],
    });

    serverProcess.stderr?.on("data", (d: Buffer) => {
      process.stderr.write(`  [mcp] ${d}`);
    });

    serverProcess.stdout?.on("data", (d: Buffer) => {
      serverBuffer += d.toString();
      // Parse line-delimited JSON-RPC responses
      const lines = serverBuffer.split("\n");
      serverBuffer = lines.pop() ?? ""; // keep incomplete line
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id && pendingRequests.has(msg.id)) {
            const p = pendingRequests.get(msg.id);
            pendingRequests.delete(msg.id);
            p?.resolve(msg);
          } else if (msg.id === undefined && typeof msg.method === "string") {
            forwardNotification(msg);
          }
        } catch {
          // Not JSON — log it
          process.stderr.write(`  [mcp] ${line}\n`);
        }
      }
    });

    serverProcess.on("exit", (code) => {
      if (code !== null && code !== 0) {
        console.error(`  [mcp] Server exited with code ${code}`);
      }
      serverProcess = null;
    });

    // Send initialize
    sendToServer({
      jsonrpc: "2.0",
      id: "init-1",
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "synapse-preview", version: "0.1.0" },
      },
    });
  }

  function sendToServer(msg: Record<string, unknown>): void {
    if (!serverProcess?.stdin?.writable) return;
    serverProcess.stdin.write(`${JSON.stringify(msg)}\n`);
  }

  function callServer(method: string, params: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = `preview-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      pendingRequests.set(id, { resolve, reject });
      sendToServer({ jsonrpc: "2.0", id, method, params });
      setTimeout(() => {
        if (pendingRequests.has(id)) {
          pendingRequests.delete(id);
          reject(new Error(`${method} timed out (10s)`));
        }
      }, 10000);
    });
  }

  return {
    name: "synapse",

    config() {
      return {
        define: {
          "import.meta.env.SYNAPSE_APP_NAME": JSON.stringify(appName),
        },
        server: {
          hmr: {
            protocol: "ws",
            host: "localhost",
          },
        },
      };
    },

    configResolved(config) {
      manifest = loadManifest(config.root);
      if (manifest?.name) {
        appName = options.appName ?? manifest.name;
      }
    },

    configureServer(server: ViteDevServer) {
      // Start MCP server
      if (enablePreview && manifest) {
        const cmd = deriveServerCmd(manifest, server.config.root);
        if (cmd) {
          console.log(`\n  [synapse] Starting MCP server: ${cmd}\n`);
          startServer(cmd);
        }
      }

      server.middlewares.use((req, res, next) => {
        // CORS for iframe communication
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "*");
        res.setHeader("Access-Control-Allow-Headers", "*");

        // /__preview — bridge host page
        if (req.url === "/__preview" || req.url === "/__preview/") {
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(vitePreviewHostHtml(appName));
          return;
        }

        // GET /__events — the server's notifications, pushed to the preview page
        if (req.method === "GET" && req.url === "/__events") {
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          });
          res.write(": open\n\n");
          eventClients.add(res);
          req.on("close", () => {
            eventClients.delete(res);
          });
          return;
        }

        // POST /__mcp — the server-bound request proxy
        if (req.method === "POST" && req.url === "/__mcp") {
          let body = "";
          req.on("data", (chunk: Buffer) => {
            body += chunk.toString();
          });
          req.on("end", async () => {
            try {
              const msg = JSON.parse(body);
              if (!PROXIED_SERVER_METHODS.includes(msg.method)) {
                throw new Error(`${msg.method} is not a method this host proxies`);
              }
              const result = await callServer(msg.method, msg.params ?? {});
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify(result));
            } catch (err) {
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(
                JSON.stringify({
                  jsonrpc: "2.0",
                  id: JSON.parse(body).id,
                  error: { code: -32000, message: (err as Error).message },
                }),
              );
            }
          });
          return;
        }

        next();
      });
    },

    buildEnd() {
      // Kill server on build end (for production builds)
      if (serverProcess) {
        serverProcess.kill("SIGTERM");
        serverProcess = null;
      }
    },
  };
}

/**
 * The bridge host page the dev server serves at \`/__preview\`.
 *
 * Named apart from \`previewHostHtml\` in \`src/preview/server.ts\`, which is the
 * standalone \`synapse preview\` harness: this package has two hand-written
 * hosts, and the conformance suite drives both, so one name for two pages would
 * be a name that resolves to whichever was imported last.
 */
export function vitePreviewHostHtml(appName: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${appName} — Synapse Preview</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #0f172a; color: #e2e8f0; }
    header { padding: 10px 16px; background: #1e293b; border-bottom: 1px solid #334155; display: flex; align-items: center; gap: 10px; font-size: 13px; }
    header .dot { width: 8px; height: 8px; border-radius: 50%; background: #22c55e; }
    header .name { font-weight: 600; }
    header .spacer { flex: 1; }
    header button { background: #334155; border: none; color: #e2e8f0; padding: 3px 8px; border-radius: 4px; cursor: pointer; font-size: 12px; }
    header .url { color: #64748b; font-size: 11px; font-family: monospace; }
    iframe { width: 100%; height: calc(100vh - 41px); border: none; }
  </style>
</head>
<body>
  <header>
    <span class="dot"></span>
    <span class="name">${appName}</span>
    <span class="spacer"></span>
    <button id="toggle">Toggle Theme</button>
    <span class="url">Synapse Preview</span>
  </header>
  <iframe id="app"></iframe>

  <script>
    var iframe = document.getElementById("app");
    var dark = true;
    var PROXIED = ${JSON.stringify(PROXIED_SERVER_METHODS)};

    // Every key here is one the spec's style-variable enum names. That enum is
    // a strict record, so a single extra key makes a spec client reject the
    // whole \`ui/initialize\` result and refuse to connect — not just ignore the
    // key. The kit's own neutral defaults back anything a host leaves out.
    function getTokens(d) {
      return d ? {
        "--color-background-primary":"#0f172a","--color-background-secondary":"#1e293b",
        "--color-background-tertiary":"#2a374a","--color-text-primary":"#e2e8f0",
        "--color-text-secondary":"#94a3b8","--color-text-tertiary":"#64748b",
        "--color-border-primary":"#334155","--color-border-secondary":"#475569",
        "--color-ring-primary":"#6366f1",
        "--border-radius-sm":"0.5rem","--font-sans":"-apple-system,BlinkMacSystemFont,sans-serif"
      } : {
        "--color-background-primary":"#ffffff","--color-background-secondary":"#f8fafc",
        "--color-background-tertiary":"#f1f5f9","--color-text-primary":"#0f172a",
        "--color-text-secondary":"#64748b","--color-text-tertiary":"#94a3b8",
        "--color-border-primary":"#e2e8f0","--color-border-secondary":"#cbd5e1",
        "--color-ring-primary":"#6366f1",
        "--border-radius-sm":"0.5rem","--font-sans":"-apple-system,BlinkMacSystemFont,sans-serif"
      };
    }

    function post(msg) { iframe.contentWindow.postMessage(msg, "*"); }

    // A request is a frame carrying an id — and \`0\` is a perfectly good id.
    // The MCP SDK numbers from zero, so a truthiness test drops the first
    // request every spec client ever sends, which is its \`ui/initialize\`.
    function isRequest(msg) { return msg.id !== undefined && msg.id !== null; }

    window.addEventListener("message", async function(e) {
      if (e.source !== iframe.contentWindow) return;
      var msg = e.data;
      if (!msg || typeof msg !== "object") return;

      // ext-apps handshake
      // \`hostInfo\`/\`hostCapabilities\` are the spec's field names, and a spec
      // client validates the result against them — the official ext-apps
      // \`App\` refuses to connect to anything else.
      if (msg.method === "ui/initialize" && isRequest(msg)) {
        post({ jsonrpc:"2.0", id:msg.id, result: {
          protocolVersion:"2026-01-26",
          hostInfo:{name:"nimblebrain",version:"preview"},
          hostCapabilities:{openLinks:{},serverTools:{},serverResources:{listChanged:true}},
          hostContext:{theme:dark?"dark":"light",styles:{variables:getTokens(dark)}}
        }});
        return;
      }
      if (msg.method === "ui/notifications/initialized") return;

      // Server-bound requests — proxied via the Vite middleware. The set is
      // exactly what \`serverTools\` and \`serverResources\` above announce, so
      // neither is declared without something on the other end.
      if (PROXIED.indexOf(msg.method) !== -1 && isRequest(msg)) {
        var originalId = msg.id;
        try {
          var r = await fetch("/__mcp", {
            method:"POST", headers:{"Content-Type":"application/json"},
            body: JSON.stringify({jsonrpc:"2.0",id:msg.id,method:msg.method,params:msg.params||{}})
          });
          var response = await r.json();
          response.id = originalId;
          post(response);
          // The page announces no data change of its own. A change is the
          // server's to announce, and that reaches the app over /__events. One
          // fired here on the app's own call would loop: the call fires it, the
          // app re-fetches, and the re-fetch fires it again.
        } catch(err) {
          post({jsonrpc:"2.0",id:originalId,error:{code:-32000,message:err.message}});
        }
        return;
      }

      // Log other messages
      if (msg.method === "synapse/chat") console.log("[chat]", msg.params?.message);
      else if (msg.method === "synapse/action") console.log("[action]", msg.params?.action, msg.params);
      else if (msg.method === "ui/update-model-context") { console.log("[model-context]", msg.params?.structuredContent); if (isRequest(msg)) post({jsonrpc:"2.0",id:msg.id,result:{}}); }
      else if (msg.method === "synapse/keydown") { /* ignore */ }
      else if (msg.method) console.log("[bridge]", msg.method, msg);
    });

    document.getElementById("toggle").onclick = function() {
      dark = !dark;
      document.body.style.background = dark ? "#0f172a" : "#f1f5f9";
      post({jsonrpc:"2.0",method:"ui/notifications/host-context-changed",params:{theme:dark?"dark":"light",styles:{variables:getTokens(dark)}}});
    };

    // The server's own notifications, forwarded into the app as an MCP Apps
    // host forwards them. The dev server passes on only the ones a host would.
    new EventSource("/__events").onmessage = function(e) {
      var n = JSON.parse(e.data);
      post({jsonrpc:"2.0",method:n.method,params:n.params});
    };

    // Load the iframe AFTER the message listener is attached to avoid
    // a race where the app sends ui/initialize before the bridge is ready.
    iframe.src = "/";
  </script>
</body>
</html>`;
}

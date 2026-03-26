import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Plugin, ViteDevServer } from "vite";

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
 * - Proxies tool calls from the iframe through POST /__mcp to the server
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

  function callServerTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = `preview-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      pendingRequests.set(id, { resolve, reject });
      sendToServer({
        jsonrpc: "2.0",
        id,
        method: "tools/call",
        params: { name, arguments: args },
      });
      setTimeout(() => {
        if (pendingRequests.has(id)) {
          pendingRequests.delete(id);
          reject(new Error("Tool call timed out (10s)"));
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
          res.end(previewHostHtml(appName));
          return;
        }

        // POST /__mcp — tool call proxy
        if (req.method === "POST" && req.url === "/__mcp") {
          let body = "";
          req.on("data", (chunk: Buffer) => {
            body += chunk.toString();
          });
          req.on("end", async () => {
            try {
              const msg = JSON.parse(body);
              const result = await callServerTool(msg.params.name, msg.params.arguments || {});
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

function previewHostHtml(appName: string): string {
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
  <iframe id="app" src="/"></iframe>

  <script>
    var iframe = document.getElementById("app");
    var dark = true;

    function getTokens(d) {
      return d ? {
        "--nb-background":"#0f172a","--nb-foreground":"#e2e8f0",
        "--nb-card":"#1e293b","--nb-card-foreground":"#e2e8f0",
        "--nb-primary":"#6366f1","--nb-primary-foreground":"#fff",
        "--nb-muted-foreground":"#94a3b8","--nb-border":"#334155",
        "--nb-ring":"#6366f1","--nb-destructive":"#ef4444",
        "--nb-radius":"0.5rem","--nb-font-sans":"-apple-system,BlinkMacSystemFont,sans-serif"
      } : {
        "--nb-background":"#ffffff","--nb-foreground":"#0f172a",
        "--nb-card":"#f8fafc","--nb-card-foreground":"#0f172a",
        "--nb-primary":"#6366f1","--nb-primary-foreground":"#fff",
        "--nb-muted-foreground":"#64748b","--nb-border":"#e2e8f0",
        "--nb-ring":"#6366f1","--nb-destructive":"#ef4444",
        "--nb-radius":"0.5rem","--nb-font-sans":"-apple-system,BlinkMacSystemFont,sans-serif"
      };
    }

    function post(msg) { iframe.contentWindow.postMessage(msg, "*"); }

    window.addEventListener("message", async function(e) {
      if (e.source !== iframe.contentWindow) return;
      var msg = e.data;
      if (!msg || typeof msg !== "object") return;

      // ext-apps handshake
      if (msg.method === "ui/initialize" && msg.id) {
        post({ jsonrpc:"2.0", id:msg.id, result: {
          protocolVersion:"2026-01-26",
          serverInfo:{name:"nimblebrain",version:"preview"},
          capabilities:{openLinks:{},serverTools:{}},
          hostContext:{theme:dark?"dark":"light",primaryColor:"#6366f1",tokens:getTokens(dark)}
        }});
        return;
      }
      if (msg.method === "ui/notifications/initialized") return;

      // Tool calls — proxy via Vite middleware
      if (msg.method === "tools/call" && msg.id) {
        var originalId = msg.id;
        try {
          var r = await fetch("/__mcp", {
            method:"POST", headers:{"Content-Type":"application/json"},
            body: JSON.stringify({jsonrpc:"2.0",id:msg.id,method:"tools/call",params:{name:msg.params.name,arguments:msg.params.arguments||{}}})
          });
          var response = await r.json();
          response.id = originalId;
          post(response);
        } catch(err) {
          post({jsonrpc:"2.0",id:originalId,error:{code:-32000,message:err.message}});
        }
        return;
      }

      // Log other messages
      if (msg.method === "ui/chat") console.log("[chat]", msg.params?.message);
      else if (msg.method === "ui/action") console.log("[action]", msg.params?.action, msg.params);
      else if (msg.method === "ui/stateChanged") { console.log("[state]", msg.params?.state); post({jsonrpc:"2.0",method:"ui/stateAcknowledged",params:{truncated:false}}); }
      else if (msg.method === "ui/keydown") { /* ignore */ }
      else if (msg.method) console.log("[bridge]", msg.method, msg);
    });

    document.getElementById("toggle").onclick = function() {
      dark = !dark;
      document.body.style.background = dark ? "#0f172a" : "#f1f5f9";
      post({jsonrpc:"2.0",method:"ui/themeChanged",params:{mode:dark?"dark":"light",tokens:getTokens(dark)}});
    };
  </script>
</body>
</html>`;
}

/**
 * Synapse Preview — standalone dev harness for MCP apps with UIs.
 *
 * Starts the MCP server (HTTP mode) and a minimal bridge host page
 * that iframes the app UI and proxies tool calls to the server.
 *
 * Usage:
 *   npx synapse preview --server "uv run uvicorn mcp_hello.server:app --port 8001" --ui ./ui
 *   npx synapse preview --server "node dist/index.js" --ui ./ui --server-port 8001
 */

import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join, resolve } from "node:path";

export interface PreviewOptions {
  /** Shell command to start the MCP server in HTTP mode */
  serverCmd: string;
  /** Port the MCP server listens on (default: 8001) */
  serverPort: number;
  /** Path to the UI directory (must have package.json with dev script) */
  uiDir: string;
  /** Port for the UI Vite dev server (default: 5173) */
  uiPort: number;
  /** Port for the preview harness (default: 5180) */
  previewPort: number;
}

const HOST_HTML = (uiPort: number, serverPort: number) => `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Synapse Preview</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #0f172a; color: #e2e8f0; }
    header { padding: 12px 20px; background: #1e293b; border-bottom: 1px solid #334155; display: flex; align-items: center; gap: 12px; }
    header h1 { font-size: 14px; font-weight: 500; }
    header .dot { width: 8px; height: 8px; border-radius: 50%; background: #22c55e; }
    header .info { font-size: 12px; color: #94a3b8; margin-left: auto; }
    .theme-toggle { background: #334155; border: none; color: #e2e8f0; padding: 4px 10px; border-radius: 4px; cursor: pointer; font-size: 12px; }
    iframe { width: 100%; height: calc(100vh - 45px); border: none; }
  </style>
</head>
<body>
  <header>
    <span class="dot"></span>
    <h1>Synapse Preview</h1>
    <button class="theme-toggle" id="toggle">Toggle Dark/Light</button>
    <span class="info">MCP: localhost:${serverPort} | UI: localhost:${uiPort}</span>
  </header>
  <iframe id="app" src="http://localhost:${uiPort}"></iframe>

  <script>
    var iframe = document.getElementById("app");
    var darkMode = true;

    // Minimal NimbleBrain bridge host — just enough to make Synapse work
    var tokens = darkMode ? {
      "--color-background-primary": "#0f172a", "--color-text-primary": "#e2e8f0",
      "--color-background-secondary": "#1e293b", "--color-text-primary": "#e2e8f0",
      "--color-text-accent": "#6366f1", "--nb-color-accent-foreground": "#ffffff",
      "--color-text-secondary": "#94a3b8", "--color-border-primary": "#334155",
      "--color-ring-primary": "#6366f1", "--nb-color-danger": "#ef4444",
      "--border-radius-sm": "0.5rem",
    } : {
      "--color-background-primary": "#ffffff", "--color-text-primary": "#1a1a1a",
      "--color-background-secondary": "#f9fafb", "--color-text-primary": "#1a1a1a",
      "--color-text-accent": "#6366f1", "--nb-color-accent-foreground": "#ffffff",
      "--color-text-secondary": "#6b7280", "--color-border-primary": "#e5e7eb",
      "--color-ring-primary": "#6366f1", "--nb-color-danger": "#ef4444",
      "--border-radius-sm": "0.5rem",
    };

    function post(msg) { iframe.contentWindow.postMessage(msg, "*"); }

    window.addEventListener("message", async function (event) {
      if (event.source !== iframe.contentWindow) return;
      var msg = event.data;
      if (!msg || typeof msg !== "object") return;

      // ext-apps handshake
      if (msg.method === "ui/initialize" && msg.id) {
        post({
          jsonrpc: "2.0", id: msg.id,
          result: {
            protocolVersion: "2026-01-26",
            serverInfo: { name: "nimblebrain", version: "preview" },
            capabilities: { openLinks: {}, serverTools: {} },
            hostContext: { theme: darkMode ? "dark" : "light", primaryColor: "#6366f1", styles: { variables: tokens } }
          }
        });
        return;
      }

      if (msg.method === "ui/notifications/initialized") return;

      // Tool call proxy — forward to the MCP server
      if (msg.method === "tools/call" && msg.id) {
        try {
          var resp = await fetch("http://localhost:${serverPort}/mcp", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              jsonrpc: "2.0", id: msg.id,
              method: "tools/call",
              params: { name: msg.params.name, arguments: msg.params.arguments || {} }
            })
          });
          var result = await resp.json();
          // Forward the JSON-RPC response back to the iframe
          post(result);
        } catch (err) {
          post({ jsonrpc: "2.0", id: msg.id, error: { code: -32000, message: err.message || "Server error" } });
        }
        return;
      }

      // synapse/chat — log to console
      if (msg.method === "synapse/chat") {
        console.log("[chat]", msg.params?.message);
        return;
      }

      // synapse/action — log to console
      if (msg.method === "synapse/action") {
        console.log("[action]", msg.params?.action, msg.params);
        return;
      }

      // synapse/keydown — ignore in preview
      if (msg.method === "synapse/keydown") return;

      // ui/update-model-context — log (ext-apps spec)
      if (msg.method === "ui/update-model-context") {
        console.log("[model-context]", msg.params?.structuredContent);
        if (msg.id) post({ jsonrpc: "2.0", id: msg.id, result: {} });
        return;
      }

      console.log("[bridge] unhandled:", msg.method, msg);
    });

    // Theme toggle
    document.getElementById("toggle").addEventListener("click", function () {
      darkMode = !darkMode;
      document.body.style.background = darkMode ? "#0f172a" : "#f1f5f9";
      tokens = darkMode ? {
        "--color-background-primary": "#0f172a", "--color-text-primary": "#e2e8f0",
        "--color-background-secondary": "#1e293b", "--color-text-primary": "#e2e8f0",
        "--color-text-accent": "#6366f1", "--nb-color-accent-foreground": "#ffffff",
        "--color-text-secondary": "#94a3b8", "--color-border-primary": "#334155",
        "--color-ring-primary": "#6366f1", "--nb-color-danger": "#ef4444",
        "--border-radius-sm": "0.5rem",
      } : {
        "--color-background-primary": "#ffffff", "--color-text-primary": "#1a1a1a",
        "--color-background-secondary": "#f9fafb", "--color-text-primary": "#1a1a1a",
        "--color-text-accent": "#6366f1", "--nb-color-accent-foreground": "#ffffff",
        "--color-text-secondary": "#6b7280", "--color-border-primary": "#e5e7eb",
        "--color-ring-primary": "#6366f1", "--nb-color-danger": "#ef4444",
        "--border-radius-sm": "0.5rem",
      };
      post({ jsonrpc: "2.0", method: "ui/notifications/host-context-changed", params: { theme: darkMode ? "dark" : "light", styles: { variables: tokens } } });
    });
  </script>
</body>
</html>`;

export async function startPreview(options: PreviewOptions): Promise<void> {
  const { serverCmd, serverPort, uiDir, uiPort, previewPort } = options;
  const children: ChildProcess[] = [];

  console.log(`\n  Synapse Preview\n`);

  // 1. Start MCP server
  console.log(`  [server] ${serverCmd}`);
  const serverProc = spawn(serverCmd, {
    shell: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(serverProc);
  serverProc.stdout?.on("data", (d: Buffer) => process.stdout.write(`  [server] ${d}`));
  serverProc.stderr?.on("data", (d: Buffer) => process.stderr.write(`  [server] ${d}`));

  // 2. Start UI Vite dev server
  const resolvedUi = resolve(uiDir);
  if (!existsSync(join(resolvedUi, "package.json"))) {
    console.error(`  [ui] Error: no package.json found at ${resolvedUi}`);
    process.exit(1);
  }
  console.log(`  [ui] cd ${resolvedUi} && npx vite --port ${uiPort}`);
  const uiProc = spawn("npx", ["vite", "--port", String(uiPort)], {
    cwd: resolvedUi,
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(uiProc);
  uiProc.stdout?.on("data", (d: Buffer) => process.stdout.write(`  [ui] ${d}`));
  uiProc.stderr?.on("data", (d: Buffer) => process.stderr.write(`  [ui] ${d}`));

  // 3. Start preview host
  const html = HOST_HTML(uiPort, serverPort);
  const host = createServer((_req: IncomingMessage, res: ServerResponse) => {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(html);
  });
  host.listen(previewPort, () => {
    console.log(`\n  Preview:  http://localhost:${previewPort}`);
    console.log(`  UI:       http://localhost:${uiPort}`);
    console.log(`  Server:   http://localhost:${serverPort}`);
    console.log(`\n  Press Ctrl+C to stop.\n`);
  });

  // Shutdown
  const shutdown = () => {
    console.log("\n  Shutting down...");
    host.close();
    for (const child of children) {
      try {
        child.kill("SIGTERM");
      } catch {
        /* already dead */
      }
    }
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

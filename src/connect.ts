import { parseToolResultParams } from "./content-parser.js";
import { resolveEventMethod } from "./event-map.js";
import { createResizer } from "./resize.js";
import { parseToolResult } from "./result-parser.js";
import { SynapseTransport } from "./transport.js";
import type { App, ConnectOptions, Dimensions, Theme, ToolCallResult } from "./types.js";

/**
 * Connect to a MCP Apps host.
 *
 * Owns the full ext-apps handshake (steps 1-9 from the RFC), content parsing,
 * resize management, and event routing. Returns a ready-to-use `App` object.
 */
export async function connect(options: ConnectOptions): Promise<App> {
  const { name, version, autoResize = false } = options;

  const transport = new SynapseTransport();
  let destroyed = false;

  // --- Mutable state ---
  let currentTheme: Theme = { mode: "light", tokens: {} };
  let hostInfo: { name: string; version: string } = { name: "unknown", version: "unknown" };
  let toolInfo: { tool: Record<string, unknown> } | null = null;
  let containerDimensions: Dimensions | null = null;

  // --- Event handlers ---
  // Maps full MCP method names to sets of handlers.
  const handlers = new Map<string, Set<(params: unknown) => void>>();

  // --- Step 1: Set up message listener (handled by SynapseTransport constructor) ---

  // --- Step 2: Send initial size ---
  const resizer = createResizer((method, params) => transport.send(method, params), autoResize);
  resizer.measureAndSend();

  // --- Steps 3-4: Send ui/initialize and wait for response ---
  const result = (await transport.request("ui/initialize", {
    protocolVersion: "2026-01-26",
    clientInfo: { name, version },
    capabilities: {},
  })) as Record<string, unknown> | null;

  // --- Step 5: Extract theme, hostInfo, toolInfo, containerDimensions ---
  const resp = result ?? {};
  const serverInfo = safeObj(resp.serverInfo);
  hostInfo = {
    name: typeof serverInfo?.name === "string" ? serverInfo.name : "unknown",
    version: typeof serverInfo?.version === "string" ? serverInfo.version : "unknown",
  };

  const hostContext = safeObj(resp.hostContext);
  if (hostContext) {
    const themeRaw = safeObj(hostContext.theme);
    if (themeRaw) {
      currentTheme = {
        mode: themeRaw.mode === "dark" ? "dark" : "light",
        tokens:
          themeRaw.tokens && typeof themeRaw.tokens === "object" && !Array.isArray(themeRaw.tokens)
            ? (themeRaw.tokens as Record<string, string>)
            : {},
      };
    }
    if (hostContext.toolInfo && typeof hostContext.toolInfo === "object") {
      const ti = hostContext.toolInfo as Record<string, unknown>;
      toolInfo = { tool: (ti.tool as Record<string, unknown>) ?? ti };
    }
    if (hostContext.containerDimensions && typeof hostContext.containerDimensions === "object") {
      containerDimensions = hostContext.containerDimensions as Dimensions;
    }

    // Inject host CSS variables into the DOM
    const styles = safeObj(hostContext.styles);
    injectCssVariables(styles?.variables as Record<string, string> | undefined);
  }

  // --- Step 6: Send initialized ---
  transport.send("ui/notifications/initialized", {});

  // --- Step 7: autoResize already handled by createResizer ---

  // --- Step 9: Route ALL incoming notifications to registered handlers ---
  // We register a wildcard-style listener on the transport for every known
  // method. The transport routes by exact method name, so we subscribe to
  // each unique method that has handlers. We use a different approach:
  // intercept at the transport level by subscribing once per method as
  // handlers are added.

  // Special handling for theme-changed: update internal state
  const themeMethod = resolveEventMethod("theme-changed");
  transport.onMessage(themeMethod, (params) => {
    if (destroyed || !params) return;
    const mode = params.theme === "dark" ? "dark" : "light";
    const tokens =
      params.tokens && typeof params.tokens === "object" && !Array.isArray(params.tokens)
        ? (params.tokens as Record<string, string>)
        : currentTheme.tokens;
    currentTheme = { mode, tokens };
    injectCssVariables(tokens);
    // Fire theme-changed handlers
    const set = handlers.get(themeMethod);
    if (set) {
      for (const handler of set) handler(currentTheme);
    }
  });

  // Helper to ensure transport subscription exists for a method
  const subscribedMethods = new Set<string>([themeMethod]);

  function ensureTransportSub(method: string): void {
    if (subscribedMethods.has(method)) return;
    subscribedMethods.add(method);

    const toolResultMethod = resolveEventMethod("tool-result");
    const isToolResult = method === toolResultMethod;

    transport.onMessage(method, (params) => {
      if (destroyed) return;
      const set = handlers.get(method);
      if (!set) return;
      for (const handler of set) {
        if (isToolResult) {
          handler(parseToolResultParams(params));
        } else {
          handler(params);
        }
      }
    });
  }

  // --- Step 8: Build and return the App object ---
  const app: App = {
    get theme() {
      return { ...currentTheme };
    },
    get hostInfo() {
      return { ...hostInfo };
    },
    get toolInfo() {
      return toolInfo;
    },
    get containerDimensions() {
      return containerDimensions;
    },

    on(event: string, handler: (params: any) => void): () => void {
      const method = resolveEventMethod(event);

      if (!handlers.has(method)) {
        handlers.set(method, new Set());
      }
      handlers.get(method)?.add(handler);
      ensureTransportSub(method);

      return () => {
        const set = handlers.get(method);
        if (set) {
          set.delete(handler);
          if (set.size === 0) handlers.delete(method);
        }
      };
    },

    resize(width?: number, height?: number): void {
      resizer.resize(width, height);
    },

    openLink(url: string): void {
      if (destroyed) return;
      transport.send("ui/open-link", { url });
    },

    updateModelContext(state: Record<string, unknown>, summary?: string): void {
      if (destroyed) return;
      transport.send("ui/update-model-context", {
        structuredContent: state,
        ...(summary !== undefined && {
          content: [{ type: "text", text: summary }],
        }),
      });
    },

    async callTool(toolName: string, args?: Record<string, unknown>): Promise<ToolCallResult> {
      const raw = await transport.request("tools/call", {
        name: toolName,
        arguments: args ?? {},
      });
      return parseToolResult(raw);
    },

    sendMessage(text: string, context?: { action?: string; entity?: string }): void {
      if (destroyed) return;
      const textBlock: Record<string, unknown> = { type: "text", text };
      if (context) {
        textBlock._meta = { context };
      }
      transport.send("ui/message", {
        role: "user",
        content: [textBlock],
      });
    },

    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      resizer.destroy();
      handlers.clear();
      transport.destroy();
    },
  };

  return app;
}

// --- Helpers ---

function safeObj(value: unknown): Record<string, unknown> | undefined {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

/** Inject CSS custom properties onto :root so widgets inherit host theming. */
function injectCssVariables(vars: Record<string, string> | undefined | null): void {
  if (!vars || typeof vars !== "object") return;
  for (const [k, v] of Object.entries(vars)) {
    if (typeof k === "string" && typeof v === "string") {
      document.documentElement.style.setProperty(k, v);
    }
  }
}

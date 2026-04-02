import type {
  McpUiHostContext,
  McpUiHostContextChangedNotification,
  McpUiInitializedNotification,
  McpUiInitializeRequest,
  McpUiInitializeResult,
  McpUiMessageRequest,
  McpUiOpenLinkRequest,
  McpUiSizeChangedNotification,
  McpUiToolResultNotification,
  McpUiUpdateModelContextRequest,
} from "@modelcontextprotocol/ext-apps";
import {
  HOST_CONTEXT_CHANGED_METHOD,
  INITIALIZE_METHOD,
  INITIALIZED_METHOD,
  LATEST_PROTOCOL_VERSION,
  MESSAGE_METHOD,
  OPEN_LINK_METHOD,
  SIZE_CHANGED_METHOD,
  TOOL_CANCELLED_METHOD,
  TOOL_INPUT_METHOD,
  TOOL_INPUT_PARTIAL_METHOD,
  TOOL_RESULT_METHOD,
} from "@modelcontextprotocol/ext-apps";
import type { CallToolRequest, TextContent } from "@modelcontextprotocol/sdk/types.js";

import { parseToolResultParams } from "./content-parser.js";
import { resolveEventMethod } from "./event-map.js";
import { createResizer } from "./resize.js";
import { parseToolResult } from "./result-parser.js";
import { SynapseTransport } from "./transport.js";
import type { App, ConnectOptions, Dimensions, Theme, ToolCallResult } from "./types.js";

/**
 * Connect to a MCP Apps host.
 *
 * Owns the full ext-apps handshake, content parsing, resize management,
 * and event routing. Returns a ready-to-use `App` object.
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
  const handlers = new Map<string, Set<(params: unknown) => void>>();

  // --- Step 1: Set up message listener (handled by SynapseTransport constructor) ---

  // --- Step 2: Send initial size ---
  const resizer = createResizer((method, params) => transport.send(method, params), autoResize);
  resizer.measureAndSend();

  // --- Steps 3-4: Send ui/initialize and wait for response ---
  const initParams: McpUiInitializeRequest["params"] = {
    protocolVersion: LATEST_PROTOCOL_VERSION,
    appInfo: { name, version },
    appCapabilities: {},
  };

  const result = (await transport.request(
    INITIALIZE_METHOD,
    initParams as unknown as Record<string, unknown>,
  )) as McpUiInitializeResult | null;

  // --- Step 5: Extract theme, hostInfo, toolInfo, containerDimensions ---
  if (result) {
    hostInfo = {
      name: result.hostInfo?.name ?? "unknown",
      version: result.hostInfo?.version ?? "unknown",
    };

    const ctx: McpUiHostContext | undefined = result.hostContext;
    if (ctx) {
      currentTheme = {
        mode: ctx.theme === "dark" ? "dark" : "light",
        tokens:
          ctx.styles?.variables && typeof ctx.styles.variables === "object"
            ? (ctx.styles.variables as Record<string, string>)
            : {},
      };

      if (ctx.toolInfo && typeof ctx.toolInfo === "object") {
        toolInfo = { tool: (ctx.toolInfo.tool as unknown as Record<string, unknown>) ?? {} };
      }
      if (ctx.containerDimensions && typeof ctx.containerDimensions === "object") {
        containerDimensions = ctx.containerDimensions as Dimensions;
      }

      // Inject host CSS variables into the DOM
      injectCssVariables(ctx.styles?.variables as Record<string, string> | undefined);
    }
  }

  // --- Route incoming notifications to registered handlers ---

  // Special handling for host-context-changed: update internal theme state
  transport.onMessage(HOST_CONTEXT_CHANGED_METHOD, (params) => {
    if (destroyed || !params) return;
    const ctx = params as Partial<McpUiHostContextChangedNotification["params"]>;
    const mode = ctx.theme === "dark" ? "dark" : "light";
    const variables = ctx.styles?.variables;
    const tokens =
      variables && typeof variables === "object"
        ? (variables as Record<string, string>)
        : currentTheme.tokens;
    currentTheme = { mode, tokens };
    injectCssVariables(tokens);
    const set = handlers.get(HOST_CONTEXT_CHANGED_METHOD);
    if (set) {
      for (const handler of set) handler(currentTheme);
    }
  });

  // Helper to ensure transport subscription exists for a method
  const subscribedMethods = new Set<string>([HOST_CONTEXT_CHANGED_METHOD]);

  function ensureTransportSub(method: string): void {
    if (subscribedMethods.has(method)) return;
    subscribedMethods.add(method);

    const isToolResult = method === TOOL_RESULT_METHOD;

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

  // --- Step 6: Pre-register handlers from options.on, then send initialized ---
  if (options.on) {
    for (const [event, handler] of Object.entries(options.on)) {
      if (typeof handler === "function") {
        const method = resolveEventMethod(event);
        if (!handlers.has(method)) handlers.set(method, new Set());
        handlers.get(method)?.add(handler);
        ensureTransportSub(method);
      }
    }
  }
  transport.send(INITIALIZED_METHOD, {});

  // --- Step 7: Build and return the App object ---
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
      const params: McpUiOpenLinkRequest["params"] = { url };
      // Spec: ui/open-link is a request (expects a response), not a notification
      transport
        .request(OPEN_LINK_METHOD, params as unknown as Record<string, unknown>)
        .catch(() => {});
    },

    updateModelContext(state: Record<string, unknown>, summary?: string): void {
      if (destroyed) return;
      const params: McpUiUpdateModelContextRequest["params"] = {
        structuredContent: state,
        ...(summary !== undefined && {
          content: [{ type: "text", text: summary } satisfies TextContent],
        }),
      };
      transport.send("ui/update-model-context", params as unknown as Record<string, unknown>);
    },

    async callTool(toolName: string, args?: Record<string, unknown>): Promise<ToolCallResult> {
      const params: CallToolRequest["params"] = {
        name: toolName,
        arguments: args ?? {},
      };
      const raw = await transport.request(
        "tools/call",
        params as unknown as Record<string, unknown>,
      );
      return parseToolResult(raw);
    },

    sendMessage(text: string, context?: { action?: string; entity?: string }): void {
      if (destroyed) return;
      const textBlock: TextContent = {
        type: "text",
        text,
        ...(context && { _meta: { context } }),
      };
      const params: McpUiMessageRequest["params"] = {
        role: "user",
        content: [textBlock],
      };
      transport.send(MESSAGE_METHOD, params as unknown as Record<string, unknown>);
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

/** Inject CSS custom properties onto :root so widgets inherit host theming. */
function injectCssVariables(vars: Record<string, string> | undefined | null): void {
  if (!vars || typeof vars !== "object") return;
  for (const [k, v] of Object.entries(vars)) {
    if (typeof k === "string" && typeof v === "string") {
      document.documentElement.style.setProperty(k, v);
    }
  }
}

import type {
  McpUiHostContextChangedNotification,
  McpUiInitializeRequest,
  McpUiMessageRequest,
  McpUiOpenLinkRequest,
  McpUiUpdateModelContextRequest,
} from "@modelcontextprotocol/ext-apps";
import {
  HOST_CONTEXT_CHANGED_METHOD,
  INITIALIZE_METHOD,
  INITIALIZED_METHOD,
  LATEST_PROTOCOL_VERSION,
  MESSAGE_METHOD,
  OPEN_LINK_METHOD,
} from "@modelcontextprotocol/ext-apps";
import type {
  ReadResourceRequest,
  ReadResourceResult,
  TextContent,
} from "@modelcontextprotocol/sdk/types.js";

import { detectHost } from "./detection.js";
import { KeyboardForwarder } from "./keyboard.js";
import { parseToolResult } from "./result-parser.js";
import { SynapseTransport } from "./transport.js";
import type {
  AgentAction,
  DataChangedEvent,
  FileResult,
  HostInfo,
  RequestFileOptions,
  Synapse,
  SynapseOptions,
  SynapseTheme,
  ToolCallResult,
} from "./types.js";

// `@modelcontextprotocol/ext-apps` only exports METHOD constants for ext-apps
// specific ui/* methods, not standard MCP methods. Deriving the constant
// locally with the spec request's `method` type still fails compilation if
// upstream renames it.
const READ_RESOURCE_METHOD: ReadResourceRequest["method"] = "resources/read";

/**
 * Create a Synapse instance.
 *
 * Wraps the ext-apps protocol handshake via `SynapseTransport` and provides
 * a typed, framework-agnostic API for calling tools, reacting to data changes,
 * dispatching actions, and pushing LLM-visible state.
 *
 * In non-NimbleBrain hosts, NB-specific methods degrade to no-ops.
 */
export function createSynapse(options: SynapseOptions): Synapse {
  const { name, version, internal = false, forwardKeys } = options;

  const transport = new SynapseTransport();
  let hostInfo: HostInfo | null = null;
  let currentTheme: SynapseTheme = {
    mode: "light",
    primaryColor: "#6366f1",
    tokens: {},
  };
  let destroyed = false;

  // --- Debounce for setVisibleState ---
  let stateTimer: ReturnType<typeof setTimeout> | null = null;

  // --- Keyboard forwarding ---
  let keyboard: KeyboardForwarder | null = null;

  // --- ext-apps handshake ---
  const initParams: McpUiInitializeRequest["params"] = {
    protocolVersion: LATEST_PROTOCOL_VERSION,
    appInfo: { name, version },
    appCapabilities: {},
  };

  const ready = transport
    .request(INITIALIZE_METHOD, initParams as unknown as Record<string, unknown>)
    .then((result) => {
      hostInfo = detectHost(result);
      currentTheme = hostInfo.theme;

      // Inject host CSS variables into :root so plain-CSS styles can consume
      // them via `var(--…)` without needing to read theme.tokens imperatively.
      injectCssVariables(currentTheme.tokens);

      // Notify subscribers so React <ThemeInjector> and custom onThemeChanged
      // listeners reflect the handshake-provided theme (not just subsequent
      // host-context-changed notifications).
      for (const cb of themeCallbacks) cb(currentTheme);

      transport.send(INITIALIZED_METHOD, {});

      keyboard = new KeyboardForwarder(transport, forwardKeys);
    });

  // Listen for theme changes from the host (ext-apps spec)
  const unsubTheme = transport.onMessage(HOST_CONTEXT_CHANGED_METHOD, (params) => {
    if (!params) return;
    const mode = params.theme === "dark" ? "dark" : "light";
    // Spec: tokens are nested under styles.variables
    const styles = params.styles as Record<string, unknown> | undefined;
    const variables = styles?.variables as Record<string, string> | undefined;
    const tokens = variables && typeof variables === "object" ? variables : currentTheme.tokens;
    currentTheme = { mode, primaryColor: currentTheme.primaryColor, tokens };
    injectCssVariables(tokens);
    for (const cb of themeCallbacks) cb(currentTheme);
  });

  const themeCallbacks = new Set<(theme: SynapseTheme) => void>();
  const dataCallbacks = new Set<(event: DataChangedEvent) => void>();
  const actionCallbacks = new Set<(action: AgentAction) => void>();

  // Listen for data change events
  const unsubData = transport.onMessage("synapse/data-changed", (params) => {
    if (!params) return;
    const event: DataChangedEvent = {
      source: "agent",
      server: (params.server as string) ?? "",
      tool: (params.tool as string) ?? "",
    };
    for (const cb of dataCallbacks) cb(event);
  });

  // Listen for agent actions (typed, declarative commands from the server)
  const unsubAction = transport.onMessage("synapse/action", (params) => {
    if (!params || typeof params.type !== "string") return;
    const action: AgentAction = {
      type: params.type as string,
      payload: (params.payload as Record<string, unknown>) ?? {},
      requiresConfirmation: params.requiresConfirmation === true,
      label: typeof params.label === "string" ? params.label : undefined,
    };
    for (const cb of actionCallbacks) cb(action);
  });

  const isNB = () => hostInfo?.isNimbleBrain === true;

  const synapse: Synapse = {
    get ready() {
      return ready;
    },

    get isNimbleBrainHost() {
      return isNB();
    },

    get destroyed() {
      return destroyed;
    },

    async callTool<TInput = Record<string, unknown>, TOutput = unknown>(
      toolName: string,
      args?: TInput,
    ): Promise<ToolCallResult<TOutput>> {
      const params: Record<string, unknown> = {
        name: toolName,
        arguments: args ?? {},
      };
      // Internal apps can cross-call
      if (internal) {
        params.server = name;
      }
      const raw = await transport.request("tools/call", params);
      return parseToolResult(raw) as ToolCallResult<TOutput>;
    },

    async readResource(uri: string): Promise<ReadResourceResult> {
      const params: ReadResourceRequest["params"] = { uri };
      const raw = await transport.request(
        READ_RESOURCE_METHOD,
        params as unknown as Record<string, unknown>,
      );
      return raw as ReadResourceResult;
    },

    onDataChanged(callback: (event: DataChangedEvent) => void): () => void {
      dataCallbacks.add(callback);
      return () => {
        dataCallbacks.delete(callback);
      };
    },

    onAction(callback: (action: AgentAction) => void): () => void {
      actionCallbacks.add(callback);
      return () => {
        actionCallbacks.delete(callback);
      };
    },

    getTheme(): SynapseTheme {
      return { ...currentTheme };
    },

    onThemeChanged(callback: (theme: SynapseTheme) => void): () => void {
      themeCallbacks.add(callback);
      return () => {
        themeCallbacks.delete(callback);
      };
    },

    action(action: string, params?: Record<string, unknown>): void {
      if (!isNB()) return;
      transport.send("synapse/action", { action, ...params });
    },

    chat(message: string, context?: { action?: string; entity?: string }): void {
      const textBlock: TextContent = {
        type: "text",
        text: message,
        ...(isNB() && context && { _meta: { context } }),
      };
      const params: McpUiMessageRequest["params"] = {
        role: "user",
        content: [textBlock],
      };
      transport.send(MESSAGE_METHOD, params as unknown as Record<string, unknown>);
    },

    setVisibleState(state: Record<string, unknown>, summary?: string): void {
      // Debounce: 250ms
      if (stateTimer) clearTimeout(stateTimer);
      stateTimer = setTimeout(() => {
        const params: McpUiUpdateModelContextRequest["params"] = {
          structuredContent: state,
          ...(summary !== undefined && {
            content: [{ type: "text", text: summary } satisfies TextContent],
          }),
        };
        transport.send("ui/update-model-context", params as unknown as Record<string, unknown>);
        stateTimer = null;
      }, 250);
    },

    saveFile(filename: string, content: string | Blob, mimeType?: string): void {
      // Always send — the bridge handles this for any host that supports it.
      // Removing the isNB() guard fixes silent failures when host detection
      // hasn't completed yet or when the handshake response is delayed.
      const data = typeof content === "string" ? content : "[Blob content not serializable]";
      transport.send("synapse/save-file", {
        data,
        filename,
        mimeType: mimeType ?? "application/octet-stream",
      });
    },

    downloadFile(filename: string, content: string | Blob, mimeType?: string): void {
      const data = typeof content === "string" ? content : "[Blob content not serializable]";
      transport.send("synapse/download-file", {
        data,
        filename,
        mimeType: mimeType ?? "application/octet-stream",
      });
    },

    openLink(url: string): void {
      const params: McpUiOpenLinkRequest["params"] = { url };
      // Spec: ui/open-link is a request (expects a response), not a notification
      transport
        .request(OPEN_LINK_METHOD, params as unknown as Record<string, unknown>)
        .catch(() => {
          // Fallback: if host doesn't respond, open directly
          window.open(url, "_blank", "noopener");
        });
    },

    async pickFile(options?: RequestFileOptions): Promise<FileResult | null> {
      if (!isNB()) {
        throw new Error("pickFile is not supported in this host");
      }
      const result = await transport.request("synapse/pick-file", {
        accept: options?.accept,
        maxSize: options?.maxSize ?? 26_214_400,
        multiple: false,
      });
      return (result as FileResult) ?? null;
    },

    async pickFiles(options?: RequestFileOptions): Promise<FileResult[]> {
      if (!isNB()) {
        throw new Error("pickFiles is not supported in this host");
      }
      const result = await transport.request("synapse/pick-file", {
        accept: options?.accept,
        maxSize: options?.maxSize ?? 26_214_400,
        multiple: true,
      });
      if (!result) return [];
      return Array.isArray(result) ? (result as FileResult[]) : [result as FileResult];
    },

    _onMessage(
      method: string,
      callback: (params: Record<string, unknown> | undefined) => void,
    ): () => void {
      return transport.onMessage(method, callback);
    },

    _request(method: string, params?: Record<string, unknown>): Promise<unknown> {
      return transport.request(method, params);
    },

    destroy(): void {
      if (destroyed) return;
      destroyed = true;

      if (stateTimer) clearTimeout(stateTimer);
      keyboard?.destroy();
      unsubTheme();
      unsubData();
      unsubAction();
      themeCallbacks.clear();
      dataCallbacks.clear();
      actionCallbacks.clear();
      transport.destroy();
    },
  };

  return synapse;
}

/** Inject CSS custom properties onto :root so widgets inherit host theming. */
function injectCssVariables(vars: Record<string, string> | undefined | null): void {
  if (!vars || typeof vars !== "object") return;
  if (typeof document === "undefined") return;
  for (const [k, v] of Object.entries(vars)) {
    if (typeof k === "string" && typeof v === "string") {
      document.documentElement.style.setProperty(k, v);
    }
  }
}

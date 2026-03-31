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
  // We send ui/initialize as a JSON-RPC request and wait for the response.
  const ready = transport
    .request("ui/initialize", {
      protocolVersion: "2026-01-26",
      clientInfo: { name, version },
      capabilities: {},
    })
    .then((result) => {
      hostInfo = detectHost(result);
      currentTheme = hostInfo.theme;

      // Send initialized notification per ext-apps spec
      transport.send("ui/notifications/initialized", {});

      // Set up keyboard forwarding after we know the host
      keyboard = new KeyboardForwarder(transport, forwardKeys);
    });

  // Listen for theme changes from the host
  const unsubTheme = transport.onMessage("ui/notifications/host-context-changed", (params) => {
    if (!params) return;
    const mode = params.theme === "dark" ? "dark" : "light";
    const tokens =
      params.tokens && typeof params.tokens === "object"
        ? (params.tokens as Record<string, string>)
        : currentTheme.tokens;
    currentTheme = { mode, primaryColor: currentTheme.primaryColor, tokens };
    for (const cb of themeCallbacks) cb(currentTheme);
  });

  // Also listen for NB-specific synapse/theme-changed message
  const unsubNbTheme = transport.onMessage("synapse/theme-changed", (params) => {
    if (!params) return;
    const mode =
      params.mode === "dark" || params.mode === "light" ? params.mode : currentTheme.mode;
    const tokens =
      params.tokens && typeof params.tokens === "object"
        ? (params.tokens as Record<string, string>)
        : currentTheme.tokens;
    currentTheme = { mode, primaryColor: currentTheme.primaryColor, tokens };
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
      const textBlock: Record<string, unknown> = { type: "text", text: message };
      if (isNB() && context) {
        textBlock._meta = { context };
      }
      transport.send("ui/message", {
        role: "user",
        content: [textBlock],
      });
    },

    setVisibleState(state: Record<string, unknown>, summary?: string): void {
      // Debounce: 250ms
      if (stateTimer) clearTimeout(stateTimer);
      stateTimer = setTimeout(() => {
        transport.send("ui/update-model-context", {
          structuredContent: state,
          ...(summary !== undefined && {
            content: [{ type: "text", text: summary }],
          }),
        });
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

    openLink(url: string): void {
      transport.send("ui/open-link", { url });
      if (!isNB()) {
        window.open(url, "_blank", "noopener");
      }
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
      unsubNbTheme();
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

import type {
  McpUiHostContext,
  McpUiInitializeRequest,
  McpUiInitializeResult,
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

import { detectHost, extractTheme } from "./detection.js";
import { KeyboardForwarder } from "./keyboard.js";
import { parseToolResult } from "./result-parser.js";
import { callToolAsTask as callToolAsTaskImpl, createTaskStatusRouter } from "./task-handle.js";
import { SynapseTransport } from "./transport.js";
import type {
  AgentAction,
  CallToolAsTaskOptions,
  DataChangedEvent,
  FileResult,
  HostInfo,
  RequestFileOptions,
  Synapse,
  SynapseOptions,
  SynapseTheme,
  TaskHandle,
  TasksCapability,
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
  // Single source of truth for ext-apps host context. `theme`, `styles`,
  // `displayMode`, `toolInfo` are spec-standardized fields; the open
  // `[key: string]: unknown` lets hosts publish extensions (e.g. NimbleBrain
  // populates a `workspace` field). `getTheme()` and any other typed view
  // is derived from this object — no parallel state.
  let currentHostContext: McpUiHostContext = {};
  // Module-private store for the host's declared `tasks` capability. Kept
  // in the closure (not on Synapse) so `callToolAsTask` reads it without
  // expanding the public surface. `null` before the handshake completes;
  // `undefined` after a handshake where the host did not advertise `tasks`.
  let hostTasksCapability: TasksCapability | undefined | null = null;
  let destroyed = false;

  // Shared router for `notifications/tasks/status`. Created eagerly so
  // the transport-level listener registers exactly once — every
  // `TaskHandle.onStatus` subscriber filters off this single wire
  // subscription by taskId. Disposed in `destroy()`.
  const taskStatusRouter = createTaskStatusRouter(transport);

  // --- Debounce for setVisibleState ---
  let stateTimer: ReturnType<typeof setTimeout> | null = null;

  // --- Keyboard forwarding ---
  let keyboard: KeyboardForwarder | null = null;

  // --- ext-apps handshake ---
  //
  // `appCapabilities` is typed as `McpUiAppCapabilities` by the ext-apps
  // spec package, which does not yet model the MCP 2025-11-25 tasks
  // utility. We extend structurally via `TasksCapability` (re-exported
  // from the SDK's `ClientCapabilities.tasks` / `ServerTasksCapability`
  // shape) and `satisfies` the extension so the nested objects match the
  // spec literally — empty objects `{}` as presence flags, NOT booleans.
  const appCapabilities = {
    tasks: {
      cancel: {},
      requests: { tools: { call: {} } },
    } satisfies TasksCapability,
  };
  const initParams: McpUiInitializeRequest["params"] = {
    protocolVersion: LATEST_PROTOCOL_VERSION,
    appInfo: { name, version },
    appCapabilities:
      appCapabilities as unknown as McpUiInitializeRequest["params"]["appCapabilities"],
  };

  const ready = transport
    .request(INITIALIZE_METHOD, initParams as unknown as Record<string, unknown>)
    .then((result) => {
      hostInfo = detectHost(result);
      currentHostContext = ((result as McpUiInitializeResult | null)?.hostContext ??
        {}) as McpUiHostContext;

      // Capture the host's declared `tasks` capability from the init
      // response. The ext-apps `McpUiHostCapabilities` type lacks a
      // `tasks` field (the SDK extension post-dates it), so we read via
      // the result's index signature. `undefined` when absent.
      const initResult = result as McpUiInitializeResult | null;
      const rawTasks = (initResult?.hostCapabilities as Record<string, unknown> | undefined)?.tasks;
      hostTasksCapability =
        rawTasks && typeof rawTasks === "object" && !Array.isArray(rawTasks)
          ? (rawTasks as TasksCapability)
          : undefined;

      // Inject host CSS variables into :root so plain-CSS styles can consume
      // them via `var(--…)` without needing to read theme.tokens imperatively.
      injectCssVariables(extractTheme(currentHostContext).tokens);

      // Notify subscribers so React hooks (useTheme, useHostContext) and
      // custom listeners reflect the handshake-provided context (not just
      // subsequent host-context-changed notifications).
      for (const cb of hostContextCallbacks) cb(currentHostContext);

      transport.send(INITIALIZED_METHOD, {});

      keyboard = new KeyboardForwarder(transport, forwardKeys);
    });

  // Listen for host context changes (ext-apps spec). Notifications carry a
  // full snapshot of the host context, so we replace — never merge.
  const unsubHostContext = transport.onMessage(HOST_CONTEXT_CHANGED_METHOD, (params) => {
    currentHostContext = (params ?? {}) as McpUiHostContext;
    injectCssVariables(extractTheme(currentHostContext).tokens);
    for (const cb of hostContextCallbacks) cb(currentHostContext);
  });

  const hostContextCallbacks = new Set<(ctx: McpUiHostContext) => void>();
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

    async callToolAsTask<TInput = Record<string, unknown>, TOutput = unknown>(
      toolName: string,
      args?: TInput,
      options?: CallToolAsTaskOptions,
    ): Promise<TaskHandle<TOutput>> {
      return callToolAsTaskImpl<TOutput>(
        {
          transport,
          router: taskStatusRouter,
          getHostTasksCapability: () => hostTasksCapability,
          appName: name,
          internalApp: internal,
        },
        toolName,
        args,
        options,
      );
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

    getHostContext(): McpUiHostContext {
      return currentHostContext;
    },

    onHostContextChanged(callback: (ctx: McpUiHostContext) => void): () => void {
      hostContextCallbacks.add(callback);
      return () => {
        hostContextCallbacks.delete(callback);
      };
    },

    getTheme(): SynapseTheme {
      return extractTheme(currentHostContext);
    },

    // Selector over `onHostContextChanged`: only fires when the *derived*
    // theme actually changes, so theme subscribers don't see spurious
    // updates when other host-context fields (e.g. workspace) change.
    //
    // Subscriber timing matters:
    //  - Subscribed BEFORE handshake: `prev = null` sentinel. The first
    //    fire (the handshake dispatch) always invokes the callback,
    //    even if the host's theme happens to derive to the default.
    //    Otherwise consumers using `onThemeChanged` as their init
    //    signal would silently miss it.
    //  - Subscribed AFTER handshake: `prev` is pre-seeded with the
    //    current derived theme, so a workspace-only `host-context-changed`
    //    notification correctly filters as a no-op.
    onThemeChanged(callback: (theme: SynapseTheme) => void): () => void {
      let prev: SynapseTheme | null = hostInfo !== null ? extractTheme(currentHostContext) : null;
      const wrapped = (ctx: McpUiHostContext) => {
        const next = extractTheme(ctx);
        if (prev !== null && themesEqual(prev, next)) return;
        prev = next;
        callback(next);
      };
      hostContextCallbacks.add(wrapped);
      return () => {
        hostContextCallbacks.delete(wrapped);
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

    downloadFile(filename: string, content: string | Blob, mimeType?: string): void {
      // Precedence: explicit mimeType arg > Blob's intrinsic type > octet-stream fallback.
      // Empty-string mimeType falls through (a "" MIME is effectively "no type").
      const resolvedMime =
        mimeType || (content instanceof Blob ? content.type : "") || "application/octet-stream";
      const blob = content instanceof Blob ? content : new Blob([content], { type: resolvedMime });
      transport.send("synapse/download-file", {
        data: blob,
        filename,
        mimeType: resolvedMime,
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
      // Method name `synapse/request-file` matches what the NimbleBrain
      // host bridge implements. Prior versions sent `synapse/pick-file`,
      // which the host never handled — the call would time out.
      const result = await transport.request("synapse/request-file", {
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
      const result = await transport.request("synapse/request-file", {
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

    get _hostTasksCapability(): TasksCapability | undefined | null {
      return hostTasksCapability;
    },

    destroy(): void {
      if (destroyed) return;
      destroyed = true;

      if (stateTimer) clearTimeout(stateTimer);
      keyboard?.destroy();
      unsubHostContext();
      unsubData();
      unsubAction();
      taskStatusRouter.dispose();
      hostContextCallbacks.clear();
      dataCallbacks.clear();
      actionCallbacks.clear();
      transport.destroy();
    },
  };

  return synapse;
}

/** Shallow equality for `SynapseTheme` — used by `onThemeChanged` to filter
 *  host-context changes that don't actually move the theme (e.g. a workspace
 *  switch that leaves theme/styles untouched). Cheap; tokens are ~40 entries. */
function themesEqual(a: SynapseTheme, b: SynapseTheme): boolean {
  if (a.mode !== b.mode || a.primaryColor !== b.primaryColor) return false;
  const aKeys = Object.keys(a.tokens);
  const bKeys = Object.keys(b.tokens);
  if (aKeys.length !== bKeys.length) return false;
  // Iterating only over `a`'s keys is sufficient: under equal length, any
  // key in `a` missing from `b` reads `b[k] === undefined`, which fails the
  // strict-inequality check. Symmetric difference is covered.
  for (const k of aKeys) {
    if (a.tokens[k] !== b.tokens[k]) return false;
  }
  return true;
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

import type { McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import type {
  CreateTaskResult,
  ReadResourceRequest,
  ReadResourceResult,
  Task,
  TaskStatus,
} from "@modelcontextprotocol/sdk/types.js";

// ---------- MCP Task Utility (spec 2025-11-25) ----------
//
// Re-exported from `@modelcontextprotocol/sdk/types.js` so consumers can
// reference spec-compliant task types without a second dependency. Never
// hand-roll these — the SDK is the source of truth; a rename upstream
// should surface here as a compile error.

export type { CreateTaskResult, Task, TaskStatus };

/**
 * Shape of the `tasks` capability advertised in `appCapabilities` on the
 * iframe side (and mirrored back by the host in `hostCapabilities.tasks`).
 *
 * Matches the MCP 2025-11-25 tasks utility: empty objects (`{}`) are used
 * as presence flags — NOT booleans — so future sub-fields can be added
 * without wire-format breaks.
 *
 * Shape sourced from the MCP SDK's `ServerTasksCapabilitySchema` /
 * `ClientCapabilities.tasks` contract. Defined locally as a plain
 * interface because the SDK publishes the shape only as a Zod schema,
 * not an exported TypeScript type — but the field names below are
 * identical to the spec and will fail compilation against any SDK-typed
 * consumer (e.g. `McpUiInitializeResult["hostCapabilities"]`) if they
 * drift.
 */
export interface TasksCapability {
  /** Present (as `{}`) if listing tasks is supported. Deferred for MVP. */
  list?: Record<string, never>;
  /** Present (as `{}`) if cancelling tasks is supported. */
  cancel?: Record<string, never>;
  /** Which request types may be task-augmented. */
  requests?: {
    tools?: {
      /** Present (as `{}`) if `tools/call` can be task-augmented. */
      call?: Record<string, never>;
    };
  };
}

/**
 * Options for task-augmenting a `tools/call` request per MCP 2025-11-25.
 *
 * The `task` object on `tools/call` params carries caller hints for task
 * creation. The receiver MAY override (e.g. a server may enforce a lower
 * TTL); clients read back the authoritative values from `CreateTaskResult.task`.
 */
export interface CallToolAsTaskOptions {
  /**
   * Hint for how long (in milliseconds) the receiver should retain task
   * results after a terminal status. Omit to let the receiver decide.
   * Per spec, `null` means unlimited lifetime — represented here as the
   * absence of the field (omit) since requestors rarely need to pin
   * "unlimited" explicitly.
   */
  ttl?: number;
  /**
   * Route the call through the internal-apps cross-server authz path
   * (adds `params.server` set to this app's name). External apps MUST
   * NOT pass this; spec doesn't touch it — it's a NimbleBrain-specific
   * bridge convention mirroring `callTool`'s behavior.
   */
  internal?: boolean;
}

/**
 * Handle returned by `synapse.callToolAsTask`. Lifecycle mirrors the MCP
 * 2025-11-25 tasks utility: the `tools/call` response is a
 * `CreateTaskResult` (accessible via `task`), and the caller separately
 * blocks for the terminal `CallToolResult` via `result()`.
 *
 * All operations route via the transport's message plumbing; no polling
 * is performed here — `result()` is a blocking `tasks/result` RPC. If
 * consumers want interstitial updates they can call `refresh()` or
 * subscribe to `onStatus` (which is OPTIONAL per spec — hosts MAY or
 * MAY NOT emit `notifications/tasks/status`).
 */
export interface TaskHandle<TOutput = unknown> {
  /**
   * Initial task state from the `CreateTaskResult` returned by
   * `tools/call`. Always populated before the handle is returned.
   */
  readonly task: Task;

  /**
   * Send `tasks/result { taskId }` and resolve once the receiver returns
   * the terminal payload. Per spec, the result shape is exactly what a
   * non-task `tools/call` would return — parsed here via the shared
   * `parseToolResult` so `_meta` (including
   * `io.modelcontextprotocol/related-task`) propagates through.
   */
  result(): Promise<ToolCallResult<TOutput>>;

  /**
   * Send `tasks/get { taskId }` and resolve with the current `Task`.
   * Non-blocking — returns whatever status the receiver holds right now.
   */
  refresh(): Promise<Task>;

  /**
   * Send `tasks/cancel { taskId }` and resolve with the final `Task`
   * (expected `status: "cancelled"`). Cancelling an already-terminal
   * task surfaces the receiver's `-32602` error.
   */
  cancel(): Promise<Task>;

  /**
   * Subscribe to `notifications/tasks/status` events scoped to this
   * handle's `taskId`. Returns an unsubscribe. Spec: status
   * notifications are OPTIONAL; consumers MUST NOT depend on them for
   * correctness.
   */
  onStatus(cb: (task: Task) => void): () => void;
}

// Re-export so SDK consumers can type host-context reads without a separate
// dependency on `@modelcontextprotocol/ext-apps`.
export type { McpUiHostContext };

// ---------- Core ----------

export interface SynapseOptions {
  /** App name — must match the bundle name registered with the host */
  name: string;
  /** Semver version string */
  version: string;
  /**
   * Mark as internal NimbleBrain app. Enables cross-server tool calls.
   * External apps MUST NOT set this.
   */
  internal?: boolean;
  /** Key combos to forward from iframe to host. Default: all Ctrl/Cmd combos + Escape. */
  forwardKeys?: KeyForwardConfig[];
}

export interface SynapseTheme {
  mode: "light" | "dark";
  primaryColor: string;
  tokens: Record<string, string>;
}

export interface DataChangedEvent {
  source: "agent";
  server: string;
  tool: string;
}

// ---------- Agent Actions ----------

/**
 * Built-in action types that Synapse handles natively.
 *
 * - `navigate` — select/focus a resource in the UI (e.g., a board, document, record)
 * - `notify`   — display a transient message (toast/banner)
 * - `refresh`  — force a full data refresh (heavier than datachanged)
 * - `confirm`  — request user confirmation before the agent proceeds
 *
 * Apps may also receive custom string types for domain-specific actions.
 */
export type BuiltinActionType = "navigate" | "notify" | "refresh" | "confirm";

/**
 * A typed, declarative action sent from the agent/server to the UI.
 *
 * Actions are deterministic side effects of tool execution — the tool decides
 * what action to emit, not the LLM. The UI decides how to handle it.
 *
 * This mirrors Studio's ClientAction pattern, adapted for iframe postMessage.
 */
export interface AgentAction<TPayload = Record<string, unknown>> {
  /** Discriminator — a BuiltinActionType or custom string. */
  type: BuiltinActionType | (string & {});
  /** Typed payload — shape depends on `type`. */
  payload: TPayload;
  /** If true, the UI should confirm with the user before executing. */
  requiresConfirmation?: boolean;
  /** Human-readable label for confirmation dialogs or logs. */
  label?: string;
}

/** Payload for the built-in "navigate" action. */
export interface NavigatePayload {
  /** Entity type (e.g., "board", "document", "task"). */
  entity: string;
  /** Entity ID to select/focus. */
  id: string;
  /** Optional sub-view or section within the entity. */
  view?: string;
}

/** Payload for the built-in "notify" action. */
export interface NotifyPayload {
  message: string;
  level?: "info" | "success" | "warning" | "error";
}

export interface ToolCallResult<T = unknown> {
  data: T;
  isError: boolean;
  /** Raw MCP content blocks from the tool response. */
  content?: unknown[];
  /**
   * `_meta` field from the underlying `CallToolResult`, passed through
   * unchanged. Notably carries `io.modelcontextprotocol/related-task`
   * (`{ taskId }`) on task-augmented results per MCP 2025-11-25.
   *
   * Key-preserving: any `_meta` entry the host/server attaches propagates
   * without explicit support here. Consumers reading known keys should
   * reference the canonical key names (e.g. `RELATED_TASK_META_KEY` from
   * `@modelcontextprotocol/sdk/types.js`).
   */
  _meta?: { [key: string]: unknown };
}

/** Result from a file picker request */
export interface FileResult {
  filename: string;
  mimeType: string;
  size: number;
  base64Data: string;
}

/** Options for requesting a file from the user */
export interface RequestFileOptions {
  /** File type filter (e.g., ".csv,.json", "image/*") */
  accept?: string;
  /** Max file size in bytes. Default: 25 MB */
  maxSize?: number;
  /** Allow multiple file selection. Default: false */
  multiple?: boolean;
}

export interface Synapse {
  readonly ready: Promise<void>;
  readonly isNimbleBrainHost: boolean;

  callTool<TInput = Record<string, unknown>, TOutput = unknown>(
    name: string,
    args?: TInput,
  ): Promise<ToolCallResult<TOutput>>;

  /**
   * Task-augmented variant of `callTool` per MCP 2025-11-25. Sends
   * `tools/call` with a `task` param; the receiver returns a
   * `CreateTaskResult` promptly and the actual `CallToolResult` lands
   * via `tasks/result`. Returns a `TaskHandle` that exposes
   * `result()`/`refresh()`/`cancel()`/`onStatus()`.
   *
   * Throws if the host did not advertise `tasks.requests.tools.call` in
   * its init-response capabilities — requestors MUST NOT task-augment
   * without matching receiver capability.
   */
  callToolAsTask<TInput = Record<string, unknown>, TOutput = unknown>(
    name: string,
    args?: TInput,
    options?: CallToolAsTaskOptions,
  ): Promise<TaskHandle<TOutput>>;

  /**
   * Read an MCP resource from the originating server via the host bridge
   * (ext-apps `resources/read`).
   *
   * Use this to resolve `resource_link` content blocks returned by tools, or
   * to fetch any known resource URI exposed by the MCP server. The host
   * proxies the request to the server and forwards the result unchanged.
   *
   * @param uri The resource URI (e.g. `"videos://bunny-1mb"`).
   * @returns The server's `ReadResourceResult` — `contents` is an array of
   *   blocks, each with a `uri`, optional `mimeType`, and either `text` or
   *   `blob` (base64).
   */
  readResource(uri: string): Promise<ReadResourceResult>;

  onDataChanged(callback: (event: DataChangedEvent) => void): () => void;

  /**
   * Subscribe to agent actions — typed, declarative commands from the server.
   *
   * Actions are deterministic side effects of tool execution. The server/tool
   * decides what action to emit; the UI decides how to handle it.
   *
   * The callback receives an AgentAction with a `type` discriminator and typed
   * `payload`. Apps should handle known types and ignore unknown ones.
   */
  onAction(callback: (action: AgentAction) => void): () => void;

  /**
   * Read the current ext-apps host context as last received from the host.
   *
   * Spec-standardized fields (`theme`, `styles`, `displayMode`, `toolInfo`)
   * are typed; the open `[key: string]: unknown` allows hosts to publish
   * extensions (e.g. NimbleBrain populates `workspace`). Apps reading
   * host-specific fields should treat them as optional and tolerate
   * missing values when running on other hosts.
   *
   * Returns the empty object before the `ui/initialize` handshake completes.
   */
  getHostContext(): McpUiHostContext;

  /**
   * Subscribe to host-context updates. Fires once per
   * `ui/notifications/host-context-changed` notification (which carries a
   * full snapshot, not a delta) and once on handshake completion.
   *
   * `getTheme`/`onThemeChanged` are typed selectors over this same state —
   * prefer them when only theming matters, since they filter no-op fires.
   */
  onHostContextChanged(callback: (ctx: McpUiHostContext) => void): () => void;

  getTheme(): SynapseTheme;
  onThemeChanged(callback: (theme: SynapseTheme) => void): () => void;

  /** NimbleBrain-only: trigger a host-side action. No-op in other hosts. */
  action(action: string, params?: Record<string, unknown>): void;

  /**
   * Send a user message into the agent conversation (ext-apps `ui/message`).
   *
   * @param context NimbleBrain-specific metadata, included as `_meta.context`
   *   on the content block. Ignored by non-NimbleBrain hosts.
   */
  chat(message: string, context?: { action?: string; entity?: string }): void;

  /**
   * Push the app's current visible state to the agent (ext-apps `ui/update-model-context`).
   *
   * The `summary` string is what the LLM reads as a text content block.
   * The `state` object is included as `structuredContent` for tools that need IDs/values.
   * Debounced at 250ms. Each call overwrites the previous context.
   */
  setVisibleState(state: Record<string, unknown>, summary?: string): void;

  downloadFile(filename: string, content: string | Blob, mimeType?: string): void;
  openLink(url: string): void;

  /**
   * Request a file from the user via the host's native file picker.
   * NimbleBrain-only: throws in non-NimbleBrain hosts.
   * Returns null if the user cancels.
   */
  pickFile(options?: RequestFileOptions): Promise<FileResult | null>;

  /**
   * Pick multiple files from the user.
   * NimbleBrain-only: throws in non-NimbleBrain hosts.
   * Returns empty array if the user cancels.
   */
  pickFiles(options?: RequestFileOptions): Promise<FileResult[]>;

  /** @internal — used by createStore for synapse/state-loaded */
  _onMessage(
    method: string,
    callback: (params: Record<string, unknown> | undefined) => void,
  ): () => void;

  /** @internal — used by createStore for synapse/persist-state */
  _request(method: string, params?: Record<string, unknown>): Promise<unknown>;

  /**
   * @internal — host's declared `tasks` capability from the `ui/initialize`
   * response, or `undefined` if absent. Read by the task-augmented tool call
   * path (future `callToolAsTask`) to decide whether task augmentation is
   * negotiated. `null` before the handshake completes.
   *
   * Requestors MUST NOT task-augment a tool call unless this is defined and
   * carries `requests.tools.call` per MCP 2025-11-25.
   */
  readonly _hostTasksCapability: TasksCapability | undefined | null;

  /** True after destroy() has been called. */
  readonly destroyed: boolean;

  destroy(): void;
}

// ---------- LLM-Aware State ----------

export interface VisibleState {
  state: Record<string, unknown>;
  summary?: string;
}

export interface StateAcknowledgement {
  truncated: boolean;
}

// ---------- Widget State Store ----------

export type ActionReducer<TState, TPayload = unknown> = (
  state: TState,
  payload: TPayload,
) => TState;

export interface StoreConfig<TState> {
  initialState: TState;
  actions: Record<string, ActionReducer<TState, any>>;
  persist?: boolean;
  visibleToAgent?: boolean;
  summarize?: (state: TState) => string;
  version?: number;
  migrations?: Array<(oldState: any) => any>;
}

export type StoreDispatch<TActions extends Record<string, ActionReducer<any, any>>> = {
  [K in keyof TActions]: Parameters<TActions[K]>[1] extends undefined
    ? () => void
    : (payload: Parameters<TActions[K]>[1]) => void;
};

export interface Store<
  TState,
  TActions extends Record<string, ActionReducer<TState, any>> = Record<
    string,
    ActionReducer<TState, any>
  >,
> {
  getState(): TState;
  subscribe(callback: (state: TState) => void): () => void;
  dispatch: StoreDispatch<TActions>;
  hydrate(state: TState): void;
  destroy(): void;
}

// ---------- Keyboard Forwarding ----------

export interface KeyForwardConfig {
  key: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  alt?: boolean;
}

// ---------- Transport (internal) ----------

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
  id?: string;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcResponse | JsonRpcNotification;

// ---------- Codegen ----------

export interface ToolDefinition {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
}

// ---------- Host Detection ----------

export interface HostInfo {
  isNimbleBrain: boolean;
  serverName: string;
  protocolVersion: string;
}

// ---------- Connect API ----------

export interface ConnectOptions {
  name: string;
  version: string;
  autoResize?: boolean;
  /** Pre-register event handlers before the handshake completes.
   *  These are wired before `initialized` is sent, so no messages are lost. */
  on?: Record<string, (data: any) => void>;
}

export interface Theme {
  mode: "light" | "dark";
  tokens: Record<string, string>;
}

export interface Dimensions {
  width?: number;
  height?: number;
  maxWidth?: number;
  maxHeight?: number;
}

export interface ToolResultData {
  content: unknown;
  structuredContent: unknown;
  raw: Record<string, unknown>;
}

/** Known short event names for App.on() */
export type AppEventName =
  | "tool-result"
  | "tool-input"
  | "tool-input-partial"
  | "tool-cancelled"
  | "theme-changed"
  | "teardown";

export interface App {
  readonly theme: Theme;
  readonly hostInfo: { name: string; version: string };
  readonly toolInfo: { tool: Record<string, unknown> } | null;
  readonly containerDimensions: Dimensions | null;

  on(event: "tool-input", handler: (args: Record<string, unknown>) => void): () => void;
  on(event: "tool-result", handler: (data: ToolResultData) => void): () => void;
  on(event: "theme-changed", handler: (theme: Theme) => void): () => void;
  on(event: "teardown", handler: () => void): () => void;
  on(event: string, handler: (params: unknown) => void): () => void;

  resize(width?: number, height?: number): void;
  openLink(url: string): void;
  updateModelContext(state: Record<string, unknown>, summary?: string): void;
  callTool(name: string, args?: Record<string, unknown>): Promise<ToolCallResult>;
  /**
   * Read an MCP resource from the originating server via the host bridge
   * (ext-apps `resources/read`). Named to mirror the ext-apps spec's
   * `App.readServerResource`.
   */
  readServerResource(params: ReadResourceRequest["params"]): Promise<ReadResourceResult>;
  sendMessage(text: string, context?: { action?: string; entity?: string }): void;

  /**
   * @internal — host's declared `tasks` capability from the `ui/initialize`
   * response, or `undefined` if absent. Read by the task-augmented tool call
   * path (future `callToolAsTask`) to decide whether task augmentation is
   * negotiated. Per MCP 2025-11-25, requestors MUST NOT task-augment without
   * matching receiver capability.
   */
  readonly _hostTasksCapability: TasksCapability | undefined;

  destroy(): void;
}

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

// ---------- Theme ----------

/**
 * One `@font-face` a host asks the app to load.
 *
 * The token contract can name a font (`--font-sans: 'Hanken Grotesk', system-ui`)
 * but cannot *load* one — a CSS custom property carries a family name, never the
 * `@font-face` rule behind it. An app iframe is its own document and inherits no
 * `@font-face` from the host page, so a host that only sends tokens is naming a
 * family the app has no way to render. This descriptor is the missing half.
 *
 * The SDK ships **no font data** — it applies what the host sends. A host that
 * sends none leaves the web-safe fallbacks in `ui/tokens.ts` in force.
 */
export interface FontFaceDescriptor {
  /** Family name, matching the one used in the host's `--font-*` token value. */
  family: string;
  /**
   * CSS `src` descriptor. Local and absolute URLs work identically —
   * `url('/fonts/x.woff2') format('woff2')` or `url('https://cdn.example/x.woff2')`.
   * Whatever origin this names must satisfy the app iframe's `font-src` CSP.
   */
  src: string;
  /** `font-weight` descriptor — a single weight (`400`) or a variable range (`400 700`). */
  weight?: string;
  /** `font-style` descriptor (`normal`, `italic`, …). */
  style?: string;
  /** `font-display` descriptor. Defaults to `swap` so text paints in the fallback first. */
  display?: FontDisplayValue;
}

/** The CSS `font-display` values. Closed set — anything else is ignored. */
export type FontDisplayValue = "auto" | "block" | "swap" | "fallback" | "optional";

export interface Theme {
  mode: "light" | "dark";
  tokens: Record<string, string>;
  /**
   * Font faces the host wants loaded into the app document. Optional — a host
   * that omits them leaves the web-safe fallbacks in force. Arrives over the
   * wire as the `synapse/fontFaces` host-context extension.
   */
  fontFaces?: FontFaceDescriptor[];
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

/**
 * Result from a file picker request. Returned after the host has
 * persisted the picked file to its workspace store; the bytes never
 * cross the iframe boundary.
 *
 * Tools that need the bytes look the file up by `id` (e.g. by passing
 * it to a tool that calls the host's file APIs server-side). Bytes
 * inline in tool-call arguments was the prior shape and capped uploads
 * at the JSON body limit; this `id`-shaped result removes that ceiling.
 */
export interface FileResult {
  /** Workspace file ID (`fl_` + 24 hex). Stable identifier for this
   *  file in the originating workspace. */
  id: string;
  filename: string;
  mimeType: string;
  size: number;
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

// ---------- Agent-facing state ----------

/** What `useModelContext`'s declarative factory returns. */
export interface ModelContext {
  /** Structured state the agent's tools can read ids and values out of. */
  state: Record<string, unknown>;
  /** The one line the model actually reads. */
  summary?: string;
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
  /** App name — must match the bundle name registered with the host. */
  name: string;
  /** Semver version string. */
  version: string;
  /** Track the document height and re-send `size-changed` as it moves. */
  autoResize?: boolean;
  /**
   * Mark as an internal NimbleBrain app. Enables cross-server tool calls:
   * `callTool` carries a `server` param so the host can route the call to a
   * sibling server. External apps MUST NOT set this.
   */
  internal?: boolean;
  /**
   * Forward keyboard shortcuts from this iframe up to the host, so the host's
   * own shortcuts still fire while focus is inside the app.
   *
   * `true` forwards the default set (Escape plus every Ctrl/Cmd combo except
   * the clipboard keys the browser must handle itself); an array forwards
   * exactly the listed combos. Absent means no forwarding.
   *
   * Only a NimbleBrain host consumes `synapse/keydown`, so forwarding stays
   * off everywhere else — a `preventDefault` on a host that does nothing with
   * the key would swallow it for no one's benefit.
   */
  forwardKeys?: boolean | KeyForwardConfig[];
  /** Pre-register event handlers before the handshake completes.
   *  These are wired before `initialized` is sent, so no messages are lost. */
  on?: Record<string, (data: any) => void>;
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

/** Per-call overrides for {@link App.callTool}. */
export interface CallToolOptions {
  /**
   * Route the call to a sibling MCP server rather than the app's own.
   * Internal apps only — the host rejects it otherwise. Defaults to this
   * app's name when `connect({ internal: true })` was used, which is what
   * makes a plain `callTool` work for an internal app.
   */
  server?: string;
}

/** Known short event names for {@link App.on}. */
export type AppEventName =
  | "tool-result"
  | "tool-input"
  | "tool-input-partial"
  | "tool-cancelled"
  | "theme-changed"
  | "host-context-changed"
  | "data-changed"
  | "action"
  | "teardown";

/**
 * The plumbing the SDK's own composable helpers reach through — the file
 * picker, `action`, `downloadFile`, `callToolAsTask`. It lets those live
 * *beside* `App` instead of on it: every one would otherwise be another method
 * on the object, and the point of this API is that the object stays small.
 *
 * Not reachable from an `App`. It is held in a module-private `WeakMap` (see
 * `internals.ts`) so the public type stays the protocol surface — this
 * interface is exported only because the helpers are in sibling modules.
 *
 * @internal The transport, not the protocol. Anything here can change in a
 * patch release.
 */
export interface AppInternals {
  /** Send a JSON-RPC notification. */
  send(method: string, params?: Record<string, unknown>): void;
  /** Send a JSON-RPC request and resolve with its result. */
  request(method: string, params?: Record<string, unknown>): Promise<unknown>;
  /** Subscribe to a raw inbound method. */
  onMessage(
    method: string,
    handler: (params: Record<string, unknown> | undefined) => void,
  ): () => void;
  /** Route `notifications/tasks/status` to the handle that owns each taskId. */
  readonly taskRouter: TaskStatusRouter;
  /**
   * The host's declared `tasks` capability from the `ui/initialize` response.
   * `undefined` when the host advertised none. Requestors MUST NOT
   * task-augment a call unless this carries `requests.tools.call`.
   */
  readonly hostTasksCapability: TasksCapability | undefined;
  /** App name, as sent in `appInfo` — the `server` an internal call defaults to. */
  readonly appName: string;
  /** Whether `connect()` was given `internal: true`. */
  readonly internalApp: boolean;
}

/**
 * Routes `notifications/tasks/status` to the handle that owns each taskId.
 * Implemented in `task-handle.ts`; declared here so `AppInternals` can name
 * it without the types module importing the implementation.
 */
export interface TaskStatusRouter {
  subscribe(taskId: string, cb: (update: TaskStatusUpdate) => void): () => void;
  dispose(): void;
}

/** The fields the spec guarantees on a `notifications/tasks/status`. */
export interface TaskStatusUpdate {
  taskId: string;
  status: TaskStatus;
  statusMessage?: string;
}

/**
 * A connected app — what `connect()` resolves to, and the only runtime object
 * this SDK hands out.
 *
 * Deliberately small: it carries the ext-apps spec surface plus the state the
 * handshake established. NimbleBrain's own extensions (the file picker,
 * `action`, `downloadFile`) and the MCP tasks utility are composable functions
 * over this object rather than more methods on it.
 */
export interface App {
  readonly theme: Theme;
  readonly hostInfo: { name: string; version: string };
  readonly toolInfo: { tool: Record<string, unknown> } | null;
  readonly containerDimensions: Dimensions | null;
  /**
   * The full ext-apps host context as last received. Spec fields (`theme`,
   * `styles`, `displayMode`, `toolInfo`) are typed; the open index signature
   * carries host extensions — NimbleBrain publishes `workspace` here. Read
   * host-specific fields as optional; another host will not send them.
   */
  readonly hostContext: McpUiHostContext;
  /** True when the host identified itself as NimbleBrain in the handshake. */
  readonly isNimbleBrainHost: boolean;
  /** True after `destroy()` has been called. */
  readonly destroyed: boolean;
  /**
   * Whether the host negotiated the MCP tasks utility for `tools/call`.
   *
   * `callToolAsTask` throws when this is false — per MCP 2025-11-25 a
   * requestor MUST NOT task-augment a call the receiver did not advertise. Read
   * it to decide whether to offer a long-running action at all, rather than to
   * discover the answer from an exception.
   */
  readonly supportsTasks: boolean;

  on(event: "tool-input", handler: (args: Record<string, unknown>) => void): () => void;
  on(event: "tool-result", handler: (data: ToolResultData) => void): () => void;
  on(event: "theme-changed", handler: (theme: Theme) => void): () => void;
  on(event: "host-context-changed", handler: (ctx: McpUiHostContext) => void): () => void;
  on(event: "data-changed", handler: (event: DataChangedEvent) => void): () => void;
  on(event: "action", handler: (action: AgentAction) => void): () => void;
  on(event: "teardown", handler: () => void): () => void;
  on(event: string, handler: (params: any) => void): () => void;

  resize(width?: number, height?: number): void;
  openLink(url: string): void;
  /**
   * Push the app's visible state to the agent (ext-apps
   * `ui/update-model-context`). `summary` is what the model reads as text;
   * `state` rides along as `structuredContent` for tools that need the ids.
   *
   * Sends immediately. Callers that push on every keystroke or selection
   * change want `useModelContext`, which debounces.
   */
  updateModelContext(state: Record<string, unknown>, summary?: string): void;
  callTool<TOutput = unknown>(
    name: string,
    args?: Record<string, unknown>,
    options?: CallToolOptions,
  ): Promise<ToolCallResult<TOutput>>;
  /**
   * Read an MCP resource from the originating server via the host bridge
   * (ext-apps `resources/read`). Named to mirror the ext-apps spec's
   * `App.readServerResource`.
   */
  readServerResource(params: ReadResourceRequest["params"]): Promise<ReadResourceResult>;
  /** Send a user message into the agent conversation (ext-apps `ui/message`). */
  sendMessage(text: string, context?: { action?: string; entity?: string }): void;
  destroy(): void;
}

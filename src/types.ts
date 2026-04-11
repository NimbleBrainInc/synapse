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

  saveFile(filename: string, content: string | Blob, mimeType?: string): void;
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
  theme: SynapseTheme;
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
  sendMessage(text: string, context?: { action?: string; entity?: string }): void;
  destroy(): void;
}

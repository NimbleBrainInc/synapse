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

  downloadFile(filename: string, content: string | Blob, mimeType?: string): void;
  openLink(url: string): void;

  /** @internal — used by createStore for ui/stateLoaded */
  _onMessage(
    method: string,
    callback: (params: Record<string, unknown> | undefined) => void,
  ): () => void;

  /** @internal — used by createStore for ui/persistState */
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

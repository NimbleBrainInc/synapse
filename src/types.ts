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

  getTheme(): SynapseTheme;
  onThemeChanged(callback: (theme: SynapseTheme) => void): () => void;

  action(action: string, params?: Record<string, unknown>): void;
  chat(
    message: string,
    context?: { action?: string; entity?: string },
  ): void;

  setVisibleState(
    state: Record<string, unknown>,
    summary?: string,
  ): void;

  downloadFile(
    filename: string,
    content: string | Blob,
    mimeType?: string,
  ): void;
  openLink(url: string): void;

  /** @internal — used by createStore for ui/stateLoaded */
  _onMessage(
    method: string,
    callback: (params: Record<string, unknown> | undefined) => void,
  ): () => void;

  /** @internal — used by createStore for ui/persistState */
  _request(method: string, params?: Record<string, unknown>): Promise<unknown>;

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
  TActions extends Record<string, ActionReducer<TState, any>> = Record<string, ActionReducer<TState, any>>,
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

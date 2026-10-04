import type {
  ReadResourceRequest,
  ReadResourceResult,
  Task,
  TaskStatus,
} from "@modelcontextprotocol/client";
import type { McpUiHostCapabilities, McpUiHostContext } from "@modelcontextprotocol/ext-apps";

// ---------- MCP tasks extension (`io.modelcontextprotocol/tasks`, 2026-07-28) ----------
//
// `Task` and `TaskStatus` are re-exported from `@modelcontextprotocol/client`
// so consumers can type task state without a second dependency. A handle maps
// the extension's wire fields onto them: `ttlMs` → `ttl` (`null` when the host
// names none) and `pollIntervalMs` → `pollInterval`.

export type { Task, TaskStatus };

/**
 * The host's declaration of the MCP tasks extension, read from
 * `hostCapabilities.experimental["io.modelcontextprotocol/tasks"]` (see
 * `readHostTasksCapability`). Presence is the signal: the extension defines no
 * settings, so a host declares `{}`.
 */
export type TasksCapability = Record<string, unknown>;

/** Options for {@link TaskHandle.result}. */
export interface TaskResultOptions {
  /**
   * Stops waiting when aborted: polling ends and `result()` rejects with the
   * signal's reason. The task itself keeps running; call `cancel()` to end it.
   */
  signal?: AbortSignal;
}

/**
 * Handle returned by `callToolAsTask`. The server either answered the call
 * outright, and the handle's task is already `completed`, or it is running the
 * call as a task, which the handle follows through `tasks/get`.
 */
export interface TaskHandle<TOutput = unknown> {
  /**
   * The task as the server first reported it. For a call answered outright,
   * a `completed` task under an id no host issued.
   */
  readonly task: Task;

  /**
   * Resolve with the tool's result once the task completes, polling
   * `tasks/get` at the task's `pollInterval` (2 s when it names none, never
   * under 250 ms). The result is parsed the way `app.callTool` parses one.
   *
   * Rejects with `TaskError` when the task fails (carrying the host's error),
   * is cancelled, or asks for input: this SDK cannot answer an input request,
   * so it cancels the task first. A failed poll is retried; it rejects with
   * the poll's error after three in a row, or at once on `-32602` (unknown
   * task).
   */
  result(options?: TaskResultOptions): Promise<ToolCallResult<TOutput>>;

  /** Send one `tasks/get` and resolve with the task's current state. */
  refresh(): Promise<Task>;

  /**
   * Send `tasks/cancel`, then resolve with the task's state from one
   * `tasks/get`, or with the last state seen if that `tasks/get` fails.
   * Rejects only when `tasks/cancel` fails. A no-op for a call answered
   * outright.
   */
  cancel(): Promise<Task>;

  /**
   * Subscribe to status changes this handle observes, from `result()`'s polls
   * and from `refresh()` and `cancel()`. Nothing is pushed by the host, so a
   * handle nobody polls reports nothing. Returns an unsubscribe.
   */
  onStatus(cb: (task: Task) => void): () => void;
}

// Re-export so SDK consumers can type host-context reads without a separate
// dependency on `@modelcontextprotocol/ext-apps`.
export type { McpUiHostContext };

// ---------- Theme ----------

export interface Theme {
  mode: "light" | "dark";
  tokens: Record<string, string>;
}

export interface ToolCallResult<T = unknown> {
  data: T;
  isError: boolean;
  /** Raw MCP content blocks from the tool response. */
  content?: unknown[];
  /**
   * `_meta` field from the underlying `CallToolResult`, passed through
   * unchanged. Key-preserving: any `_meta` entry the host or server attaches
   * propagates without explicit support here.
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

/**
 * One level of an app's trail, for `setLocation` / `useTrail`.
 *
 * `id` is the view's stable address: the MCP resource URI of what it shows when
 * there is one (`people://contacts/123`), otherwise a path-like address of the
 * app's own, never a value that changes between visits such as a list index.
 * The host hands it back unread when the user picks that level, and refuses a
 * trail with an `id` over 512 characters. `label` is what the host shows, 1 to
 * 200 characters; `setLocation` sends an empty one as "…".
 */
export interface TrailEntry {
  id: string;
  label: string;
}

/** How much a notice matters: its colour, how long it stays, how it is announced. */
export type NoticeLevel = "success" | "info" | "warning" | "error";

/** A notice for the host to show, labelled with this app. */
export interface Notice {
  level: NoticeLevel;
  /** 1–120 characters. */
  title: string;
  /** Up to 500 characters. */
  description?: string;
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

export interface UploadFilesOptions {
  /** Max file size in bytes. Default: 25 MB. The host's own limit wins when lower. */
  maxSize?: number;
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

// ---------- Codegen ----------

export interface ToolDefinition {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
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
   * Forward keyboard shortcuts from this iframe up to the host, so the host's
   * own shortcuts still fire while focus is inside the app.
   *
   * `true` forwards the default set (Escape plus every Ctrl/Cmd combo except
   * the clipboard keys the browser must handle itself); an array forwards
   * exactly the listed combos. Absent means no forwarding.
   *
   * Forwarding is on only where the host declares `ai.nimblebrain/keydown`, and
   * stays off everywhere else — a `preventDefault` on a host that does nothing with
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

/** Known short event names for {@link App.on}. */
export type AppEventName =
  | "tool-result"
  | "tool-input"
  | "tool-input-partial"
  | "tool-cancelled"
  | "theme-changed"
  | "host-context-changed"
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
  /**
   * The host's declaration of the MCP tasks extension, from the
   * `ui/initialize` response. `undefined` when the host declared none, and
   * `callToolAsTask` then refuses to send.
   */
  readonly hostTasksCapability: TasksCapability | undefined;
}

/**
 * A connected app — what `connect()` resolves to, and the only runtime object
 * this SDK hands out.
 *
 * Deliberately small: it carries the ext-apps spec surface plus the state the
 * handshake established. NimbleBrain's own extensions (the file picker,
 * `action`), `downloadFile` and the MCP tasks extension are composable functions
 * over this object rather than more methods on it.
 */
export interface App {
  readonly theme: Theme;
  readonly hostInfo: { name: string; version: string };
  readonly toolInfo: { tool: Record<string, unknown> } | null;
  readonly containerDimensions: Dimensions | null;
  /**
   * The current host context: the handshake's, with every
   * `host-context-changed` delta merged into it. Spec fields (`theme`,
   * `styles`, `displayMode`, `toolInfo`) are typed; the open index signature
   * carries host extensions — NimbleBrain publishes `workspace` here. Read
   * host-specific fields as optional; another host will not send them.
   */
  readonly hostContext: McpUiHostContext;
  /**
   * What the host declared it supports, from the `ui/initialize` result. Every
   * method here and every helper beside it checks this before it sends, and
   * degrades in a documented way when the capability is absent. Read it to
   * decide what to offer at all, rather than to find out from a no-op or an
   * exception. NimbleBrain extensions are declared under `experimental`; see
   * `hostSupports`.
   */
  readonly hostCapabilities: McpUiHostCapabilities;
  /**
   * True when the host identified itself as NimbleBrain in the handshake.
   * Identity, not capability: nothing is gated on it.
   */
  readonly isNimbleBrainHost: boolean;
  /** True after `destroy()` has been called. */
  readonly destroyed: boolean;
  /**
   * Whether the host declared the MCP tasks extension
   * (`io.modelcontextprotocol/tasks`).
   *
   * `callToolAsTask` throws when this is false, without sending. Read
   * it to decide whether to offer a long-running action at all, rather than to
   * discover the answer from an exception.
   */
  readonly supportsTasks: boolean;

  on(event: "tool-input", handler: (args: Record<string, unknown>) => void): () => void;
  on(event: "tool-result", handler: (data: ToolResultData) => void): () => void;
  on(event: "theme-changed", handler: (theme: Theme) => void): () => void;
  /** Fires with the merged snapshot — the same value as `hostContext`. For the
   *  notification exactly as sent, subscribe to the wire method instead:
   *  `on("ui/notifications/host-context-changed", …)`. */
  on(event: "host-context-changed", handler: (ctx: McpUiHostContext) => void): () => void;
  on(event: "teardown", handler: () => void): () => void;
  on(event: string, handler: (params: any) => void): () => void;

  /** Report the frame's size (`ui/notifications/size-changed`). Every host accepts it. */
  resize(width?: number, height?: number): void;
  /**
   * Open a URL through the host (`ui/open-link`). Without `openLinks`, or when
   * the host refuses, opens it with `window.open` instead.
   */
  openLink(url: string): void;
  /**
   * Push the app's visible state to the agent (ext-apps
   * `ui/update-model-context`). `summary` is what the model reads as text;
   * `state` rides along as `structuredContent` for tools that need the ids.
   *
   * Sends immediately. Callers that push on every keystroke or selection
   * change want `useModelContext`, which debounces. A no-op when the host did
   * not declare `updateModelContext`.
   */
  updateModelContext(state: Record<string, unknown>, summary?: string): void;
  /**
   * Call a tool on this app's own MCP server.
   *
   * An app reaches its own server and nothing else. A host scopes every call
   * to the server that mounted the app, so there is no target to name and no
   * option to pass — cross-source work belongs to the agent, which can call
   * two servers and hand one's result to the other.
   *
   * Rejects with `HostCapabilityError`, without sending, when the host did not
   * declare `serverTools`.
   */
  callTool<TOutput = unknown>(
    name: string,
    args?: Record<string, unknown>,
  ): Promise<ToolCallResult<TOutput>>;
  /**
   * Read an MCP resource from the originating server via the host bridge
   * (ext-apps `resources/read`). Named to mirror the ext-apps spec's
   * `App.readServerResource`.
   *
   * Rejects with `HostCapabilityError`, without sending, when the host did not
   * declare `serverResources`.
   */
  readServerResource(params: ReadResourceRequest["params"]): Promise<ReadResourceResult>;
  /**
   * Send a user message into the agent conversation (ext-apps `ui/message`).
   * A no-op when the host did not declare `message`. To tell the agent what
   * the user is acting on, call `updateModelContext` first.
   */
  sendMessage(text: string): void;
  destroy(): void;
}

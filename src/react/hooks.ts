import type {
  ResourceListChangedNotification,
  Task,
  TaskStatus,
} from "@modelcontextprotocol/client";
import type { McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import { useCallback, useEffect, useRef, useState } from "react";
import { TaskError } from "../errors.js";
import { RESOURCE_LIST_CHANGED_METHOD } from "../event-map.js";
import {
  hostSupports,
  notify,
  onNavigate,
  open,
  openConnectorSettings,
  pickFile,
  pickFiles,
  setLocation,
  uploadFiles,
} from "../extensions.js";
import { callToolAsTask } from "../task-handle.js";
import type {
  App,
  FileResult,
  ModelContext,
  Notice,
  RequestFileOptions,
  TaskHandle,
  Theme,
  ToolCallResult,
  ToolResultData,
  TrailEntry,
  UploadFilesOptions,
} from "../types.js";
import { useAppContext } from "./app-provider.js";

/** The connected app. Throws outside an `<AppProvider>`. */
export function useApp(): App {
  return useAppContext();
}

// -----------------------------------------------------------------------------
// Host state
// -----------------------------------------------------------------------------

/**
 * The current theme, re-rendering only when it actually moves.
 *
 * `App` filters `host-context-changed` notifications through a theme equality
 * check, so a context update that leaves the derived theme untouched (a
 * workspace switch, say) does not re-render every themed component.
 */
export function useTheme(): Theme {
  const app = useAppContext();
  const [theme, setTheme] = useState<Theme>(() => app.theme);

  useEffect(() => {
    // Sync in case the theme changed between render and effect.
    setTheme(app.theme);
    return app.on("theme-changed", setTheme);
  }, [app]);

  return theme;
}

/**
 * The full ext-apps host context — spec fields (`theme`, `styles`,
 * `displayMode`, `toolInfo`) plus whatever the host publishes alongside.
 * Re-renders on every `host-context-changed`.
 *
 * Prefer `useTheme()` when only theming matters: it filters no-op fires.
 * Reach for this one for host extensions, e.g. on NimbleBrain:
 *
 * ```tsx
 * const { workspace } = useHostContext<{ workspace?: { id: string } }>();
 * ```
 */
export function useHostContext<T extends McpUiHostContext = McpUiHostContext>(): T {
  const app = useAppContext();
  const [ctx, setCtx] = useState<T>(() => app.hostContext as T);

  useEffect(() => {
    setCtx(app.hostContext as T);
    return app.on("host-context-changed", (c) => setCtx(c as T));
  }, [app]);

  return ctx;
}

/**
 * The latest tool result pushed by the host, or `null` before one arrives. A
 * host that mounts the app without a tool call never sends one, so `null` is a
 * state to render, not only a loading state.
 */
export function useToolResult(): ToolResultData | null {
  const app = useAppContext();
  const [data, setData] = useState<ToolResultData | null>(null);

  useEffect(() => {
    return app.on("tool-result", setData);
  }, [app]);

  return data;
}

/** The arguments the host is calling the bound tool with, or `null` until it sends them. */
export function useToolInput(): Record<string, unknown> | null {
  const app = useAppContext();
  const [input, setInput] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    return app.on("tool-input", setInput);
  }, [app]);

  return input;
}

/** Report this app's frame size to the host. Every host accepts it; the spec has no capability for it. */
export function useResize(): (width?: number, height?: number) => void {
  const app = useAppContext();
  return useCallback((width?: number, height?: number) => app.resize(width, height), [app]);
}

// -----------------------------------------------------------------------------
// Tools
// -----------------------------------------------------------------------------

export interface UseCallToolResult<TOutput> {
  call: (args?: Record<string, unknown>) => Promise<ToolCallResult<TOutput>>;
  isPending: boolean;
  error: Error | null;
  data: TOutput | null;
}

/**
 * Call one tool, with pending/error/data state for the latest call.
 *
 * Where the host did not declare `serverTools`, `call` rejects with
 * `HostCapabilityError` without sending, and `error` holds it.
 */
export function useCallTool<TOutput = unknown>(toolName: string): UseCallToolResult<TOutput> {
  const app = useAppContext();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [data, setData] = useState<TOutput | null>(null);
  const callIdRef = useRef(0);

  const call = useCallback(
    async (args?: Record<string, unknown>): Promise<ToolCallResult<TOutput>> => {
      const id = ++callIdRef.current;
      setIsPending(true);
      setError(null);

      try {
        const result = await app.callTool<TOutput>(toolName, args);
        // Stale guard: only update if this is still the latest call.
        if (id === callIdRef.current) {
          setData(result.data);
          setIsPending(false);
        }
        return result;
      } catch (err) {
        if (id === callIdRef.current) {
          const e = err instanceof Error ? err : new Error(String(err));
          setError(e);
          setIsPending(false);
        }
        throw err;
      }
    },
    [app, toolName],
  );

  return { call, isPending, error, data };
}

/**
 * How long the view's document must stay hidden before showing it again
 * re-reads, in milliseconds.
 *
 * Long enough that switching tabs and straight back costs nothing; short
 * enough to cover any hide in which a browser freezes the page or the machine
 * sleeps, which is when reads fail and notices go missing. Measured with
 * `Date.now()`, which keeps counting while the machine sleeps.
 */
const RESUME_REFRESH_AFTER_MS = 60_000;

/** The params `useDataSync` hands its callback: the notification's, or `{}`. */
type DataSyncParams = NonNullable<ResourceListChangedNotification["params"]>;

/**
 * Run `callback` when the app's own MCP server announces that its data changed.
 *
 * A server sends `notifications/resources/list_changed` from the write that
 * changed its data, and an MCP Apps host forwards it to that server's views
 * (host capability `serverResources.listChanged`). The callback receives the
 * notification's params as the spec defines them, or `{}` when the host sends
 * none. They name no server and no tool: the notification only ever comes from
 * this app's own server, and a change need not come from a tool call at all.
 *
 * **At most one refresh at a time.** The notification says only that something
 * changed, so ten queued notices ask for the same thing as one: a re-read.
 *
 * - Notices that arrive together (a burst a host relays from a write loop, or a
 *   backgrounded tab dispatching its queue on resume) run the callback once, on
 *   the next macrotask, with the latest notice's params.
 * - When the callback returns a promise, notices that arrive before it settles
 *   run no new call. Once it settles, resolved or rejected, the callback runs
 *   once more if any notice arrived meanwhile, so the last change is never
 *   missed. Return the re-read's promise (`() => call()`) to get this.
 *
 * The callback's return type is `unknown` rather than `void | Promise<void>`
 * so that every callback that type-checked against `() => void` still does,
 * `() => call()` included: anything with a `then` is waited on, and anything
 * else is ignored.
 *
 * The hook only waits on the promise: a rejection ends the wait and is not
 * reported, so handle the error where you render it (`useCallTool` keeps it in
 * `error`). After unmount the callback does not run again.
 *
 * **It also runs when the view comes back.** When the document becomes visible
 * after staying hidden for at least a minute (`RESUME_REFRESH_AFTER_MS`), the
 * callback runs with `{}`, through the same path as a notice: it joins a burst
 * that arrives with it, and waits behind a call already in flight. The
 * notification means "the data may have changed while you weren't looking",
 * and so does a long hide: a suspended page misses notices and its reads fail,
 * and the host sends nothing on resume. So this is always on rather than an
 * option: a callback that is right for a notice is right here, and a view that
 * keeps no stale state has nothing to opt out of. It never runs on mount (the
 * view does its own first read) or for a short hide.
 *
 * Where the host did not declare `serverResources.listChanged`, the callback
 * runs only on resume. Nothing fails: between resumes the app shows what it
 * last loaded until the user or the app reloads it.
 */
export function useDataSync(callback: (params: DataSyncParams) => unknown): void {
  const app = useAppContext();
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inFlight = false;
    // The latest notice not yet handed to a call; set means a call is owed.
    let pending: DataSyncParams | undefined;

    const schedule = () => {
      if (timer === undefined && !inFlight) timer = setTimeout(run, 0);
    };

    const settle = () => {
      inFlight = false;
      if (active && pending !== undefined) schedule();
    };

    function run() {
      timer = undefined;
      if (!active || pending === undefined) return;
      const params = pending;
      pending = undefined;
      const result = callbackRef.current(params);
      if (result && typeof (result as PromiseLike<void>).then === "function") {
        inFlight = true;
        (result as PromiseLike<void>).then(settle, settle);
      }
    }

    const off = app.on(RESOURCE_LIST_CHANGED_METHOD, (params) => {
      pending = params ?? {};
      schedule();
    });

    // When the document was last hidden; unset while it is visible. A view
    // mounted hidden counts from mount, since its first read may have frozen.
    let hiddenAt: number | undefined = document.hidden ? Date.now() : undefined;
    const onVisibility = () => {
      if (document.hidden) {
        hiddenAt ??= Date.now();
        return;
      }
      const since = hiddenAt;
      hiddenAt = undefined;
      if (since === undefined || Date.now() - since < RESUME_REFRESH_AFTER_MS) return;
      // A notice already owed keeps its params.
      pending ??= {};
      schedule();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      active = false;
      if (timer !== undefined) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      off();
    };
  }, [app]);
}

// -----------------------------------------------------------------------------
// Agent-facing state
// -----------------------------------------------------------------------------

/** Debounce window for `useModelContext`, in milliseconds. */
const MODEL_CONTEXT_DEBOUNCE_MS = 250;

/**
 * Push what the user is looking at to the agent (ext-apps
 * `ui/update-model-context`), debounced so a selection the user drags through
 * costs one frame rather than thirty.
 *
 * **Declarative** — pushes when `deps` change:
 * ```tsx
 * useModelContext(() => ({
 *   state: { board: selectedBoard },
 *   summary: `Viewing "${selectedBoard?.name}"`,
 * }), [selectedBoard]);
 * ```
 *
 * **Imperative** — returns a push function:
 * ```tsx
 * const push = useModelContext();
 * push({ board: selectedBoard }, "Viewing board X");
 * ```
 *
 * The debounce lives here rather than on `app.updateModelContext`, which
 * sends immediately: the rapid-change problem is a React one, and the plain
 * method should do what it says.
 *
 * A no-op where the host did not declare `updateModelContext`.
 */
export function useModelContext(): (state: Record<string, unknown>, summary?: string) => void;
export function useModelContext(factory: () => ModelContext, deps: unknown[]): void;
export function useModelContext(
  factory?: () => ModelContext,
  deps?: unknown[],
): ((state: Record<string, unknown>, summary?: string) => void) | undefined {
  const app = useAppContext();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const push = useCallback(
    (state: Record<string, unknown>, summary?: string) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        app.updateModelContext(state, summary);
      }, MODEL_CONTEXT_DEBOUNCE_MS);
    },
    [app],
  );

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  // Declarative mode: push when deps change. The deps array is
  // caller-provided (mirrors useMemo/useEffect).
  const factoryRef = useRef(factory);
  factoryRef.current = factory;
  useEffect(() => {
    if (!factoryRef.current) return;
    const { state, summary } = factoryRef.current();
    push(state, summary);
  }, [...(deps ?? []), push]);

  if (!factory) return push;
}

/**
 * Send a user message into the agent conversation. A no-op where the host did
 * not declare `message`; check `app.hostCapabilities.message` to decide whether
 * to offer the control at all.
 */
export function useSendMessage(): (text: string) => void {
  const app = useAppContext();
  return useCallback((text: string) => app.sendMessage(text), [app]);
}

// -----------------------------------------------------------------------------
// NimbleBrain host extensions
// -----------------------------------------------------------------------------

/** Open what a resource URI names, through the host. See `open`. */
export function useOpen(): (uri: string) => Promise<boolean> {
  const app = useAppContext();
  return useCallback((uri: string) => open(app, uri), [app]);
}

/**
 * Whether the viewer may call `tool`, one of this app's own server's tools: true only when
 * the host lists it in the host context's `connector.allowedTools`.
 *
 * Gate a control on the tool behind it, never on a role. The host computes the list with the
 * same decision it enforces when the call arrives, so a control shown is a call that will be
 * allowed, and a policy change (which tools are admin-only, what a role may do) reaches the
 * app without the app changing. The server still decides every call; this only decides which
 * controls to offer.
 *
 * A hook that waits for the host: `false` until the host context lists the tool, and `false`
 * on a host that sends no list, so a restricted control stays hidden rather than offered to
 * someone the call would refuse. Re-renders when the host context changes, such as when the
 * viewer's role does.
 */
export function useToolAllowed(tool: string): boolean {
  const ctx = useHostContext<McpUiHostContext & { connector?: { allowedTools?: unknown } }>();
  const allowed = ctx?.connector?.allowedTools;
  return Array.isArray(allowed) && allowed.includes(tool);
}

/** Open this connector's settings page through the host. See `openConnectorSettings`. */
export function useOpenConnectorSettings(): () => Promise<boolean> {
  const app = useAppContext();
  return useCallback(() => openConnectorSettings(app), [app]);
}

/**
 * Show the user a notice through the host, labelled with this app. Resolves
 * `false` without sending where the host did not declare `ai.nimblebrain/notify`.
 * See `notify`.
 */
export function useNotify(): (notice: Notice) => Promise<boolean> {
  const app = useAppContext();
  return useCallback((notice: Notice) => notify(app, notice), [app]);
}

/**
 * Report where the app is to the host, and go where the host asks.
 *
 * Sends `trail` (root first, current view last) whenever its ids or labels
 * change, and calls `navigate` with an entry's `id` when the user picks it in
 * the host's breadcrumb. Returns whether the host shows the title and
 * breadcrumb (`ai.nimblebrain/location` declared): when it does, leave the
 * view's own out, e.g. `<PageHeader crumbs={shown ? undefined : crumbs} …>`.
 * Where it does not, nothing is sent and the view keeps its own.
 */
export function useTrail(trail: readonly TrailEntry[], navigate: (id: string) => void): boolean {
  const app = useAppContext();

  const trailRef = useRef(trail);
  trailRef.current = trail;
  // The trail's content, so a new array with the same levels sends nothing.
  const key = JSON.stringify(trail.map(({ id, label }) => [id, label]));
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` is the trail's content; the ref holds the same value
  useEffect(() => {
    setLocation(app, trailRef.current);
  }, [app, key]);

  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  useEffect(() => onNavigate(app, (id) => navigateRef.current(id)), [app]);

  return hostSupports(app, "location");
}

export interface UseFileUploadResult {
  pickFile: (options?: RequestFileOptions) => Promise<FileResult | null>;
  pickFiles: (options?: RequestFileOptions) => Promise<FileResult[]>;
  /** Store files the app already holds (dropped on it, say). See `uploadFiles`. */
  uploadFiles: (files: readonly File[], options?: UploadFilesOptions) => Promise<FileResult[]>;
  isPending: boolean;
}

/**
 * The host's native file picker, and uploads of files the app already holds,
 * with a pending flag. The pickers reject with `HostCapabilityError` where the
 * host did not declare `ai.nimblebrain/request-file`, and `uploadFiles` where it
 * did not declare `ai.nimblebrain/upload-files`; `hostSupports(app, "requestFile")`
 * and `hostSupports(app, "uploadFiles")` say so up front.
 */
export function useFileUpload(): UseFileUploadResult {
  const app = useAppContext();
  const [isPending, setIsPending] = useState(false);

  const one = useCallback(
    async (options?: RequestFileOptions) => {
      setIsPending(true);
      try {
        return await pickFile(app, options);
      } finally {
        setIsPending(false);
      }
    },
    [app],
  );

  const many = useCallback(
    async (options?: RequestFileOptions) => {
      setIsPending(true);
      try {
        return await pickFiles(app, options);
      } finally {
        setIsPending(false);
      }
    },
    [app],
  );

  const upload = useCallback(
    async (files: readonly File[], options?: UploadFilesOptions) => {
      setIsPending(true);
      try {
        return await uploadFiles(app, files, options);
      } finally {
        setIsPending(false);
      }
    },
    [app],
  );

  return { pickFile: one, pickFiles: many, uploadFiles: upload, isPending };
}

// -----------------------------------------------------------------------------
// useCallToolAsTask — lifecycle wrapper around `callToolAsTask(app, …)`
// -----------------------------------------------------------------------------

/**
 * The statuses a task ends in. Typed via `satisfies TaskStatus` so a rename in
 * the spec enum trips `tsc`.
 */
const COMPLETED_STATUS = "completed" satisfies TaskStatus;
const FAILED_STATUS = "failed" satisfies TaskStatus;
const CANCELLED_STATUS = "cancelled" satisfies TaskStatus;

const TERMINAL_STATUSES: ReadonlySet<TaskStatus> = new Set<TaskStatus>([
  COMPLETED_STATUS,
  FAILED_STATUS,
  CANCELLED_STATUS,
]);

export interface UseCallToolAsTaskResult<TInput, TOutput> {
  /**
   * Call the tool. Resolves with the `TaskHandle` once the server has answered
   * the call, with its result or with a task; reading `task`/`result`/`error`
   * from the hook is usually enough.
   *
   * Firing again while a task runs stops following the earlier one but does
   * not cancel it on the server.
   */
  fire(args?: TInput): Promise<TaskHandle<TOutput>>;
  /** Latest `Task` state, or `null` before `fire()` has been called. */
  task: Task | null;
  /** The tool's result, once the task completes. */
  result: ToolCallResult<TOutput> | null;
  /** Set when the call or the task fails, or when `result.isError === true`. */
  error: Error | null;
  /** `true` from the answer to `fire()` until the task ends. */
  isWorking: boolean;
  /**
   * `true` once the task has ended: `completed`, `failed`, `cancelled`, or
   * any status the hook stopped following on (an `input_required` task, which
   * the handle cancels, or a poll that failed).
   */
  isTerminal: boolean;
  /**
   * Cancel the active task via `tasks/cancel`. No-op when no task is active.
   * A failure surfaces via `error`.
   */
  cancel(): Promise<void>;
}

/**
 * React wrapper around `callToolAsTask(app, …)`.
 *
 *  1. `fire(args)` sends the `tools/call`. A server that answers outright
 *     yields a `completed` task and its result at once.
 *  2. Otherwise the hook awaits `handle.result()`, which polls `tasks/get`, and
 *     mirrors each status change into `task` through `handle.onStatus`.
 *  3. The task's end lands in `result` or `error`.
 *
 * Where the host did not declare the tasks extension, `fire` rejects with
 * `HostCapabilityError` and `error` holds it; `app.supportsTasks` says so up
 * front.
 *
 * Unmounting, or firing again, stops polling but does not cancel the task on
 * the server.
 */
export function useCallToolAsTask<TInput = Record<string, unknown>, TOutput = unknown>(
  toolName: string,
): UseCallToolAsTaskResult<TInput, TOutput> {
  const app = useAppContext();

  const [task, setTask] = useState<Task | null>(null);
  const [result, setResult] = useState<ToolCallResult<TOutput> | null>(null);
  const [error, setError] = useState<Error | null>(null);
  // Set when the hook stops following a task whose last status is not one of
  // the terminal ones, so `isTerminal` still tells the truth.
  const [stopped, setStopped] = useState(false);

  // Per-fire generation. Every asynchronous callback captures it and bails
  // once a later fire, or unmount, has moved it on.
  const genRef = useRef(0);
  const handleRef = useRef<TaskHandle<TOutput> | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Set by `cancel()` for the current fire; reset by the next one.
  const cancelRequested = useRef(false);

  const detachCurrent = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
    handleRef.current = null;
  }, []);

  const fire = useCallback(
    async (args?: TInput): Promise<TaskHandle<TOutput>> => {
      detachCurrent();
      const gen = ++genRef.current;

      // Keep the previous `task` until the new one arrives, rather than
      // flickering to null.
      setResult(null);
      setError(null);
      setStopped(false);
      cancelRequested.current = false;

      let handle: TaskHandle<TOutput>;
      try {
        handle = await callToolAsTask<TOutput>(app, toolName, args);
      } catch (err) {
        if (gen === genRef.current) {
          setError(err instanceof Error ? err : new Error(String(err)));
        }
        throw err;
      }
      if (gen !== genRef.current) return handle;

      const abort = new AbortController();
      handleRef.current = handle;
      abortRef.current = abort;
      setTask(handle.task);
      unsubscribeRef.current = handle.onStatus((updated) => {
        if (gen === genRef.current) setTask(updated);
      });

      handle.result({ signal: abort.signal }).then(
        (res) => {
          if (gen !== genRef.current) return;
          setTask((prev) =>
            prev && prev.status !== COMPLETED_STATUS
              ? { ...prev, status: COMPLETED_STATUS, lastUpdatedAt: new Date().toISOString() }
              : prev,
          );
          setResult(res);
          if (res.isError) {
            // A tool-level error inside a completed task. `result` keeps the
            // content blocks; `error` serves callers that treat it as failure.
            const msg =
              typeof res.data === "string" && res.data.length > 0
                ? res.data
                : `Tool "${toolName}" returned isError: true`;
            setError(new Error(msg));
          }
        },
        (err) => {
          if (gen !== genRef.current || abort.signal.aborted) return;
          // A poll that gave up leaves the task's real state unknown, so the
          // last status observed stays.
          if (err instanceof TaskError) setTask(err.task);
          setStopped(true);
          // A cancel the caller asked for is not an error, however late the
          // server finishes it.
          if (
            cancelRequested.current &&
            err instanceof TaskError &&
            err.task.status === CANCELLED_STATUS
          ) {
            return;
          }
          setError(err instanceof Error ? err : new Error(String(err)));
        },
      );

      return handle;
    },
    [app, toolName, detachCurrent],
  );

  const cancel = useCallback(async (): Promise<void> => {
    const h = handleRef.current;
    if (!h) return;
    const gen = genRef.current;
    cancelRequested.current = true;
    try {
      const cancelled = await h.cancel();
      if (gen !== genRef.current) return;
      setTask(cancelled);
      // A cancel the caller asked for is not an error: stop polling rather
      // than let `result()` report the cancellation it will observe.
      if (TERMINAL_STATUSES.has(cancelled.status)) {
        abortRef.current?.abort();
        abortRef.current = null;
      }
    } catch (err) {
      if (gen !== genRef.current) return;
      setError(err instanceof Error ? err : new Error(String(err)));
    }
  }, []);

  // Unmount stops polling and drops the status subscription. It does not
  // cancel the task: it keeps running on the server.
  useEffect(() => {
    return () => {
      genRef.current += 1;
      abortRef.current?.abort();
      abortRef.current = null;
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
      handleRef.current = null;
    };
  }, []);

  const isTerminal = task !== null && (stopped || TERMINAL_STATUSES.has(task.status));
  const isWorking = task !== null && !isTerminal;

  return { fire, task, result, error, isWorking, isTerminal, cancel };
}

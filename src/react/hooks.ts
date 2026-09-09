import type { McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import type { Task, TaskStatus } from "@modelcontextprotocol/sdk/types.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { pickFile, pickFiles, action as sendAction } from "../extensions.js";
import { callToolAsTask } from "../task-handle.js";
import type {
  App,
  CallToolAsTaskOptions,
  CallToolOptions,
  DataChangedEvent,
  FileResult,
  ModelContext,
  RequestFileOptions,
  TaskHandle,
  Theme,
  ToolCallResult,
  ToolResultData,
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

/** The latest tool result pushed by the host, or `null` before one arrives. */
export function useToolResult(): ToolResultData | null {
  const app = useAppContext();
  const [data, setData] = useState<ToolResultData | null>(null);

  useEffect(() => {
    return app.on("tool-result", setData);
  }, [app]);

  return data;
}

/** The arguments the host is calling the bound tool with, as they arrive. */
export function useToolInput(): Record<string, unknown> | null {
  const app = useAppContext();
  const [input, setInput] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    return app.on("tool-input", setInput);
  }, [app]);

  return input;
}

/** Ask the host to resize this app's frame. */
export function useResize(): (width?: number, height?: number) => void {
  const app = useAppContext();
  return useCallback((width?: number, height?: number) => app.resize(width, height), [app]);
}

// -----------------------------------------------------------------------------
// Tools
// -----------------------------------------------------------------------------

export interface UseCallToolResult<TOutput> {
  call: (
    args?: Record<string, unknown>,
    options?: CallToolOptions,
  ) => Promise<ToolCallResult<TOutput>>;
  isPending: boolean;
  error: Error | null;
  data: TOutput | null;
}

/** Call one tool, with pending/error/data state for the latest call. */
export function useCallTool<TOutput = unknown>(toolName: string): UseCallToolResult<TOutput> {
  const app = useAppContext();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [data, setData] = useState<TOutput | null>(null);
  const callIdRef = useRef(0);

  const call = useCallback(
    async (
      args?: Record<string, unknown>,
      options?: CallToolOptions,
    ): Promise<ToolCallResult<TOutput>> => {
      const id = ++callIdRef.current;
      setIsPending(true);
      setError(null);

      try {
        const result = await app.callTool<TOutput>(toolName, args, options);
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

/** Run `callback` whenever the agent changes data this app displays. */
export function useDataSync(callback: (event: DataChangedEvent) => void): void {
  const app = useAppContext();
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    return app.on("data-changed", (event) => callbackRef.current(event));
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

/** Send a user message into the agent conversation. */
export function useSendMessage(): (
  text: string,
  context?: { action?: string; entity?: string },
) => void {
  const app = useAppContext();
  return useCallback(
    (text: string, context?: { action?: string; entity?: string }) =>
      app.sendMessage(text, context),
    [app],
  );
}

// -----------------------------------------------------------------------------
// NimbleBrain host extensions
// -----------------------------------------------------------------------------

/** Trigger a host-side action. No-op off a NimbleBrain host. */
export function useAction(): (name: string, params?: Record<string, unknown>) => void {
  const app = useAppContext();
  return useCallback(
    (name: string, params?: Record<string, unknown>) => sendAction(app, name, params),
    [app],
  );
}

export interface UseFileUploadResult {
  pickFile: (options?: RequestFileOptions) => Promise<FileResult | null>;
  pickFiles: (options?: RequestFileOptions) => Promise<FileResult[]>;
  isPending: boolean;
}

/** The host's native file picker, with a pending flag. NimbleBrain only. */
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

  return { pickFile: one, pickFiles: many, isPending };
}

// -----------------------------------------------------------------------------
// useCallToolAsTask — lifecycle wrapper around `callToolAsTask(app, …)`
// -----------------------------------------------------------------------------

/**
 * Spec terminal status values for the MCP 2025-11-25 tasks utility.
 *
 * Typed via `satisfies TaskStatus` so a rename of any member of the
 * spec enum (`completed`/`failed`/`cancelled`) trips `tsc` — we never
 * hand-type these as bare string literals in comparisons.
 */
const COMPLETED_STATUS = "completed" satisfies TaskStatus;
const FAILED_STATUS = "failed" satisfies TaskStatus;
const CANCELLED_STATUS = "cancelled" satisfies TaskStatus;

const TERMINAL_STATUSES: ReadonlySet<TaskStatus> = new Set<TaskStatus>([
  COMPLETED_STATUS,
  FAILED_STATUS,
  CANCELLED_STATUS,
]);

/**
 * Fallback poll cadence used when the receiver's `CreateTaskResult.task`
 * carries no `pollInterval`. The effective fire delay is this value × 1.5
 * ≈ 7.5s, well below default TTLs but long enough to avoid hammering hosts
 * that do emit `notifications/tasks/status`.
 */
const DEFAULT_POLL_INTERVAL_MS = 5_000;
const POLL_FALLBACK_MULTIPLIER = 1.5;

/**
 * Stop the poll fallback after this many consecutive `refresh()` failures.
 * Bridge teardown / TTL eviction / network outage all manifest as repeated
 * `tasks/get` rejections. Without a guard the timer re-arms forever; with
 * it we stop polling silently after `MAX_REFRESH_FAILURES` strikes — the
 * blocking `result()` path remains the authoritative source of truth, so
 * giving up on polling never loses the terminal value.
 */
const MAX_REFRESH_FAILURES = 5;

export interface UseCallToolAsTaskResult<TInput, TOutput> {
  /**
   * Start (or re-start) a task-augmented tool call. Returns the
   * resolved `TaskHandle` so callers can `await fire(...)` if they
   * want to know when the server has accepted the task, but reading
   * `task`/`result`/`error` from the hook is usually enough.
   *
   * Re-firing while a previous task is still in flight detaches this
   * hook from the prior handle (stops polling, unsubscribes) but does
   * NOT cancel the server-side task — the task keeps running and its
   * result may still be fetched elsewhere (e.g. on page revisit).
   */
  fire(args?: TInput, options?: CallToolAsTaskOptions): Promise<TaskHandle<TOutput>>;
  /** Latest `Task` state, or `null` before `fire()` has been called. */
  task: Task | null;
  /** Populated once `handle.result()` resolves non-error. */
  result: ToolCallResult<TOutput> | null;
  /** Populated on rejection or when `result.isError === true`. */
  error: Error | null;
  /** `true` while the task is non-terminal (`working` / `input_required`). */
  isWorking: boolean;
  /** `true` when `task.status ∈ {completed, failed, cancelled}`. */
  isTerminal: boolean;
  /**
   * Cancel the active task via `tasks/cancel`. No-op when no task is
   * active. Swallowed errors surface via `error`.
   */
  cancel(): Promise<void>;
}

/**
 * React wrapper around `callToolAsTask(app, …)`.
 *
 * Handles the full MCP 2025-11-25 task lifecycle:
 *
 *  1. `fire(args, options?)` sends the task-augmented `tools/call` and
 *     stores the returned `TaskHandle` in a ref.
 *  2. Subscribes to `handle.onStatus` — updates `task` whenever the
 *     host emits `notifications/tasks/status` (OPTIONAL per spec).
 *  3. Starts a polling fallback: if no status notification arrives
 *     within `pollInterval × 1.5` (defaulting to ~7.5s), calls
 *     `handle.refresh()` for canonical state. Stops on terminal.
 *  4. Awaits `handle.result()` in the background — resolves to either
 *     `result` (success / `isError: false`) or `error` (network reject
 *     OR `result.isError === true`).
 *
 * Cleanup (unmount or re-fire) unsubscribes from status events and
 * clears the poll timer, but does NOT cancel the server-side task —
 * the caller may remount and recover state by firing again, and tasks
 * outlive iframe teardown until TTL elapses.
 */
export function useCallToolAsTask<TInput = Record<string, unknown>, TOutput = unknown>(
  toolName: string,
): UseCallToolAsTaskResult<TInput, TOutput> {
  const app = useAppContext();

  const [task, setTask] = useState<Task | null>(null);
  const [result, setResult] = useState<ToolCallResult<TOutput> | null>(null);
  const [error, setError] = useState<Error | null>(null);

  // Per-fire generation counter. Every `fire()` increments; any
  // asynchronous callback (status listener, poll timer, `result()`
  // resolution) captures the gen at schedule time and bails if the
  // current gen has moved past it. This is the single source of truth
  // for "is this work still relevant?" — more robust than comparing
  // TaskHandle identity because handles can be detached by re-fire.
  const genRef = useRef(0);

  // Active handle + its teardown handles. We keep both in refs so the
  // hook's stable `fire`/`cancel` callbacks can reach the current
  // lifecycle state without re-binding on every render.
  const handleRef = useRef<TaskHandle<TOutput> | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // `pollInterval × 1.5`, captured per-fire. Falls back to the 5s
  // default when the host didn't provide a `pollInterval` in the
  // initial CreateTaskResult.task.
  const pollDelayRef = useRef<number>(DEFAULT_POLL_INTERVAL_MS * POLL_FALLBACK_MULTIPLIER);

  // Track the latest known status out-of-band so the poll callback
  // can decide whether to keep polling without depending on the
  // `task` React state (which lags a render behind setState).
  const terminalRef = useRef<boolean>(false);

  // Consecutive `refresh()` failure count for the active fire. Reset
  // on every successful refresh, status notification, or new fire.
  const refreshFailureCountRef = useRef<number>(0);

  const clearPollTimer = useCallback(() => {
    if (pollTimerRef.current !== null) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const detachCurrent = useCallback(() => {
    clearPollTimer();
    if (unsubscribeRef.current) {
      unsubscribeRef.current();
      unsubscribeRef.current = null;
    }
    handleRef.current = null;
  }, [clearPollTimer]);

  const scheduleNextPoll = useCallback(
    (gen: number) => {
      clearPollTimer();
      if (terminalRef.current) return;
      pollTimerRef.current = setTimeout(() => {
        // Bail if this fire has been superseded or torn down.
        if (gen !== genRef.current) return;
        const h = handleRef.current;
        if (!h) return;
        if (terminalRef.current) return;
        // `refresh()` is the canonical source for `createdAt` /
        // `lastUpdatedAt` / `ttl` — notification-derived Tasks carry
        // placeholders per the router in `task-handle.ts`.
        h.refresh().then(
          (fresh) => {
            if (gen !== genRef.current) return;
            refreshFailureCountRef.current = 0;
            setTask(fresh);
            const isTerminal = TERMINAL_STATUSES.has(fresh.status);
            terminalRef.current = isTerminal;
            if (!isTerminal) scheduleNextPoll(gen);
          },
          () => {
            // Swallow refresh errors — the blocking `tasks/result` is
            // the authoritative path; polling is best-effort. But guard
            // against runaway re-arming: if the bridge is gone or the
            // task TTL has elapsed, every refresh rejects. Stop after
            // MAX_REFRESH_FAILURES consecutive strikes; result() will
            // still surface a terminal value or error when it settles.
            if (gen !== genRef.current) return;
            refreshFailureCountRef.current += 1;
            if (refreshFailureCountRef.current >= MAX_REFRESH_FAILURES) return;
            if (!terminalRef.current) scheduleNextPoll(gen);
          },
        );
      }, pollDelayRef.current);
    },
    [clearPollTimer],
  );

  const fire = useCallback(
    async (args?: TInput, options?: CallToolAsTaskOptions): Promise<TaskHandle<TOutput>> => {
      // Detach any in-flight prior task BEFORE incrementing the gen so
      // its callbacks see the new gen and bail. (Incrementing then
      // detaching would also work, but detach-first makes the order
      // obvious: stop listening, bump generation, start fresh.)
      detachCurrent();
      const gen = ++genRef.current;

      // Reset per-fire state. Don't wipe `task` yet — `callToolAsTask`
      // is async; showing the previous terminal state briefly is less
      // jarring than flicker to null → working. We clear on resolution.
      setResult(null);
      setError(null);
      terminalRef.current = false;
      refreshFailureCountRef.current = 0;

      let handle: TaskHandle<TOutput>;
      try {
        handle = await callToolAsTask<TOutput>(app, toolName, args, options);
      } catch (err) {
        if (gen !== genRef.current) throw err;
        const e = err instanceof Error ? err : new Error(String(err));
        setError(e);
        throw err;
      }

      // Caller superseded the fire between request and response —
      // don't attach listeners, but still return the handle so the
      // awaiter can observe it.
      if (gen !== genRef.current) return handle;

      handleRef.current = handle;

      // Derive the fallback poll delay from the receiver's advertised
      // `pollInterval`. Spec allows it to be absent; we then use the
      // 5s default.
      const hintedInterval = handle.task.pollInterval;
      pollDelayRef.current =
        typeof hintedInterval === "number" && hintedInterval > 0
          ? hintedInterval * POLL_FALLBACK_MULTIPLIER
          : DEFAULT_POLL_INTERVAL_MS * POLL_FALLBACK_MULTIPLIER;

      setTask(handle.task);
      terminalRef.current = TERMINAL_STATUSES.has(handle.task.status);

      // Subscribe to `notifications/tasks/status`. Each notification
      // resets the poll countdown (that's the whole point of the
      // "notification OR polling" contract — if notifications flow,
      // we don't poll; if they don't, the timer fires).
      unsubscribeRef.current = handle.onStatus((updated) => {
        if (gen !== genRef.current) return;
        refreshFailureCountRef.current = 0;
        setTask(updated);
        const isTerminal = TERMINAL_STATUSES.has(updated.status);
        terminalRef.current = isTerminal;
        if (isTerminal) {
          clearPollTimer();
        } else {
          scheduleNextPoll(gen);
        }
      });

      // Kick off the blocking result fetch — this is the authoritative
      // terminal value regardless of whether notifications or polls
      // landed in between. By spec, `tasks/result` blocks until the task
      // reaches a terminal status, so when this settles we KNOW the task
      // is terminal — stop polling and synthesize a terminal `task`
      // status so derived flags (`isTerminal`, `isWorking`) match the
      // populated `result` / `error` immediately.
      handle.result().then(
        (res) => {
          if (gen !== genRef.current) return;
          terminalRef.current = true;
          clearPollTimer();
          // Synthesize the terminal Task: failed if `isError`, otherwise
          // completed. The next status notification or refresh would
          // confirm this, but we want internal state consistent the
          // instant `result` is populated — a "result populated while
          // isWorking=true" render is incoherent for consumers.
          setTask((prev) => {
            const status: TaskStatus = res.isError ? FAILED_STATUS : COMPLETED_STATUS;
            const now = new Date().toISOString();
            return prev
              ? { ...prev, status, lastUpdatedAt: now }
              : {
                  taskId: handle.task.taskId,
                  status,
                  ttl: handle.task.ttl,
                  createdAt: handle.task.createdAt,
                  lastUpdatedAt: now,
                };
          });
          if (res.isError) {
            // Spec: `CallToolResult.isError === true` is a tool-level
            // error, not a protocol error. Surface via `error` for
            // consumers who treat it as a failure, but also populate
            // `result` so callers inspecting the raw content block
            // still have access.
            setResult(res);
            const msg =
              typeof res.data === "string" && res.data.length > 0
                ? res.data
                : `Tool "${toolName}" returned isError: true`;
            setError(new Error(msg));
          } else {
            setResult(res);
          }
        },
        (err) => {
          if (gen !== genRef.current) return;
          // result() rejection means the `tasks/result` RPC failed
          // (transport error, taskId not found, bridge teardown). We
          // can't know the server-side task's actual final state, but
          // we know polling won't recover here either — same transport.
          // Mark terminal and synthesize `failed` status for UX
          // coherence; the populated `error` tells the consumer what
          // specifically went wrong.
          terminalRef.current = true;
          clearPollTimer();
          setTask((prev) => {
            const now = new Date().toISOString();
            return prev
              ? { ...prev, status: FAILED_STATUS, lastUpdatedAt: now }
              : {
                  taskId: handle.task.taskId,
                  status: FAILED_STATUS,
                  ttl: handle.task.ttl,
                  createdAt: handle.task.createdAt,
                  lastUpdatedAt: now,
                };
          });
          const e = err instanceof Error ? err : new Error(String(err));
          setError(e);
        },
      );

      // Start the poll fallback only if we aren't already terminal.
      if (!terminalRef.current) scheduleNextPoll(gen);

      return handle;
    },
    [app, toolName, detachCurrent, clearPollTimer, scheduleNextPoll],
  );

  const cancel = useCallback(async (): Promise<void> => {
    const h = handleRef.current;
    if (!h) return;
    const gen = genRef.current;
    try {
      const cancelled = await h.cancel();
      if (gen !== genRef.current) return;
      setTask(cancelled);
      terminalRef.current = TERMINAL_STATUSES.has(cancelled.status);
      clearPollTimer();
    } catch (err) {
      if (gen !== genRef.current) return;
      const e = err instanceof Error ? err : new Error(String(err));
      setError(e);
    }
  }, [clearPollTimer]);

  // Cleanup on unmount: stop polling, drop the status subscription.
  // Deliberately do NOT call `handle.cancel()` — the server-side task
  // keeps running so a remount can recover state.
  useEffect(() => {
    return () => {
      genRef.current += 1;
      if (pollTimerRef.current !== null) {
        clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
      handleRef.current = null;
    };
  }, []);

  const isTerminal = task !== null && TERMINAL_STATUSES.has(task.status);
  const isWorking = task !== null && !isTerminal;

  return { fire, task, result, error, isWorking, isTerminal, cancel };
}

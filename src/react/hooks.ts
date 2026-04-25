import type { McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import type { Task, TaskStatus } from "@modelcontextprotocol/sdk/types.js";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type {
  ActionReducer,
  AgentAction,
  CallToolAsTaskOptions,
  DataChangedEvent,
  FileResult,
  RequestFileOptions,
  Store,
  StoreDispatch,
  Synapse,
  SynapseTheme,
  TaskHandle,
  ToolCallResult,
} from "../types.js";
import { SynapseProvider, useSynapseContext } from "./provider.js";

// Re-export provider components
export { SynapseProvider };

export function useSynapse(): Synapse {
  return useSynapseContext();
}

export function useCallTool<TOutput = unknown>(
  toolName: string,
): {
  call: (args?: Record<string, unknown>) => Promise<ToolCallResult<TOutput>>;
  isPending: boolean;
  error: Error | null;
  data: TOutput | null;
} {
  const synapse = useSynapseContext();
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
        const result = await synapse.callTool<Record<string, unknown>, TOutput>(toolName, args);
        // Stale guard: only update if this is still the latest call
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
    [synapse, toolName],
  );

  return { call, isPending, error, data };
}

export function useDataSync(callback: (event: DataChangedEvent) => void): void {
  const synapse = useSynapseContext();
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    return synapse.onDataChanged((event) => callbackRef.current(event));
  }, [synapse]);
}

/**
 * Subscribe to agent actions — typed, declarative commands from the server.
 *
 * Actions are emitted by tools as deterministic side effects (e.g., "navigate
 * to the board I just created"). The UI decides how to handle each action type.
 *
 * @example
 * ```tsx
 * useAgentAction((action) => {
 *   if (action.type === "navigate") {
 *     const { entity, id } = action.payload as NavigatePayload;
 *     if (entity === "board") setSelectedBoardId(id);
 *   }
 * });
 * ```
 */
export function useAgentAction(callback: (action: AgentAction) => void): void {
  const synapse = useSynapseContext();
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    return synapse.onAction((action) => callbackRef.current(action));
  }, [synapse]);
}

/**
 * Subscribe to the full ext-apps host context.
 *
 * Returns the host context bag — spec-standardized fields (`theme`, `styles`,
 * `displayMode`, `toolInfo`) plus any host extensions. Re-renders on every
 * `ui/notifications/host-context-changed` notification.
 *
 * Prefer `useTheme()` when only theming matters (it filters no-op fires and
 * returns a typed `SynapseTheme`). Reach for `useHostContext()` for non-theme
 * fields like host-specific extensions, e.g. on NimbleBrain:
 *
 * ```tsx
 * const { workspace } = useHostContext<{ workspace?: { id: string } }>();
 * ```
 */
export function useHostContext<T extends McpUiHostContext = McpUiHostContext>(): T {
  const synapse = useSynapseContext();
  const [ctx, setCtx] = useState<T>(() => synapse.getHostContext() as T);

  useEffect(() => {
    // Sync in case context changed between render and effect
    setCtx(synapse.getHostContext() as T);
    return synapse.onHostContextChanged((c) => setCtx(c as T));
  }, [synapse]);

  return ctx;
}

/**
 * Re-renders only when the derived `SynapseTheme` actually changes (mode,
 * primaryColor, or any token value). Routes through `synapse.onThemeChanged`
 * — which is itself a `themesEqual`-filtered selector over the unified host
 * context — so a host-context update that doesn't move the theme (e.g. a
 * workspace switch) does NOT cause this hook's consumers to re-render.
 *
 * Building this on `useHostContext` instead would skip the filter: every
 * host-context-changed notification produces a new context reference, which
 * would propagate through `useState` and force a re-render even when the
 * derived theme is unchanged.
 */
export function useTheme(): SynapseTheme {
  const synapse = useSynapseContext();
  const [theme, setTheme] = useState<SynapseTheme>(() => synapse.getTheme());

  useEffect(() => {
    // Sync in case theme changed between render and effect
    setTheme(synapse.getTheme());
    return synapse.onThemeChanged(setTheme);
  }, [synapse]);

  return theme;
}

export function useAction(): (action: string, params?: Record<string, unknown>) => void {
  const synapse = useSynapseContext();
  return useCallback(
    (action: string, params?: Record<string, unknown>) => synapse.action(action, params),
    [synapse],
  );
}

export function useChat(): (
  message: string,
  context?: { action?: string; entity?: string },
) => void {
  const synapse = useSynapseContext();
  return useCallback(
    (message: string, context?: { action?: string; entity?: string }) =>
      synapse.chat(message, context),
    [synapse],
  );
}

/**
 * Push the app's visible state to the agent via ext-apps `ui/update-model-context`.
 *
 * **Imperative** (no args) — returns a push function you call manually:
 * ```tsx
 * const push = useVisibleState();
 * push({ board: selectedBoard }, "Viewing board X");
 * ```
 *
 * **Declarative** (factory + deps) — auto-pushes when deps change:
 * ```tsx
 * useVisibleState(() => ({
 *   state: { board: selectedBoard },
 *   summary: `Viewing "${selectedBoard?.name}"`,
 * }), [selectedBoard]);
 * ```
 */
export function useVisibleState(): (state: Record<string, unknown>, summary?: string) => void;
export function useVisibleState(
  factory: () => { state: Record<string, unknown>; summary?: string },
  deps: unknown[],
): void;
export function useVisibleState(
  factory?: () => { state: Record<string, unknown>; summary?: string },
  deps?: unknown[],
): ((state: Record<string, unknown>, summary?: string) => void) | undefined {
  const synapse = useSynapseContext();
  const push = useCallback(
    (state: Record<string, unknown>, summary?: string) => synapse.setVisibleState(state, summary),
    [synapse],
  );

  // Declarative mode: auto-push when deps change.
  // The deps array is caller-provided (mirrors useMemo/useEffect pattern).
  const factoryRef = useRef(factory);
  factoryRef.current = factory;
  useEffect(() => {
    if (!factoryRef.current) return;
    const { state, summary } = factoryRef.current();
    push(state, summary);
  }, [...(deps ?? []), push]);

  if (!factory) return push;
}

export function useFileUpload(): {
  pickFile: (options?: RequestFileOptions) => Promise<FileResult | null>;
  pickFiles: (options?: RequestFileOptions) => Promise<FileResult[]>;
  isPending: boolean;
} {
  const synapse = useSynapseContext();
  const [isPending, setIsPending] = useState(false);

  const pickFile = useCallback(
    async (options?: RequestFileOptions) => {
      setIsPending(true);
      try {
        return await synapse.pickFile(options);
      } finally {
        setIsPending(false);
      }
    },
    [synapse],
  );

  const pickFiles = useCallback(
    async (options?: RequestFileOptions) => {
      setIsPending(true);
      try {
        return await synapse.pickFiles(options);
      } finally {
        setIsPending(false);
      }
    },
    [synapse],
  );

  return { pickFile, pickFiles, isPending };
}

export function useStore<TState, TActions extends Record<string, ActionReducer<TState, any>>>(
  store: Store<TState, TActions>,
): {
  state: TState;
  dispatch: StoreDispatch<TActions>;
} {
  const state = useSyncExternalStore(
    (onStoreChange) => store.subscribe(onStoreChange),
    () => store.getState(),
    () => store.getState(),
  );

  return { state, dispatch: store.dispatch };
}

// -----------------------------------------------------------------------------
// useCallToolAsTask — lifecycle wrapper around `synapse.callToolAsTask`
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
 * carries no `pollInterval`. Chosen to roughly match the 5s cadence
 * described in Task 005 ("a sensible default like 5s if pollInterval is
 * absent") — the effective fire delay is this value × 1.5 ≈ 7.5s, well
 * below default TTLs but long enough to avoid hammering hosts that do
 * emit `notifications/tasks/status`.
 */
const DEFAULT_POLL_INTERVAL_MS = 5_000;
const POLL_FALLBACK_MULTIPLIER = 1.5;

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
 * React hook wrapper around `synapse.callToolAsTask`.
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
  const synapse = useSynapseContext();

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
            setTask(fresh);
            const isTerminal = TERMINAL_STATUSES.has(fresh.status);
            terminalRef.current = isTerminal;
            if (!isTerminal) scheduleNextPoll(gen);
          },
          () => {
            // Swallow refresh errors — the blocking `tasks/result` is
            // the authoritative path; polling is best-effort. If the
            // task's gone, result() will reject and surface via
            // `error`. Keep trying until terminal / unmount.
            if (gen !== genRef.current) return;
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

      let handle: TaskHandle<TOutput>;
      try {
        handle = await synapse.callToolAsTask<TInput, TOutput>(toolName, args, options);
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
      // 5s default described in Task 005.
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
      // landed in between.
      handle.result().then(
        (res) => {
          if (gen !== genRef.current) return;
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
          const e = err instanceof Error ? err : new Error(String(err));
          setError(e);
        },
      );

      // Start the poll fallback only if we aren't already terminal.
      if (!terminalRef.current) scheduleNextPoll(gen);

      return handle;
    },
    [synapse, toolName, detachCurrent, clearPollTimer, scheduleNextPoll],
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
  // Deliberately do NOT call `handle.cancel()` — per Task 005, the
  // server-side task keeps running so a remount can recover state.
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

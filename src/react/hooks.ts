import type { McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type {
  ActionReducer,
  AgentAction,
  DataChangedEvent,
  FileResult,
  RequestFileOptions,
  Store,
  StoreDispatch,
  Synapse,
  SynapseTheme,
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

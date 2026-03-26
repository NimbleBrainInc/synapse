import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type {
  ActionReducer,
  DataChangedEvent,
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

export function useVisibleState(): (state: Record<string, unknown>, summary?: string) => void {
  const synapse = useSynapseContext();
  return useCallback(
    (state: Record<string, unknown>, summary?: string) => synapse.setVisibleState(state, summary),
    [synapse],
  );
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

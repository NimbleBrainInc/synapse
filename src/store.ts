import type {
  Synapse,
  StoreConfig,
  Store,
  StoreDispatch,
  ActionReducer,
} from "./types.js";

/**
 * Create a typed state store with optional persistence and agent visibility.
 *
 * - `persist: true` — state survives iframe reloads via host storage
 * - `visibleToAgent: true` — state is pushed to the LLM context
 * - Both are independent and can be enabled separately
 */
export function createStore<
  TState,
  TActions extends Record<string, ActionReducer<TState, any>> = Record<
    string,
    ActionReducer<TState, any>
  >,
>(
  synapse: Synapse,
  config: StoreConfig<TState> & { actions: TActions },
): Store<TState, TActions> {
  let state = structuredClone(config.initialState);
  const subscribers = new Set<(state: TState) => void>();
  let destroyed = false;
  let persistTimer: ReturnType<typeof setTimeout> | null = null;

  // Build dispatch object from action reducers
  const dispatch = {} as StoreDispatch<TActions>;
  for (const key of Object.keys(config.actions)) {
    (dispatch as any)[key] = (payload: unknown) => {
      if (destroyed) return;
      state = config.actions[key](state, payload);
      notify();
    };
  }

  function notify(): void {
    for (const cb of subscribers) cb(state);
    if (config.visibleToAgent) pushToAgent();
    if (config.persist) schedulePersist();
  }

  function pushToAgent(): void {
    const summary = config.summarize?.(state);
    synapse.setVisibleState(
      state as unknown as Record<string, unknown>,
      summary,
    );
  }

  function schedulePersist(): void {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      synapse._request("ui/persistState", {
        state: state as unknown as Record<string, unknown>,
        version: config.version,
      }).catch(() => {
        // Silently ignore persist failures (host may not support it)
      });
      persistTimer = null;
    }, 500);
  }

  // Listen for state loaded from host (on init)
  let unsubStateLoaded: (() => void) | undefined;
  if (config.persist) {
    unsubStateLoaded = synapse._onMessage("ui/stateLoaded", (params) => {
      if (!params?.state) return;
      let loaded = params.state as TState;
      const loadedVersion = (params.version as number) ?? 1;
      const currentVersion = config.version ?? 1;

      // Run migrations if needed
      if (config.migrations && loadedVersion < currentVersion) {
        const startIdx = loadedVersion - 1;
        for (let i = startIdx; i < config.migrations.length; i++) {
          loaded = config.migrations[i](loaded);
        }
      }

      store.hydrate(loaded);
    });
  }

  const store: Store<TState, TActions> = {
    getState(): TState {
      return state;
    },

    subscribe(callback: (state: TState) => void): () => void {
      subscribers.add(callback);
      return () => {
        subscribers.delete(callback);
      };
    },

    dispatch,

    hydrate(newState: TState): void {
      state = newState;
      for (const cb of subscribers) cb(state);
    },

    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      if (persistTimer) clearTimeout(persistTimer);
      subscribers.clear();
      unsubStateLoaded?.();
    },
  };

  return store;
}

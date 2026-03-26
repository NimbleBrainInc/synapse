import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createStore } from "../store.js";
import type { Synapse } from "../types.js";

interface CounterState {
  count: number;
  label: string;
}

const initialState: CounterState = { count: 0, label: "default" };

const actions = {
  increment: (state: CounterState) => ({ ...state, count: state.count + 1 }),
  setLabel: (state: CounterState, label: string) => ({ ...state, label }),
};

function createMockSynapse(): Synapse {
  return {
    ready: Promise.resolve(),
    isNimbleBrainHost: true,
    callTool: vi.fn(),
    onDataChanged: vi.fn(() => () => {}),
    getTheme: vi.fn(() => ({ mode: "light" as const, primaryColor: "#000", tokens: {} })),
    onThemeChanged: vi.fn(() => () => {}),
    action: vi.fn(),
    chat: vi.fn(),
    setVisibleState: vi.fn(),
    downloadFile: vi.fn(),
    openLink: vi.fn(),
    _onMessage: vi.fn(() => () => {}),
    _request: vi.fn(() => Promise.resolve()),
    destroy: vi.fn(),
  };
}

describe("createStore", () => {
  let synapse: Synapse;

  beforeEach(() => {
    synapse = createMockSynapse();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns initial state from getState()", () => {
    const store = createStore(synapse, { initialState, actions });
    expect(store.getState()).toEqual({ count: 0, label: "default" });
    store.destroy();
  });

  it("dispatch action updates state", () => {
    const store = createStore(synapse, { initialState, actions });
    store.dispatch.increment();
    expect(store.getState().count).toBe(1);

    store.dispatch.setLabel("hello");
    expect(store.getState().label).toBe("hello");
    store.destroy();
  });

  it("subscriber fires on dispatch", () => {
    const store = createStore(synapse, { initialState, actions });
    const subscriber = vi.fn();

    store.subscribe(subscriber);
    store.dispatch.increment();

    expect(subscriber).toHaveBeenCalledTimes(1);
    expect(subscriber).toHaveBeenCalledWith(expect.objectContaining({ count: 1 }));
    store.destroy();
  });

  it("unsubscribe stops notifications", () => {
    const store = createStore(synapse, { initialState, actions });
    const subscriber = vi.fn();

    const unsub = store.subscribe(subscriber);
    store.dispatch.increment();
    expect(subscriber).toHaveBeenCalledTimes(1);

    unsub();
    store.dispatch.increment();
    expect(subscriber).toHaveBeenCalledTimes(1);
    store.destroy();
  });

  it("hydrate() replaces state and notifies subscribers", () => {
    const store = createStore(synapse, { initialState, actions });
    const subscriber = vi.fn();

    store.subscribe(subscriber);
    store.hydrate({ count: 42, label: "hydrated" });

    expect(store.getState()).toEqual({ count: 42, label: "hydrated" });
    expect(subscriber).toHaveBeenCalledWith({ count: 42, label: "hydrated" });
    store.destroy();
  });

  it("persist: true calls _request('ui/persistState') after debounce", () => {
    const store = createStore(synapse, {
      initialState,
      actions,
      persist: true,
      version: 2,
    });

    store.dispatch.increment();

    // Before debounce fires
    expect(synapse._request).not.toHaveBeenCalled();

    // After 500ms debounce
    vi.advanceTimersByTime(500);
    expect(synapse._request).toHaveBeenCalledWith("ui/persistState", {
      state: { count: 1, label: "default" },
      version: 2,
    });
    store.destroy();
  });

  it("persist debounce batches rapid dispatches", () => {
    const store = createStore(synapse, {
      initialState,
      actions,
      persist: true,
    });

    store.dispatch.increment();
    store.dispatch.increment();
    store.dispatch.increment();

    vi.advanceTimersByTime(500);

    // Only one persist call with final state
    expect(synapse._request).toHaveBeenCalledTimes(1);
    expect(synapse._request).toHaveBeenCalledWith("ui/persistState", {
      state: { count: 3, label: "default" },
      version: undefined,
    });
    store.destroy();
  });

  it("visibleToAgent: true calls setVisibleState after dispatch", () => {
    const store = createStore(synapse, {
      initialState,
      actions,
      visibleToAgent: true,
    });

    store.dispatch.increment();

    expect(synapse.setVisibleState).toHaveBeenCalledWith(
      { count: 1, label: "default" },
      undefined,
    );
    store.destroy();
  });

  it("visibleToAgent with summarize includes summary", () => {
    const store = createStore(synapse, {
      initialState,
      actions,
      visibleToAgent: true,
      summarize: (s: CounterState) => `Count is ${s.count}`,
    });

    store.dispatch.increment();

    expect(synapse.setVisibleState).toHaveBeenCalledWith(
      { count: 1, label: "default" },
      "Count is 1",
    );
    store.destroy();
  });

  it("pure in-memory store (no persist, no visibleToAgent) makes no external calls", () => {
    const store = createStore(synapse, { initialState, actions });

    store.dispatch.increment();
    store.dispatch.setLabel("test");

    vi.advanceTimersByTime(1000);

    expect(synapse.setVisibleState).not.toHaveBeenCalled();
    expect(synapse._request).not.toHaveBeenCalled();
    store.destroy();
  });

  it("persist: true registers _onMessage listener for ui/stateLoaded", () => {
    const store = createStore(synapse, {
      initialState,
      actions,
      persist: true,
    });

    expect(synapse._onMessage).toHaveBeenCalledWith("ui/stateLoaded", expect.any(Function));
    store.destroy();
  });

  it("destroy() cleans up timer, subscribers, and stateLoaded listener", () => {
    const unsubStateLoaded = vi.fn();
    (synapse._onMessage as ReturnType<typeof vi.fn>).mockReturnValue(unsubStateLoaded);

    const store = createStore(synapse, {
      initialState,
      actions,
      persist: true,
    });

    const subscriber = vi.fn();
    store.subscribe(subscriber);

    // Dispatch to start a persist timer
    store.dispatch.increment();

    store.destroy();

    // Subscriber should not fire after destroy
    store.dispatch.increment();
    expect(subscriber).toHaveBeenCalledTimes(1); // only the pre-destroy call

    // Persist timer should have been cleared
    vi.advanceTimersByTime(1000);
    expect(synapse._request).not.toHaveBeenCalled();

    // stateLoaded listener should have been unsubscribed
    expect(unsubStateLoaded).toHaveBeenCalled();
  });
});

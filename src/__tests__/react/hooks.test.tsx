/**
 * `useDataSync`, `useModelContext`, `useSendMessage`, `useAction` and
 * `useFileUpload` under `<AppProvider>`.
 *
 * `useModelContext` owns the 250 ms debounce — `app.updateModelContext` sends
 * immediately — so the timing is asserted here and nowhere else.
 */
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppProvider } from "../../react/app-provider.js";
import {
  useAction,
  useDataSync,
  useFileUpload,
  useModelContext,
  useSendMessage,
} from "../../react/hooks.js";

let postMessageSpy: ReturnType<typeof vi.fn>;

function makeInitResult(hostName = "nimblebrain") {
  return {
    protocolVersion: "2026-01-26",
    hostInfo: { name: hostName, version: "1.0.0" },
    hostCapabilities: {},
    hostContext: { theme: "light", styles: { variables: {} } },
  };
}

function respondToInitialize(hostName?: string) {
  const initCall = postMessageSpy.mock.calls.find(
    (c: unknown[]) => (c[0] as Record<string, unknown>)?.method === "ui/initialize",
  );
  if (!initCall) throw new Error("No ui/initialize call found");
  const id = (initCall[0] as Record<string, unknown>).id as string;
  window.dispatchEvent(
    new MessageEvent("message", {
      data: { jsonrpc: "2.0", id, result: makeInitResult(hostName) },
    }),
  );
}

function dispatchNotification(method: string, params?: Record<string, unknown>) {
  window.dispatchEvent(
    new MessageEvent("message", {
      data: { jsonrpc: "2.0", method, ...(params !== undefined && { params }) },
    }),
  );
}

function sent(method: string): Record<string, unknown>[] {
  return postMessageSpy.mock.calls
    .map((c: unknown[]) => c[0] as Record<string, unknown>)
    .filter((m) => m?.method === method);
}

function createWrapper() {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <AppProvider name="test-app" version="1.0.0">
        {children}
      </AppProvider>
    );
  };
}

/** `<AppProvider>` renders nothing until `connect()` resolves. */
async function settle(hostName?: string) {
  await act(async () => {
    respondToInitialize(hostName);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  postMessageSpy = vi.fn();
  window.parent.postMessage = postMessageSpy;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("useDataSync", () => {
  it("runs the callback when the agent changes data", async () => {
    const cb = vi.fn();
    renderHook(() => useDataSync(cb), { wrapper: createWrapper() });
    await settle();

    act(() => {
      dispatchNotification("synapse/data-changed", { server: "people", tool: "update_contact" });
    });

    expect(cb).toHaveBeenCalledWith({
      source: "agent",
      server: "people",
      tool: "update_contact",
    });
  });

  it("uses the latest callback without re-subscribing", async () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ cb }) => useDataSync(cb), {
      wrapper: createWrapper(),
      initialProps: { cb: first },
    });
    await settle();

    rerender({ cb: second });
    act(() => {
      dispatchNotification("synapse/data-changed", { server: "s", tool: "t" });
    });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});

describe("useModelContext", () => {
  it("debounces rapid imperative pushes into one update", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useModelContext(), { wrapper: createWrapper() });
    await settle();

    act(() => {
      result.current?.({ n: 1 });
      result.current?.({ n: 2 });
      result.current?.({ n: 3 }, "three");
    });

    expect(sent("ui/update-model-context")).toHaveLength(0);

    act(() => {
      vi.advanceTimersByTime(250);
    });

    const updates = sent("ui/update-model-context");
    expect(updates).toHaveLength(1);
    expect(updates[0].params).toEqual({
      structuredContent: { n: 3 },
      content: [{ type: "text", text: "three" }],
    });
  });

  it("omits content when no summary is given", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useModelContext(), { wrapper: createWrapper() });
    await settle();

    act(() => {
      result.current?.({ n: 1 });
      vi.advanceTimersByTime(250);
    });

    expect(sent("ui/update-model-context")[0].params).toEqual({ structuredContent: { n: 1 } });
  });

  it("pushes declaratively when its deps change", async () => {
    vi.useFakeTimers();
    const { rerender } = renderHook(
      ({ board }: { board: string }) =>
        useModelContext(() => ({ state: { board }, summary: `Viewing ${board}` }), [board]),
      { wrapper: createWrapper(), initialProps: { board: "a" } },
    );
    await settle();

    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(sent("ui/update-model-context")).toHaveLength(1);

    rerender({ board: "b" });
    act(() => {
      vi.advanceTimersByTime(250);
    });

    const updates = sent("ui/update-model-context");
    expect(updates).toHaveLength(2);
    expect(updates[1].params).toMatchObject({ structuredContent: { board: "b" } });
  });

  it("drops a pending push when the component unmounts", async () => {
    vi.useFakeTimers();
    const { result, unmount } = renderHook(() => useModelContext(), { wrapper: createWrapper() });
    await settle();

    act(() => {
      result.current?.({ n: 1 });
    });
    unmount();
    act(() => {
      vi.advanceTimersByTime(250);
    });

    expect(sent("ui/update-model-context")).toHaveLength(0);
  });
});

describe("useSendMessage", () => {
  it("sends ui/message", async () => {
    const { result } = renderHook(() => useSendMessage(), { wrapper: createWrapper() });
    await settle();

    act(() => {
      result.current("hello");
    });

    expect(sent("ui/message")[0].params).toEqual({
      role: "user",
      content: [{ type: "text", text: "hello" }],
    });
  });
});

describe("useAction", () => {
  it("sends synapse/action on a NimbleBrain host", async () => {
    const { result } = renderHook(() => useAction(), { wrapper: createWrapper() });
    await settle();

    act(() => {
      result.current("navigate", { id: "b1" });
    });

    expect(sent("synapse/action")[0].params).toEqual({ action: "navigate", id: "b1" });
  });

  it("is a no-op elsewhere", async () => {
    const { result } = renderHook(() => useAction(), { wrapper: createWrapper() });
    await settle("claude");

    act(() => {
      result.current("navigate", { id: "b1" });
    });

    expect(sent("synapse/action")).toHaveLength(0);
  });
});

describe("useFileUpload", () => {
  it("flags pending while the host's picker is open", async () => {
    const { result } = renderHook(() => useFileUpload(), { wrapper: createWrapper() });
    await settle();

    expect(result.current.isPending).toBe(false);

    let pending!: Promise<unknown>;
    act(() => {
      pending = result.current.pickFile({ accept: ".csv" });
    });
    expect(result.current.isPending).toBe(true);

    const request = sent("synapse/request-file")[0];
    expect(request.params).toMatchObject({ accept: ".csv", multiple: false });

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            jsonrpc: "2.0",
            id: request.id,
            result: {
              id: "fl_0123456789abcdef01234567",
              filename: "a.csv",
              mimeType: "text/csv",
              size: 4,
            },
          },
        }),
      );
      await pending;
    });

    expect(result.current.isPending).toBe(false);
    await expect(pending).resolves.toMatchObject({ filename: "a.csv" });
  });
});

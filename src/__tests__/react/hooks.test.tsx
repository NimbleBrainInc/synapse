/**
 * `useDataSync`, `useModelContext`, `useSendMessage`, the open hooks,
 * `useNotify` and `useFileUpload` under `<AppProvider>`.
 *
 * `useModelContext` owns the 250 ms debounce — `app.updateModelContext` sends
 * immediately — so the timing is asserted here and nowhere else.
 */
import type { McpUiHostCapabilities } from "@modelcontextprotocol/ext-apps";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isSuspensionError } from "../../errors.js";
import { AppProvider } from "../../react/app-provider.js";
import {
  useCallTool,
  useDataSync,
  useFileUpload,
  useModelContext,
  useNotify,
  useOpen,
  useOpenConnectorSettings,
  useSendMessage,
} from "../../react/hooks.js";
import { FULL_HOST_CAPABILITIES } from "../helpers/host-capabilities.js";

let postMessageSpy: ReturnType<typeof vi.fn>;

/**
 * Let the client send, and let a dispatched frame reach its handler. Both
 * cross a microtask: the spec's client sends and dispatches asynchronously.
 */
async function flush(): Promise<void> {
  // Microtasks only, never a timer: a test driving fake timers would otherwise
  // wait on one that never fires. Everything the client does between a frame
  // arriving and a handler running is a microtask.
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

function makeInitResult(hostName = "nimblebrain", hostCapabilities = FULL_HOST_CAPABILITIES) {
  return {
    protocolVersion: "2026-01-26",
    hostInfo: { name: hostName, version: "1.0.0" },
    hostCapabilities,
    hostContext: { theme: "light", styles: { variables: {} } },
  };
}

async function respondToInitialize(hostName?: string, hostCapabilities?: McpUiHostCapabilities) {
  await flush();
  const initCall = postMessageSpy.mock.calls.find(
    (c: unknown[]) => (c[0] as Record<string, unknown>)?.method === "ui/initialize",
  );
  if (!initCall) throw new Error("No ui/initialize call found");
  const id = (initCall[0] as Record<string, unknown>).id;
  window.dispatchEvent(
    new MessageEvent("message", {
      source: window.parent,
      data: { jsonrpc: "2.0", id, result: makeInitResult(hostName, hostCapabilities) },
    }),
  );
  await flush();
}

async function dispatchNotification(method: string, params?: Record<string, unknown>) {
  window.dispatchEvent(
    new MessageEvent("message", {
      source: window.parent,
      data: { jsonrpc: "2.0", method, ...(params !== undefined && { params }) },
    }),
  );
  await flush();
}

/**
 * Let `useDataSync`'s scheduled call run: it waits one macrotask after the
 * notices that arrived together.
 */
async function nextTask(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await flush();
}

/** Notices dispatched back to back, as a resumed tab dispatches its queue. */
async function burst(n: number, params: (i: number) => Record<string, unknown> = () => ({})) {
  for (let i = 0; i < n; i += 1) {
    window.dispatchEvent(
      new MessageEvent("message", {
        source: window.parent,
        data: { jsonrpc: "2.0", method: "notifications/resources/list_changed", params: params(i) },
      }),
    );
  }
  await flush();
}

/** The test's clock, read by the hook through `Date.now()`. */
let now = 1_000_000;

/** Hide or show the document, as the browser does when a tab goes to the background. */
function setHidden(hidden: boolean) {
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => (hidden ? "hidden" : "visible"),
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

/** Hide the document for `ms` of wall-clock time, then show it again. */
function hideFor(ms: number) {
  setHidden(true);
  now += ms;
  setHidden(false);
}

/** A promise the test settles by hand. */
function deferred() {
  let resolve!: () => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
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
async function settle(hostName?: string, hostCapabilities?: McpUiHostCapabilities) {
  await act(async () => {
    await respondToInitialize(hostName, hostCapabilities);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  postMessageSpy = vi.fn();
  window.parent.postMessage = postMessageSpy;
  vi.spyOn(Date, "now").mockImplementation(() => now);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  // Drop the overrides so the document's own visibility shows through again.
  Reflect.deleteProperty(document, "hidden");
  Reflect.deleteProperty(document, "visibilityState");
});

describe("useDataSync", () => {
  it("runs the callback with the params when the app's server announces a change", async () => {
    const cb = vi.fn();
    renderHook(() => useDataSync(cb), { wrapper: createWrapper() });
    await settle();

    await act(async () => {
      await dispatchNotification("notifications/resources/list_changed", { _meta: { k: "v" } });
      await nextTask();
    });

    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith({ _meta: { k: "v" } });
  });

  it("hands the callback an empty object when the notification carries no params", async () => {
    const cb = vi.fn();
    renderHook(() => useDataSync(cb), { wrapper: createWrapper() });
    await settle();

    await act(async () => {
      await dispatchNotification("notifications/resources/list_changed");
      await nextTask();
    });

    expect(cb).toHaveBeenCalledWith({});
  });

  it("does not run on synapse/data-changed", async () => {
    const cb = vi.fn();
    renderHook(() => useDataSync(cb), { wrapper: createWrapper() });
    await settle();

    await act(async () => {
      await dispatchNotification("synapse/data-changed", {
        server: "people",
        tool: "update_contact",
      });
      await nextTask();
    });

    expect(cb).not.toHaveBeenCalled();
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
    await act(async () => {
      await dispatchNotification("notifications/resources/list_changed", {});
      await nextTask();
    });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
  it("runs once, with the latest params, for a burst of notices dispatched together", async () => {
    const cb = vi.fn();
    renderHook(() => useDataSync(cb), { wrapper: createWrapper() });
    await settle();

    await act(async () => {
      await burst(36, (i) => ({ _meta: { n: i } }));
      await nextTask();
    });

    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith({ _meta: { n: 35 } });
  });

  it("collapses a burst for a callback that returns nothing, and runs again for a later notice", async () => {
    const cb = vi.fn((_params: unknown): void => {});
    renderHook(() => useDataSync(cb), { wrapper: createWrapper() });
    await settle();

    await act(async () => {
      await burst(5);
      await nextTask();
    });
    expect(cb).toHaveBeenCalledTimes(1);

    await act(async () => {
      await burst(5);
      await nextTask();
    });
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it("runs exactly one trailing call for notices that arrive while the returned promise is pending", async () => {
    const calls: ReturnType<typeof deferred>[] = [];
    const cb = vi.fn((_params: unknown) => {
      const d = deferred();
      calls.push(d);
      return d.promise;
    });
    renderHook(() => useDataSync(cb), { wrapper: createWrapper() });
    await settle();

    await act(async () => {
      await burst(1);
      await nextTask();
    });
    expect(cb).toHaveBeenCalledTimes(1);

    // Ten notices across several tasks while the first re-read is in flight.
    await act(async () => {
      for (let i = 0; i < 10; i += 1) {
        await burst(1, () => ({ _meta: { n: i } }));
        await nextTask();
      }
    });
    expect(cb).toHaveBeenCalledTimes(1);

    await act(async () => {
      calls[0]?.resolve();
      await flush();
      await nextTask();
    });
    expect(cb).toHaveBeenCalledTimes(2);
    expect(cb).toHaveBeenLastCalledWith({ _meta: { n: 9 } });

    // Nothing arrived during the trailing call, so settling it runs nothing.
    await act(async () => {
      calls[1]?.resolve();
      await flush();
      await nextTask();
    });
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it("runs the trailing call when the in-flight promise rejects", async () => {
    const calls: ReturnType<typeof deferred>[] = [];
    const cb = vi.fn((_params: unknown) => {
      const d = deferred();
      calls.push(d);
      return d.promise;
    });
    renderHook(() => useDataSync(cb), { wrapper: createWrapper() });
    await settle();

    await act(async () => {
      await burst(1);
      await nextTask();
      await burst(3);
      await nextTask();
    });
    expect(cb).toHaveBeenCalledTimes(1);

    await act(async () => {
      calls[0]?.reject(new Error("re-read failed"));
      await flush();
      await nextTask();
    });
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it("does not run for a notice still waiting to run when the view unmounts", async () => {
    const cb = vi.fn();
    const { unmount } = renderHook(() => useDataSync(cb), { wrapper: createWrapper() });
    await settle();

    await act(async () => {
      await burst(3);
      unmount();
      await nextTask();
    });

    expect(cb).not.toHaveBeenCalled();
  });

  it("does not run the trailing call when the view unmounts while a promise is pending", async () => {
    const d = deferred();
    const cb = vi.fn((_params: unknown) => d.promise);
    const { unmount } = renderHook(() => useDataSync(cb), { wrapper: createWrapper() });
    await settle();

    await act(async () => {
      await burst(1);
      await nextTask();
      await burst(2);
      await nextTask();
    });
    expect(cb).toHaveBeenCalledTimes(1);

    unmount();
    await act(async () => {
      d.resolve();
      await flush();
      await nextTask();
    });
    expect(cb).toHaveBeenCalledTimes(1);
  });

  describe("on resume", () => {
    it("runs once, with {}, when the view is shown after a long hide", async () => {
      const cb = vi.fn();
      renderHook(() => useDataSync(cb), { wrapper: createWrapper() });
      await settle();

      await act(async () => {
        hideFor(60 * 60_000);
        await nextTask();
      });

      expect(cb).toHaveBeenCalledTimes(1);
      expect(cb).toHaveBeenCalledWith({});
    });

    it("does not run for a short hide", async () => {
      const cb = vi.fn();
      renderHook(() => useDataSync(cb), { wrapper: createWrapper() });
      await settle();

      await act(async () => {
        hideFor(59_999);
        await nextTask();
      });

      expect(cb).not.toHaveBeenCalled();
    });

    it("does not run on mount, nor when the view is shown without having been hidden", async () => {
      const cb = vi.fn();
      renderHook(() => useDataSync(cb), { wrapper: createWrapper() });
      await settle();
      await act(async () => {
        now += 60 * 60_000;
        setHidden(false);
        await nextTask();
      });

      expect(cb).not.toHaveBeenCalled();
    });

    it("joins notices dispatched on resume into one call, keeping the latest notice's params", async () => {
      const cb = vi.fn();
      renderHook(() => useDataSync(cb), { wrapper: createWrapper() });
      await settle();

      await act(async () => {
        hideFor(60 * 60_000);
        await burst(4, (i) => ({ _meta: { n: i } }));
        await nextTask();
      });

      expect(cb).toHaveBeenCalledTimes(1);
      expect(cb).toHaveBeenCalledWith({ _meta: { n: 3 } });
    });

    it("waits behind a call in flight and runs one trailing call", async () => {
      const calls: ReturnType<typeof deferred>[] = [];
      const cb = vi.fn((_params: unknown) => {
        const d = deferred();
        calls.push(d);
        return d.promise;
      });
      renderHook(() => useDataSync(cb), { wrapper: createWrapper() });
      await settle();

      await act(async () => {
        await burst(1);
        await nextTask();
      });
      expect(cb).toHaveBeenCalledTimes(1);

      // A resume and queued notices while the first re-read is pending.
      await act(async () => {
        hideFor(60 * 60_000);
        await burst(3);
        await nextTask();
      });
      expect(cb).toHaveBeenCalledTimes(1);

      await act(async () => {
        calls[0]?.resolve();
        await flush();
        await nextTask();
      });
      expect(cb).toHaveBeenCalledTimes(2);

      await act(async () => {
        calls[1]?.resolve();
        await flush();
        await nextTask();
      });
      expect(cb).toHaveBeenCalledTimes(2);
    });

    it("does not run after the view unmounts", async () => {
      const cb = vi.fn();
      const { unmount } = renderHook(() => useDataSync(cb), { wrapper: createWrapper() });
      await settle();

      await act(async () => {
        setHidden(true);
        unmount();
        now += 60 * 60_000;
        setHidden(false);
        await nextTask();
      });

      expect(cb).not.toHaveBeenCalled();
    });

    it("counts a view mounted while hidden from mount", async () => {
      setHidden(true);
      const cb = vi.fn();
      renderHook(() => useDataSync(cb), { wrapper: createWrapper() });
      await settle();

      await act(async () => {
        now += 60 * 60_000;
        setHidden(false);
        await nextTask();
      });

      expect(cb).toHaveBeenCalledTimes(1);
    });
  });
});

describe("useCallTool", () => {
  async function failLastToolCall(data?: unknown) {
    const call = sent("tools/call").at(-1);
    window.dispatchEvent(
      new MessageEvent("message", {
        source: window.parent,
        data: {
          jsonrpc: "2.0",
          id: call?.id,
          error: {
            code: -32001,
            message: "Request timed out",
            ...(data !== undefined && { data }),
          },
        },
      }),
    );
    await flush();
  }

  it("does not resend a call the page's suspension interrupted; error holds the host's answer", async () => {
    const { result } = renderHook(() => useCallTool("archive_item"), {
      wrapper: createWrapper(),
    });
    await settle();

    await act(async () => {
      const done = result.current.call().catch(() => {});
      await flush();
      await failLastToolCall({ suspendedMs: 3_600_000 });
      await done;
    });

    expect(sent("tools/call")).toHaveLength(1);
    expect(isSuspensionError(result.current.error)).toBe(true);
  });
});

describe("useModelContext", () => {
  it("debounces rapid imperative pushes into one update", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useModelContext(), { wrapper: createWrapper() });
    await settle();

    await act(async () => {
      result.current?.({ n: 1 });
      result.current?.({ n: 2 });
      result.current?.({ n: 3 }, "three");
    });

    expect(sent("ui/update-model-context")).toHaveLength(0);

    await act(async () => {
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

    await act(async () => {
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

    await act(async () => {
      vi.advanceTimersByTime(250);
    });
    expect(sent("ui/update-model-context")).toHaveLength(1);

    rerender({ board: "b" });
    await act(async () => {
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

    await act(async () => {
      result.current?.({ n: 1 });
    });
    unmount();
    await act(async () => {
      vi.advanceTimersByTime(250);
    });

    expect(sent("ui/update-model-context")).toHaveLength(0);
  });
});

describe("useSendMessage", () => {
  it("sends ui/message", async () => {
    const { result } = renderHook(() => useSendMessage(), { wrapper: createWrapper() });
    await settle();

    await act(async () => {
      result.current("hello");
    });

    expect(sent("ui/message")[0].params).toEqual({
      role: "user",
      content: [{ type: "text", text: "hello" }],
    });
  });
});

describe("the open hooks", () => {
  /** Answer the one request sent under `method`, and return its params. */
  async function answer(method: string): Promise<unknown> {
    const request = sent(method)[0];
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          source: window.parent,
          data: { jsonrpc: "2.0", id: request.id, result: {} },
        }),
      );
      await flush();
    });
    return request.params;
  }

  it("useOpen sends the URI and resolves true once the host answers", async () => {
    const { result } = renderHook(() => useOpen(), { wrapper: createWrapper() });
    await settle();
    let opened!: Promise<boolean>;
    await act(async () => {
      opened = result.current("files://fl_1");
      await flush();
    });
    expect(await answer("ai.nimblebrain/open")).toEqual({ uri: "files://fl_1" });
    await expect(opened).resolves.toBe(true);
  });

  it("useOpenConnectorSettings sends no params", async () => {
    const { result } = renderHook(() => useOpenConnectorSettings(), { wrapper: createWrapper() });
    await settle();
    let opened!: Promise<boolean>;
    await act(async () => {
      opened = result.current();
      await flush();
    });
    expect(await answer("ai.nimblebrain/open-connector-settings")).toEqual({});
    await expect(opened).resolves.toBe(true);
  });

  it("each resolves false without sending where the host did not declare it", async () => {
    const { result } = renderHook(
      () => ({
        open: useOpen(),
        settings: useOpenConnectorSettings(),
      }),
      { wrapper: createWrapper() },
    );
    await settle("nimblebrain", {});
    await expect(result.current.open("files://fl_1")).resolves.toBe(false);
    await expect(result.current.settings()).resolves.toBe(false);
    expect(sent("ai.nimblebrain/open")).toHaveLength(0);
    expect(sent("ai.nimblebrain/open-connector-settings")).toHaveLength(0);
  });
});

describe("useNotify", () => {
  it("sends ai.nimblebrain/notify and resolves true once the host answers", async () => {
    const { result } = renderHook(() => useNotify(), { wrapper: createWrapper() });
    await settle();

    let shown!: Promise<boolean>;
    await act(async () => {
      shown = result.current({ level: "success", title: "Report exported" });
      await flush();
    });

    const request = sent("ai.nimblebrain/notify")[0];
    expect(request.params).toEqual({ level: "success", title: "Report exported" });

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          source: window.parent,
          data: { jsonrpc: "2.0", id: request.id, result: {} },
        }),
      );
      await flush();
    });
    await expect(shown).resolves.toBe(true);
  });

  it("resolves false without sending where the host did not declare it", async () => {
    const { result } = renderHook(() => useNotify(), { wrapper: createWrapper() });
    await settle("nimblebrain", {});

    await expect(result.current({ level: "info", title: "x" })).resolves.toBe(false);
    expect(sent("ai.nimblebrain/notify")).toHaveLength(0);
  });
});

describe("useFileUpload", () => {
  it("flags pending while the host's picker is open", async () => {
    const { result } = renderHook(() => useFileUpload(), { wrapper: createWrapper() });
    await settle();

    expect(result.current.isPending).toBe(false);

    let pending!: Promise<unknown>;
    await act(async () => {
      pending = result.current.pickFile({ accept: ".csv" });
    });
    expect(result.current.isPending).toBe(true);

    const request = sent("ai.nimblebrain/request-file")[0];
    expect(request.params).toMatchObject({ accept: ".csv", multiple: false });

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          source: window.parent,
          data: {
            jsonrpc: "2.0",
            id: request.id,
            result: {
              files: [
                {
                  id: "fl_0123456789abcdef01234567",
                  filename: "a.csv",
                  mimeType: "text/csv",
                  size: 4,
                },
              ],
            },
          },
        }),
      );
      await pending;
    });

    expect(result.current.isPending).toBe(false);
    await expect(pending).resolves.toMatchObject({ filename: "a.csv" });
  });

  it("uploads files the app holds over upload-files, pending until the host answers", async () => {
    const { result } = renderHook(() => useFileUpload(), { wrapper: createWrapper() });
    await settle();

    const file = new File(["a,b"], "a.csv", { type: "text/csv" });
    let pending!: Promise<unknown>;
    await act(async () => {
      pending = result.current.uploadFiles([file]);
    });
    expect(result.current.isPending).toBe(true);
    expect(sent("ai.nimblebrain/request-file")).toHaveLength(0);

    // The file is read before the request goes out.
    await act(async () => {
      await vi.waitFor(() => expect(sent("ai.nimblebrain/upload-files")).toHaveLength(1));
    });
    const request = sent("ai.nimblebrain/upload-files")[0];
    const copy = (request.params as { files: File[] }).files[0] as File;
    expect([copy.name, copy.size]).toEqual(["a.csv", 3]);

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          source: window.parent,
          data: {
            jsonrpc: "2.0",
            id: request.id,
            result: {
              files: [
                {
                  id: "fl_0123456789abcdef01234567",
                  filename: "a.csv",
                  mimeType: "text/csv",
                  size: 3,
                },
              ],
            },
          },
        }),
      );
      await pending;
    });

    expect(result.current.isPending).toBe(false);
    await expect(pending).resolves.toMatchObject([{ filename: "a.csv" }]);
  });
});

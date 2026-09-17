import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppProvider } from "../../react/app-provider.js";
import { useHostContext, useTheme } from "../../react/hooks.js";
import { FULL_HOST_CAPABILITIES } from "../helpers/host-capabilities.js";

// --- Helpers ---

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

function makeInitResult(hostContext?: Record<string, unknown>) {
  return {
    protocolVersion: "2026-01-26",
    hostInfo: { name: "nimblebrain", version: "1.0.0" },
    hostCapabilities: FULL_HOST_CAPABILITIES,
    hostContext: hostContext ?? { theme: "dark", styles: { variables: {} } },
  };
}

/**
 * Answer `ui/initialize`, then let the `connect()` promise and the provider's
 * setState settle — `<AppProvider>` renders nothing until it has an `App`.
 */
async function completeHandshake(hostContext?: Record<string, unknown>) {
  await flush();
  const initCall = postMessageSpy.mock.calls.find(
    (c: unknown[]) =>
      c[0] &&
      typeof c[0] === "object" &&
      (c[0] as Record<string, unknown>).method === "ui/initialize",
  );
  if (!initCall) throw new Error("No ui/initialize call found");
  const id = (initCall[0] as Record<string, unknown>).id;
  window.dispatchEvent(
    new MessageEvent("message", {
      source: window.parent,
      data: { jsonrpc: "2.0", id, result: makeInitResult(hostContext) },
    }),
  );
  await new Promise((r) => setTimeout(r, 0));
}

async function dispatchHostContextChanged(params: Record<string, unknown>) {
  window.dispatchEvent(
    new MessageEvent("message", {
      source: window.parent,
      data: {
        jsonrpc: "2.0",
        method: "ui/notifications/host-context-changed",
        params,
      },
    }),
  );
  await flush();
}

function wrapper({ children }: { children: ReactNode }) {
  return (
    <AppProvider name="test-app" version="1.0.0">
      {children}
    </AppProvider>
  );
}

// --- Tests ---

describe("useHostContext / useTheme React hooks", () => {
  beforeEach(() => {
    postMessageSpy = vi.fn();
    window.parent.postMessage = postMessageSpy;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("useHostContext", () => {
    it("returns the handshake host context after ready", async () => {
      const { result } = renderHook(() => useHostContext(), { wrapper });
      await act(async () => {
        await completeHandshake({
          theme: "dark",
          styles: { variables: {} },
          workspace: { id: "ws_a", name: "Alpha" },
        });
      });
      expect(result.current).toMatchObject({
        theme: "dark",
        workspace: { id: "ws_a", name: "Alpha" },
      });
    });

    it("re-renders when host-context-changed fires", async () => {
      const renderCount = vi.fn();
      const { result } = renderHook(
        () => {
          renderCount();
          return useHostContext<{ workspace?: { id: string } }>();
        },
        { wrapper },
      );
      await act(async () => {
        await completeHandshake({ theme: "dark", styles: { variables: {} } });
      });

      const before = renderCount.mock.calls.length;
      await act(async () => {
        await dispatchHostContextChanged({
          theme: "dark",
          styles: { variables: {} },
          workspace: { id: "ws_b", name: "Beta" },
        });
      });

      expect(renderCount.mock.calls.length).toBeGreaterThan(before);
      expect(result.current.workspace?.id).toBe("ws_b");
    });
  });

  describe("useTheme", () => {
    it("returns the derived theme after handshake", async () => {
      const { result } = renderHook(() => useTheme(), { wrapper });
      await act(async () => {
        await completeHandshake({
          theme: "dark",
          styles: { variables: { "--color-background-primary": "#000" } },
        });
      });
      expect(result.current.mode).toBe("dark");
      expect(result.current.tokens).toEqual({ "--color-background-primary": "#000" });
    });

    it("does NOT re-render on workspace-only host-context changes", async () => {
      // Contract: useTheme is a filtered selector. A host-context-changed
      // notification that leaves theme/styles untouched (e.g. only workspace
      // moved) must not cause theme consumers to re-render.
      const renderCount = vi.fn();
      renderHook(
        () => {
          renderCount();
          return useTheme();
        },
        { wrapper },
      );
      await act(async () => {
        await completeHandshake({ theme: "dark", styles: { variables: {} } });
      });

      const before = renderCount.mock.calls.length;
      await act(async () => {
        await dispatchHostContextChanged({
          theme: "dark",
          styles: { variables: {} },
          workspace: { id: "ws_a", name: "Alpha" },
        });
        await dispatchHostContextChanged({
          theme: "dark",
          styles: { variables: {} },
          workspace: { id: "ws_b", name: "Beta" },
        });
      });

      // Allow the initial useEffect-triggered setTheme(getTheme()) to settle
      // by comparing render counts before/after the two notifications. Two
      // workspace-only notifications must produce zero re-renders.
      expect(renderCount.mock.calls.length).toBe(before);
    });

    it("re-renders when the theme actually changes", async () => {
      const renderCount = vi.fn();
      const { result } = renderHook(
        () => {
          renderCount();
          return useTheme();
        },
        { wrapper },
      );
      await act(async () => {
        await completeHandshake({ theme: "dark", styles: { variables: {} } });
      });

      const before = renderCount.mock.calls.length;
      await act(async () => {
        await dispatchHostContextChanged({ theme: "light", styles: { variables: {} } });
      });

      expect(renderCount.mock.calls.length).toBeGreaterThan(before);
      expect(result.current.mode).toBe("light");
    });
  });
});

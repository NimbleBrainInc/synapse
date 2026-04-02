import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppProvider } from "../../react/app-provider.js";
import {
  useApp,
  useConnectTheme,
  useResize,
  useToolInput,
  useToolResult,
} from "../../react/connect-hooks.js";

// --- Helpers ---

let postMessageSpy: ReturnType<typeof vi.fn>;

function makeInitResult(overrides?: Record<string, unknown>) {
  return {
    protocolVersion: "2026-01-26",
    hostInfo: { name: "test-host", version: "2.0.0" },
    hostCapabilities: {},
    hostContext: {
      theme: "dark",
      styles: { variables: { "--bg": "#111" } },
      toolInfo: { tool: { name: "search", description: "Search tool" } },
      containerDimensions: { width: 400, height: 600 },
    },
    ...overrides,
  };
}

/**
 * Respond to the ui/initialize request that connect() sends.
 * Must be called after rendering a component tree with <AppProvider>.
 */
function respondToInitialize(initResult?: Record<string, unknown>) {
  const initCall = postMessageSpy.mock.calls.find(
    (c: unknown[]) =>
      c[0] &&
      typeof c[0] === "object" &&
      (c[0] as Record<string, unknown>).method === "ui/initialize",
  );
  if (!initCall) throw new Error("No ui/initialize call found");

  const id = (initCall[0] as Record<string, unknown>).id as string;
  window.dispatchEvent(
    new MessageEvent("message", {
      data: { jsonrpc: "2.0", id, result: initResult ?? makeInitResult() },
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

function createWrapper() {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <AppProvider name="test-app" version="1.0.0">
        {children}
      </AppProvider>
    );
  };
}

// --- Tests ---

describe("connect-hooks", () => {
  beforeEach(() => {
    postMessageSpy = vi.fn();
    window.parent.postMessage = postMessageSpy;

    Object.defineProperty(document.body, "scrollWidth", { value: 800, configurable: true });
    Object.defineProperty(document.body, "scrollHeight", { value: 600, configurable: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("AppProvider + useApp", () => {
    it("provides the App object after connect resolves", async () => {
      const { result, rerender } = renderHook(() => useApp(), {
        wrapper: createWrapper(),
      });

      // Before handshake completes, the hook hasn't rendered (AppProvider returns null)
      // So result.current should throw since the context has no value
      // Actually, since AppProvider returns null before connect, the hook won't mount at all
      // We need to complete the handshake first

      await act(async () => {
        respondToInitialize();
        // Let microtasks resolve (connect() promise + setState)
        await new Promise((r) => setTimeout(r, 0));
      });

      rerender();

      expect(result.current).toBeDefined();
      expect(typeof result.current.on).toBe("function");
      expect(typeof result.current.resize).toBe("function");
      expect(typeof result.current.destroy).toBe("function");
    });
  });

  describe("useToolResult", () => {
    it("returns null initially, updates when tool-result event fires", async () => {
      const { result, rerender } = renderHook(() => useToolResult(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        respondToInitialize();
        await new Promise((r) => setTimeout(r, 0));
      });

      rerender();

      // Initially null
      expect(result.current).toBeNull();

      // Fire a tool-result event
      await act(async () => {
        dispatchNotification("ui/notifications/tool-result", {
          content: [{ type: "text", text: '{"items":[1,2]}' }],
        });
      });

      expect(result.current).toBeDefined();
      expect(result.current?.content).toEqual({ items: [1, 2] });
    });
  });

  describe("useToolInput", () => {
    it("returns null initially, updates on tool-input event", async () => {
      const { result, rerender } = renderHook(() => useToolInput(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        respondToInitialize();
        await new Promise((r) => setTimeout(r, 0));
      });

      rerender();

      expect(result.current).toBeNull();

      await act(async () => {
        dispatchNotification("ui/notifications/tool-input", {
          query: "search term",
        });
      });

      expect(result.current).toEqual({ query: "search term" });
    });
  });

  describe("useConnectTheme", () => {
    it("returns initial theme from host context", async () => {
      const { result, rerender } = renderHook(() => useConnectTheme(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        respondToInitialize();
        await new Promise((r) => setTimeout(r, 0));
      });

      rerender();

      expect(result.current).toEqual({ mode: "dark", tokens: { "--bg": "#111" } });
    });

    it("updates when theme-changed event fires", async () => {
      const { result, rerender } = renderHook(() => useConnectTheme(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        respondToInitialize();
        await new Promise((r) => setTimeout(r, 0));
      });

      rerender();

      await act(async () => {
        dispatchNotification("ui/notifications/host-context-changed", {
          theme: "light",
          styles: { variables: { "--bg": "#fff" } },
        });
      });

      expect(result.current).toEqual({ mode: "light", tokens: { "--bg": "#fff" } });
    });
  });

  describe("useResize", () => {
    it("returns a function that triggers resize", async () => {
      const { result, rerender } = renderHook(() => useResize(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        respondToInitialize();
        await new Promise((r) => setTimeout(r, 0));
      });

      rerender();
      postMessageSpy.mockClear();

      act(() => {
        result.current(300, 500);
      });

      expect(postMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "ui/notifications/size-changed",
          params: { width: 300, height: 500 },
        }),
        "*",
      );
    });
  });

  describe("hooks outside AppProvider", () => {
    it("useApp throws when used outside AppProvider", () => {
      expect(() => {
        renderHook(() => useApp());
      }).toThrow("useApp must be used within an <AppProvider>");
    });

    it("useToolResult throws when used outside AppProvider", () => {
      expect(() => {
        renderHook(() => useToolResult());
      }).toThrow("useApp must be used within an <AppProvider>");
    });

    it("useToolInput throws when used outside AppProvider", () => {
      expect(() => {
        renderHook(() => useToolInput());
      }).toThrow("useApp must be used within an <AppProvider>");
    });

    it("useResize throws when used outside AppProvider", () => {
      expect(() => {
        renderHook(() => useResize());
      }).toThrow("useApp must be used within an <AppProvider>");
    });

    it("useConnectTheme throws when used outside AppProvider", () => {
      expect(() => {
        renderHook(() => useConnectTheme());
      }).toThrow("useApp must be used within an <AppProvider>");
    });
  });
});

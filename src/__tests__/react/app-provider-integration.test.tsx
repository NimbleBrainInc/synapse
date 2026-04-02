import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppProvider } from "../../react/app-provider.js";
import { useApp, useConnectTheme, useToolResult } from "../../react/connect-hooks.js";
import { SynapseProvider, useCallTool, useSynapse } from "../../react/hooks.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function respondToLastRequest(result: unknown) {
  const calls = postMessageSpy.mock.calls;
  for (let i = calls.length - 1; i >= 0; i--) {
    const msg = calls[i][0] as Record<string, unknown>;
    if (msg.id && msg.method) {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { jsonrpc: "2.0", id: msg.id, result },
        }),
      );
      return;
    }
  }
  throw new Error("No pending request found");
}

function createAppWrapper() {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <AppProvider name="test-app" version="1.0.0">
        {children}
      </AppProvider>
    );
  };
}

function createSynapseWrapper() {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <SynapseProvider name="test-app" version="1.0.0">
        {children}
      </SynapseProvider>
    );
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("React integration", () => {
  beforeEach(() => {
    postMessageSpy = vi.fn();
    window.parent.postMessage = postMessageSpy;

    Object.defineProperty(document.body, "scrollWidth", { value: 800, configurable: true });
    Object.defineProperty(document.body, "scrollHeight", { value: 600, configurable: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -----------------------------------------------------------------------
  // 1. AppProvider + useToolResult end-to-end
  // -----------------------------------------------------------------------
  describe("AppProvider + useToolResult end-to-end", () => {
    it("host handshake -> host sends tool-result -> useToolResult renders data", async () => {
      const { result, rerender } = renderHook(() => useToolResult(), {
        wrapper: createAppWrapper(),
      });

      // Complete handshake
      await act(async () => {
        respondToInitialize();
        await new Promise((r) => setTimeout(r, 0));
      });
      rerender();

      // Initially null
      expect(result.current).toBeNull();

      // Host sends tool-result with JSON content
      await act(async () => {
        dispatchNotification("ui/notifications/tool-result", {
          content: [{ type: "text", text: '{"users":["alice","bob"]}' }],
        });
      });

      expect(result.current).not.toBeNull();
      expect(result.current?.content).toEqual({ users: ["alice", "bob"] });
      expect(result.current?.structuredContent).toBeNull();
      expect(result.current?.raw).toEqual({
        content: [{ type: "text", text: '{"users":["alice","bob"]}' }],
      });
    });

    it("subsequent tool-results update the hook value", async () => {
      const { result, rerender } = renderHook(() => useToolResult(), {
        wrapper: createAppWrapper(),
      });

      await act(async () => {
        respondToInitialize();
        await new Promise((r) => setTimeout(r, 0));
      });
      rerender();

      // First result
      await act(async () => {
        dispatchNotification("ui/notifications/tool-result", {
          content: [{ type: "text", text: '{"v":1}' }],
        });
      });
      expect(result.current?.content).toEqual({ v: 1 });

      // Second result replaces the first
      await act(async () => {
        dispatchNotification("ui/notifications/tool-result", {
          structuredContent: { v: 2, extra: true },
        });
      });
      expect(result.current?.content).toEqual({ v: 2, extra: true });
      expect(result.current?.structuredContent).toEqual({ v: 2, extra: true });
    });
  });

  // -----------------------------------------------------------------------
  // 2. AppProvider + useConnectTheme end-to-end
  // -----------------------------------------------------------------------
  describe("AppProvider + useConnectTheme end-to-end", () => {
    it("host sends host-context-changed -> useConnectTheme re-renders with new theme", async () => {
      const { result, rerender } = renderHook(() => useConnectTheme(), {
        wrapper: createAppWrapper(),
      });

      await act(async () => {
        respondToInitialize();
        await new Promise((r) => setTimeout(r, 0));
      });
      rerender();

      // Initial theme from handshake
      expect(result.current).toEqual({ mode: "dark", tokens: { "--bg": "#111" } });

      // Host changes theme
      await act(async () => {
        dispatchNotification("ui/notifications/host-context-changed", {
          theme: "light",
          styles: { variables: { "--bg": "#fff", "--text": "#000" } },
        });
      });

      expect(result.current).toEqual({
        mode: "light",
        tokens: { "--bg": "#fff", "--text": "#000" },
      });
    });
  });

  // -----------------------------------------------------------------------
  // 3. AppProvider + useApp + callTool integration
  // -----------------------------------------------------------------------
  describe("AppProvider + useApp + callTool", () => {
    it("callTool through useApp sends request and returns parsed result", async () => {
      const { result, rerender } = renderHook(() => useApp(), {
        wrapper: createAppWrapper(),
      });

      await act(async () => {
        respondToInitialize();
        await new Promise((r) => setTimeout(r, 0));
      });
      rerender();

      const appInstance = result.current;
      expect(appInstance).toBeDefined();

      postMessageSpy.mockClear();

      let toolResult: unknown;
      await act(async () => {
        const promise = appInstance.callTool("search", { query: "test" });
        respondToLastRequest({
          content: [{ type: "text", text: '{"results":["a","b"]}' }],
        });
        toolResult = await promise;
      });

      expect(toolResult).toEqual({
        data: { results: ["a", "b"] },
        isError: false,
      });
    });
  });

  // -----------------------------------------------------------------------
  // 4. Backwards compat: SynapseProvider + useSynapse + useCallTool
  // -----------------------------------------------------------------------
  describe("backwards compat: SynapseProvider + legacy hooks", () => {
    it("SynapseProvider + useSynapse provides the Synapse instance", async () => {
      const { result } = renderHook(() => useSynapse(), {
        wrapper: createSynapseWrapper(),
      });

      // SynapseProvider renders children immediately (unlike AppProvider)
      expect(result.current).toBeDefined();
      expect(typeof result.current.callTool).toBe("function");
      expect(typeof result.current.destroy).toBe("function");
      expect(typeof result.current.chat).toBe("function");
      expect(typeof result.current.onDataChanged).toBe("function");
    });

    it("SynapseProvider + useCallTool sends request and resolves", async () => {
      const { result } = renderHook(() => useCallTool("echo"), {
        wrapper: createSynapseWrapper(),
      });

      // Complete the handshake for SynapseProvider (uses createSynapse internally)
      const initCall = postMessageSpy.mock.calls.find(
        (c: unknown[]) =>
          c[0] &&
          typeof c[0] === "object" &&
          (c[0] as Record<string, unknown>).method === "ui/initialize",
      );
      expect(initCall).toBeDefined();

      const id = (initCall?.[0] as Record<string, unknown>).id as string;
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            jsonrpc: "2.0",
            id,
            result: {
              protocolVersion: "2026-01-26",
              hostInfo: { name: "nimblebrain", version: "1.0.0" },
              hostCapabilities: {},
              hostContext: { theme: "dark", styles: { variables: {} } },
            },
          },
        }),
      );

      // Wait for ready
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });

      expect(result.current.isPending).toBe(false);
      expect(result.current.data).toBeNull();
      expect(result.current.error).toBeNull();

      // Call the tool
      postMessageSpy.mockClear();
      await act(async () => {
        const callPromise = result.current.call({ text: "hello" });
        respondToLastRequest({
          content: [{ type: "text", text: '{"echo":"hello"}' }],
        });
        await callPromise;
      });

      expect(result.current.data).toEqual({ echo: "hello" });
      expect(result.current.isPending).toBe(false);
    });
  });
});

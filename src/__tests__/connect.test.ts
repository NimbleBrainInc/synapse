import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connect } from "../connect.js";
import type { App } from "../types.js";

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
 * Complete the ext-apps handshake by responding to the ui/initialize request.
 * Returns the Promise<App> from connect().
 */
function connectAndHandshake(
  options?: Partial<Parameters<typeof connect>[0]>,
  initResult?: Record<string, unknown>,
): Promise<App> {
  const promise = connect({
    name: "test-app",
    version: "1.0.0",
    ...options,
  });

  // Find the ui/initialize request and respond
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

  return promise;
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

// --- Tests ---

describe("connect()", () => {
  let app: App;

  beforeEach(() => {
    postMessageSpy = vi.fn();
    window.parent.postMessage = postMessageSpy;

    // Mock body dimensions for resize
    Object.defineProperty(document.body, "scrollWidth", { value: 800, configurable: true });
    Object.defineProperty(document.body, "scrollHeight", { value: 600, configurable: true });
  });

  afterEach(() => {
    app?.destroy();
  });

  describe("handshake", () => {
    it("resolves after host responds to ui/initialize", async () => {
      app = await connectAndHandshake();
      expect(app).toBeDefined();
      expect(typeof app.on).toBe("function");
      expect(typeof app.destroy).toBe("function");
    });

    it("sends initial size BEFORE ui/initialize", async () => {
      app = await connectAndHandshake();

      // Find the order of messages
      const methods = postMessageSpy.mock.calls
        .map((c: unknown[]) => (c[0] as Record<string, unknown>).method)
        .filter(Boolean);

      const sizeIdx = methods.indexOf("ui/notifications/size-changed");
      const initIdx = methods.indexOf("ui/initialize");
      expect(sizeIdx).toBeGreaterThanOrEqual(0);
      expect(initIdx).toBeGreaterThan(sizeIdx);
    });

    it("sends ui/notifications/initialized after host response", async () => {
      app = await connectAndHandshake();

      const initializedCall = postMessageSpy.mock.calls.find(
        (c: unknown[]) =>
          (c[0] as Record<string, unknown>).method === "ui/notifications/initialized",
      );
      expect(initializedCall).toBeDefined();
    });

    it("sends initial size with body dimensions", async () => {
      app = await connectAndHandshake();

      const sizeCall = postMessageSpy.mock.calls.find(
        (c: unknown[]) =>
          (c[0] as Record<string, unknown>).method === "ui/notifications/size-changed",
      );
      expect(sizeCall?.[0]).toMatchObject({
        method: "ui/notifications/size-changed",
        params: { width: 800, height: 600 },
      });
    });
  });

  describe("host context extraction", () => {
    it("extracts theme from host response", async () => {
      app = await connectAndHandshake();
      expect(app.theme).toEqual({ mode: "dark", tokens: { "--bg": "#111" } });
    });

    it("extracts hostInfo from host response", async () => {
      app = await connectAndHandshake();
      expect(app.hostInfo).toEqual({ name: "test-host", version: "2.0.0" });
    });

    it("extracts toolInfo from host response", async () => {
      app = await connectAndHandshake();
      expect(app.toolInfo).toEqual({
        tool: { name: "search", description: "Search tool" },
      });
    });

    it("extracts containerDimensions from host response", async () => {
      app = await connectAndHandshake();
      expect(app.containerDimensions).toEqual({ width: 400, height: 600 });
    });

    it("defaults theme to light with empty tokens when not provided", async () => {
      app = await connectAndHandshake(undefined, {
        protocolVersion: "2026-01-26",
        hostInfo: { name: "bare", version: "1.0.0" },
        hostCapabilities: {},
      });
      expect(app.theme).toEqual({ mode: "light", tokens: {} });
    });

    it("defaults hostInfo to unknown when serverInfo is missing", async () => {
      app = await connectAndHandshake(undefined, {
        protocolVersion: "2026-01-26",
        capabilities: {},
      });
      expect(app.hostInfo).toEqual({ name: "unknown", version: "unknown" });
    });

    it("toolInfo is null when not provided", async () => {
      app = await connectAndHandshake(undefined, {
        protocolVersion: "2026-01-26",
        hostInfo: { name: "bare", version: "1.0.0" },
        hostCapabilities: {},
      });
      expect(app.toolInfo).toBeNull();
    });

    it("containerDimensions is null when not provided", async () => {
      app = await connectAndHandshake(undefined, {
        protocolVersion: "2026-01-26",
        hostInfo: { name: "bare", version: "1.0.0" },
        hostCapabilities: {},
      });
      expect(app.containerDimensions).toBeNull();
    });
  });

  describe("on() event routing", () => {
    it("delivers parsed ToolResultData for tool-result events", async () => {
      app = await connectAndHandshake();
      const handler = vi.fn();
      app.on("tool-result", handler);

      dispatchNotification("ui/notifications/tool-result", {
        content: [{ type: "text", text: '{"speakers":[1,2]}' }],
      });

      expect(handler).toHaveBeenCalledTimes(1);
      const data = handler.mock.calls[0][0];
      expect(data.content).toEqual({ speakers: [1, 2] });
      expect(data.structuredContent).toBeNull();
      expect(data.raw).toEqual({
        content: [{ type: "text", text: '{"speakers":[1,2]}' }],
      });
    });

    it("delivers tool-result with structuredContent when present", async () => {
      app = await connectAndHandshake();
      const handler = vi.fn();
      app.on("tool-result", handler);

      dispatchNotification("ui/notifications/tool-result", {
        structuredContent: { items: [1, 2, 3] },
        content: [{ type: "text", text: "fallback" }],
      });

      const data = handler.mock.calls[0][0];
      expect(data.content).toEqual({ items: [1, 2, 3] });
      expect(data.structuredContent).toEqual({ items: [1, 2, 3] });
    });

    it("delivers raw args for tool-input events", async () => {
      app = await connectAndHandshake();
      const handler = vi.fn();
      app.on("tool-input", handler);

      dispatchNotification("ui/notifications/tool-input", {
        query: "search term",
      });

      expect(handler).toHaveBeenCalledWith({ query: "search term" });
    });

    it("fires theme-changed handler and updates app.theme", async () => {
      app = await connectAndHandshake();
      const handler = vi.fn();
      app.on("theme-changed", handler);

      dispatchNotification("ui/notifications/host-context-changed", {
        theme: "light",
        styles: { variables: { "--bg": "#fff" } },
      });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0]).toEqual({
        mode: "light",
        tokens: { "--bg": "#fff" },
      });
      expect(app.theme).toEqual({ mode: "light", tokens: { "--bg": "#fff" } });
    });

    it("passes through custom event names as-is", async () => {
      app = await connectAndHandshake();
      const handler = vi.fn();
      app.on("synapse/data-changed", handler);

      dispatchNotification("synapse/data-changed", { server: "s1", tool: "t1" });

      expect(handler).toHaveBeenCalledWith({ server: "s1", tool: "t1" });
    });

    it("fires teardown handler", async () => {
      app = await connectAndHandshake();
      const handler = vi.fn();
      app.on("teardown", handler);

      dispatchNotification("ui/resource-teardown", {});

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("multiple handlers for same event all fire", async () => {
      app = await connectAndHandshake();
      const h1 = vi.fn();
      const h2 = vi.fn();
      app.on("tool-input", h1);
      app.on("tool-input", h2);

      dispatchNotification("ui/notifications/tool-input", { q: "test" });

      expect(h1).toHaveBeenCalledTimes(1);
      expect(h2).toHaveBeenCalledTimes(1);
    });

    it("unsubscribe prevents further handler calls", async () => {
      app = await connectAndHandshake();
      const handler = vi.fn();
      const unsub = app.on("tool-input", handler);

      dispatchNotification("ui/notifications/tool-input", { a: 1 });
      expect(handler).toHaveBeenCalledTimes(1);

      unsub();

      dispatchNotification("ui/notifications/tool-input", { a: 2 });
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe("actions", () => {
    it("resize() sends size-changed message", async () => {
      app = await connectAndHandshake();
      postMessageSpy.mockClear();

      app.resize(300, 500);

      expect(postMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "ui/notifications/size-changed",
          params: { width: 300, height: 500 },
        }),
        "*",
      );
    });

    it("resize() with no args measures document.body", async () => {
      app = await connectAndHandshake();
      postMessageSpy.mockClear();

      app.resize();

      expect(postMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "ui/notifications/size-changed",
          params: { width: 800, height: 600 },
        }),
        "*",
      );
    });

    it("openLink() sends ui/open-link", async () => {
      app = await connectAndHandshake();
      postMessageSpy.mockClear();

      app.openLink("https://example.com");

      expect(postMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "ui/open-link",
          params: { url: "https://example.com" },
        }),
        "*",
      );
    });

    it("updateModelContext() sends ui/update-model-context with state and summary", async () => {
      app = await connectAndHandshake();
      postMessageSpy.mockClear();

      app.updateModelContext({ board: "bd_1" }, "Viewing board 1");

      expect(postMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "ui/update-model-context",
          params: {
            structuredContent: { board: "bd_1" },
            content: [{ type: "text", text: "Viewing board 1" }],
          },
        }),
        "*",
      );
    });

    it("updateModelContext() omits content when no summary", async () => {
      app = await connectAndHandshake();
      postMessageSpy.mockClear();

      app.updateModelContext({ x: 1 });

      expect(postMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "ui/update-model-context",
          params: { structuredContent: { x: 1 } },
        }),
        "*",
      );
    });

    it("callTool() sends tools/call and resolves with parsed result", async () => {
      app = await connectAndHandshake();
      postMessageSpy.mockClear();

      const resultPromise = app.callTool("echo", { text: "hi" });

      respondToLastRequest({
        content: [{ type: "text", text: '{"message":"hello"}' }],
      });

      const result = await resultPromise;
      expect(result.data).toEqual({ message: "hello" });
      expect(result.isError).toBe(false);
    });

    it("readServerResource() sends resources/read and returns the result unchanged", async () => {
      app = await connectAndHandshake();
      postMessageSpy.mockClear();

      const resultPromise = app.readServerResource({ uri: "foo://bar" });

      const readCall = postMessageSpy.mock.calls.find(
        (c: unknown[]) => (c[0] as Record<string, unknown>).method === "resources/read",
      );
      expect(readCall).toBeDefined();
      expect(readCall?.[0]).toMatchObject({
        jsonrpc: "2.0",
        method: "resources/read",
        params: { uri: "foo://bar" },
      });

      respondToLastRequest({
        contents: [{ uri: "foo://bar", mimeType: "text/plain", text: "hello" }],
      });

      const result = await resultPromise;
      expect(result.contents).toEqual([
        { uri: "foo://bar", mimeType: "text/plain", text: "hello" },
      ]);
    });

    it("sendMessage() sends ui/message with context", async () => {
      app = await connectAndHandshake();
      postMessageSpy.mockClear();

      app.sendMessage("Hello", { action: "summarize" });

      expect(postMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "ui/message",
          params: {
            role: "user",
            content: [{ type: "text", text: "Hello", _meta: { context: { action: "summarize" } } }],
          },
        }),
        "*",
      );
    });

    it("sendMessage() sends without _meta when no context", async () => {
      app = await connectAndHandshake();
      postMessageSpy.mockClear();

      app.sendMessage("Hello");

      expect(postMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "ui/message",
          params: {
            role: "user",
            content: [{ type: "text", text: "Hello" }],
          },
        }),
        "*",
      );
    });
  });

  describe("destroy()", () => {
    it("prevents further event delivery", async () => {
      app = await connectAndHandshake();
      const handler = vi.fn();
      app.on("tool-input", handler);

      app.destroy();

      dispatchNotification("ui/notifications/tool-input", { q: "test" });
      expect(handler).not.toHaveBeenCalled();
    });

    it("prevents further actions from sending", async () => {
      app = await connectAndHandshake();
      app.destroy();
      postMessageSpy.mockClear();

      app.openLink("https://example.com");
      app.sendMessage("hi");
      app.updateModelContext({ x: 1 });

      expect(postMessageSpy).not.toHaveBeenCalled();
    });

    it("double destroy does not throw", async () => {
      app = await connectAndHandshake();
      app.destroy();
      expect(() => app.destroy()).not.toThrow();
    });
  });
});

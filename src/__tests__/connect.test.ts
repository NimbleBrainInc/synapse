import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connect } from "../connect.js";
import type { App } from "../types.js";
import { FULL_HOST_CAPABILITIES } from "./helpers/host-capabilities.js";

// --- Helpers ---

let postMessageSpy: ReturnType<typeof vi.fn>;

/**
 * The host's side of the wire, as the spec's client requires it.
 *
 * Two things differ from a hand-rolled fake. Every frame carries
 * `source: window.parent`, because the client ignores a message from anywhere
 * else; and delivery is asynchronous — the client sends and dispatches on
 * microtasks — so the helpers below are all awaited.
 */
async function flush(): Promise<void> {
  // Microtasks only, never a timer: a test driving fake timers would otherwise
  // wait on one that never fires. Everything the client does between a frame
  // arriving and a handler running is a microtask.
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

function post(data: Record<string, unknown>): void {
  window.dispatchEvent(new MessageEvent("message", { data, source: window.parent }));
}

function makeInitResult(overrides?: Record<string, unknown>) {
  return {
    protocolVersion: "2026-01-26",
    hostInfo: { name: "test-host", version: "2.0.0" },
    hostCapabilities: FULL_HOST_CAPABILITIES,
    hostContext: {
      theme: "dark",
      // A key the spec's style-variable enum names: that enum is a strict
      // record, so one outside it rejects the whole handshake result.
      styles: { variables: { "--color-background-primary": "#111" } },
      toolInfo: { tool: { name: "search", description: "Search tool", inputSchema: TOOL_SCHEMA } },
      containerDimensions: { width: 400, height: 600 },
    },
    ...overrides,
  };
}

const TOOL_SCHEMA = { type: "object" as const };

/**
 * Complete the ext-apps handshake by responding to the ui/initialize request.
 * Returns the connected App.
 */
async function connectAndHandshake(
  options?: Partial<Parameters<typeof connect>[0]>,
  initResult?: Record<string, unknown>,
): Promise<App> {
  const promise = connect({
    name: "test-app",
    version: "1.0.0",
    ...options,
  });

  await flush();

  const initCall = postMessageSpy.mock.calls.find(
    (c: unknown[]) =>
      c[0] &&
      typeof c[0] === "object" &&
      (c[0] as Record<string, unknown>).method === "ui/initialize",
  );
  if (!initCall) throw new Error("No ui/initialize call found");

  const id = (initCall[0] as Record<string, unknown>).id;
  post({ jsonrpc: "2.0", id, result: initResult ?? makeInitResult() });

  const app = await promise;
  await flush();
  return app;
}

async function dispatchNotification(method: string, params?: Record<string, unknown>) {
  post({ jsonrpc: "2.0", method, ...(params !== undefined && { params }) });
  await flush();
}

async function respondToLastRequest(result: unknown) {
  const calls = postMessageSpy.mock.calls;
  for (let i = calls.length - 1; i >= 0; i--) {
    const msg = calls[i][0] as Record<string, unknown>;
    if (msg.id !== undefined && msg.method) {
      post({ jsonrpc: "2.0", id: msg.id, result });
      await flush();
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

    it("sends initial size AFTER the handshake, never before ui/initialize", async () => {
      app = await connectAndHandshake();

      // Find the order of messages
      const methods = postMessageSpy.mock.calls
        .map((c: unknown[]) => (c[0] as Record<string, unknown>).method)
        .filter(Boolean);

      const sizeIdx = methods.indexOf("ui/notifications/size-changed");
      const initIdx = methods.indexOf("ui/initialize");
      expect(initIdx).toBe(0);
      expect(sizeIdx).toBeGreaterThan(initIdx);
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
      expect(app.theme).toEqual({
        mode: "dark",
        tokens: { "--color-background-primary": "#111" },
      });
    });

    it("extracts hostInfo from host response", async () => {
      app = await connectAndHandshake();
      expect(app.hostInfo).toEqual({ name: "test-host", version: "2.0.0" });
    });

    it("extracts toolInfo from host response", async () => {
      app = await connectAndHandshake();
      expect(app.toolInfo).toEqual({
        tool: { name: "search", description: "Search tool", inputSchema: TOOL_SCHEMA },
      });
    });

    it("extracts containerDimensions from host response", async () => {
      app = await connectAndHandshake();
      expect(app.containerDimensions).toEqual({ width: 400, height: 600 });
    });

    const bareHost = {
      protocolVersion: "2026-01-26",
      hostInfo: { name: "bare", version: "1.0.0" },
      hostCapabilities: FULL_HOST_CAPABILITIES,
      hostContext: {},
    };

    it("defaults theme to light with empty tokens when not provided", async () => {
      app = await connectAndHandshake(undefined, bareHost);
      expect(app.theme).toEqual({ mode: "light", tokens: {} });
    });

    it("refuses a handshake result that is not the shape the spec defines", async () => {
      // `hostInfo`, `hostCapabilities` and `hostContext` are all required. A
      // host that answers with the pre-spec `capabilities`/`serverInfo` naming
      // is refused outright rather than half-adopted — the app renders an error
      // instead of connecting to a host it cannot actually talk to.
      await expect(
        connectAndHandshake(undefined, { protocolVersion: "2026-01-26", capabilities: {} }),
      ).rejects.toThrow();
    });

    it("toolInfo is null when not provided", async () => {
      app = await connectAndHandshake(undefined, bareHost);
      expect(app.toolInfo).toBeNull();
    });

    it("containerDimensions is null when not provided", async () => {
      app = await connectAndHandshake(undefined, bareHost);
      expect(app.containerDimensions).toBeNull();
    });
  });

  describe("on() event routing", () => {
    it("delivers parsed ToolResultData for tool-result events", async () => {
      app = await connectAndHandshake();
      const handler = vi.fn();
      app.on("tool-result", handler);

      await dispatchNotification("ui/notifications/tool-result", {
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

      await dispatchNotification("ui/notifications/tool-result", {
        structuredContent: { items: [1, 2, 3] },
        content: [{ type: "text", text: "fallback" }],
      });

      const data = handler.mock.calls[0][0];
      expect(data.content).toEqual({ items: [1, 2, 3] });
      expect(data.structuredContent).toEqual({ items: [1, 2, 3] });
    });

    it("delivers the params of a tool-input event", async () => {
      app = await connectAndHandshake();
      const handler = vi.fn();
      app.on("tool-input", handler);

      // The spec puts the call's arguments under `arguments`, which is what a
      // host sends and what subscribers receive.
      await dispatchNotification("ui/notifications/tool-input", {
        arguments: { query: "search term" },
      });

      expect(handler).toHaveBeenCalledWith({ arguments: { query: "search term" } });
    });

    it("fires theme-changed handler and updates app.theme", async () => {
      app = await connectAndHandshake();
      const handler = vi.fn();
      app.on("theme-changed", handler);

      await dispatchNotification("ui/notifications/host-context-changed", {
        theme: "light",
        styles: { variables: { "--color-background-primary": "#fff" } },
      });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0]).toEqual({
        mode: "light",
        tokens: { "--color-background-primary": "#fff" },
      });
      expect(app.theme).toEqual({
        mode: "light",
        tokens: { "--color-background-primary": "#fff" },
      });
    });

    it("passes through custom event names as-is", async () => {
      app = await connectAndHandshake();
      const handler = vi.fn();
      app.on("acme/custom-event", handler);

      await dispatchNotification("acme/custom-event", { server: "s1", tool: "t1" });

      expect(handler).toHaveBeenCalledWith({ server: "s1", tool: "t1" });
    });

    it("fires teardown handler", async () => {
      app = await connectAndHandshake();
      const handler = vi.fn();
      app.on("teardown", handler);

      await dispatchNotification("ui/resource-teardown", {});

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("answers a teardown request and hands subscribers its params", async () => {
      app = await connectAndHandshake();
      const handler = vi.fn();
      app.on("teardown", handler);

      // The spec defines teardown as a request: the host asks, and waits for the answer.
      post({ jsonrpc: "2.0", id: 99, method: "ui/resource-teardown", params: {} });
      await flush();

      expect(handler).toHaveBeenCalledWith({});
      const reply = postMessageSpy.mock.calls
        .map((c: unknown[]) => c[0] as Record<string, unknown>)
        .find((m) => m.id === 99 && "result" in m);
      expect(reply?.result).toEqual({});
    });

    it("multiple handlers for same event all fire", async () => {
      app = await connectAndHandshake();
      const h1 = vi.fn();
      const h2 = vi.fn();
      app.on("tool-input", h1);
      app.on("tool-input", h2);

      await dispatchNotification("ui/notifications/tool-input", { q: "test" });

      expect(h1).toHaveBeenCalledTimes(1);
      expect(h2).toHaveBeenCalledTimes(1);
    });

    it("unsubscribe prevents further handler calls", async () => {
      app = await connectAndHandshake();
      const handler = vi.fn();
      const unsub = app.on("tool-input", handler);

      await dispatchNotification("ui/notifications/tool-input", { a: 1 });
      expect(handler).toHaveBeenCalledTimes(1);

      unsub();

      await dispatchNotification("ui/notifications/tool-input", { a: 2 });
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

      await respondToLastRequest({
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

      await respondToLastRequest({
        contents: [{ uri: "foo://bar", mimeType: "text/plain", text: "hello" }],
      });

      const result = await resultPromise;
      expect(result.contents).toEqual([
        { uri: "foo://bar", mimeType: "text/plain", text: "hello" },
      ]);
    });

    // The chat context is a NimbleBrain host field, so it rides only on a
    // NimbleBrain host — and this harness's host is `test-host`. Both branches
    // are covered in connect-capabilities.test.ts.
    it("sendMessage() omits context off a NimbleBrain host", async () => {
      app = await connectAndHandshake();
      postMessageSpy.mockClear();

      app.sendMessage("Hello", { action: "summarize" });

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

      await dispatchNotification("ui/notifications/tool-input", { q: "test" });
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

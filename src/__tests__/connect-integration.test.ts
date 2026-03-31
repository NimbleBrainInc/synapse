import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connect } from "../connect.js";
import { createSynapse } from "../core.js";
import type { App } from "../types.js";

// ---------------------------------------------------------------------------
// MockHost — reusable postMessage simulator for the MCP Apps host side
// ---------------------------------------------------------------------------

class MockHost {
  private postMessageSpy: ReturnType<typeof vi.fn>;

  constructor() {
    this.postMessageSpy = vi.fn();
    window.parent.postMessage = this.postMessageSpy;

    // Mock body dimensions for resize tests
    Object.defineProperty(document.body, "scrollWidth", { value: 800, configurable: true });
    Object.defineProperty(document.body, "scrollHeight", { value: 600, configurable: true });
  }

  /** Auto-respond to ui/initialize when it arrives. */
  respondToInitialize(initResult?: Record<string, unknown>) {
    const initCall = this.postMessageSpy.mock.calls.find(
      (c: unknown[]) =>
        c[0] &&
        typeof c[0] === "object" &&
        (c[0] as Record<string, unknown>).method === "ui/initialize",
    );
    if (!initCall) throw new Error("No ui/initialize call found");

    const id = (initCall[0] as Record<string, unknown>).id as string;
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { jsonrpc: "2.0", id, result: initResult ?? this.defaultInitResult() },
      }),
    );
  }

  /** Send a notification from host to app. */
  sendNotification(method: string, params?: Record<string, unknown>) {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { jsonrpc: "2.0", method, ...(params !== undefined && { params }) },
      }),
    );
  }

  /** Respond to the most recent pending request. */
  respondToLastRequest(result: unknown) {
    const calls = this.postMessageSpy.mock.calls;
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

  /** All messages sent by the app (via postMessage). */
  get sentMessages(): Record<string, unknown>[] {
    return this.postMessageSpy.mock.calls.map((c: unknown[]) => c[0] as Record<string, unknown>);
  }

  /** Ordered list of method names sent by the app. */
  get sentMethods(): string[] {
    return this.sentMessages.map((m) => m.method as string).filter(Boolean);
  }

  /** Clear the spy (useful between phases of a test). */
  clearSpy() {
    this.postMessageSpy.mockClear();
  }

  private defaultInitResult() {
    return {
      protocolVersion: "2026-01-26",
      serverInfo: { name: "test-host", version: "2.0.0" },
      capabilities: {},
      hostContext: {
        theme: { mode: "dark", tokens: { "--bg": "#111" } },
        toolInfo: { tool: { name: "search", description: "Search tool" } },
        containerDimensions: { width: 400, height: 600 },
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("connect() integration", () => {
  let host: MockHost;
  let app: App;

  beforeEach(() => {
    host = new MockHost();
  });

  afterEach(() => {
    app?.destroy();
  });

  // --- Helper ---
  async function connectApp(opts?: Partial<Parameters<typeof connect>[0]>): Promise<App> {
    const promise = connect({ name: "test-app", version: "1.0.0", ...opts });
    host.respondToInitialize();
    return promise;
  }

  // -----------------------------------------------------------------------
  // 1. Full lifecycle
  // -----------------------------------------------------------------------
  describe("full lifecycle", () => {
    it("connect -> receive tool-result -> receive theme-changed -> destroy -> no further events", async () => {
      app = await connectApp();

      const toolResultHandler = vi.fn();
      const themeHandler = vi.fn();
      app.on("tool-result", toolResultHandler);
      app.on("theme-changed", themeHandler);

      // Host sends tool-result
      host.sendNotification("ui/notifications/tool-result", {
        content: [{ type: "text", text: '{"count":42}' }],
      });
      expect(toolResultHandler).toHaveBeenCalledTimes(1);
      expect(toolResultHandler.mock.calls[0][0].content).toEqual({ count: 42 });

      // Host sends theme-changed
      host.sendNotification("ui/notifications/host-context-changed", {
        theme: "light",
        tokens: { "--bg": "#fff" },
      });
      expect(themeHandler).toHaveBeenCalledTimes(1);
      expect(app.theme).toEqual({ mode: "light", tokens: { "--bg": "#fff" } });

      // Destroy
      app.destroy();

      // No further events
      host.sendNotification("ui/notifications/tool-result", {
        content: [{ type: "text", text: '{"count":99}' }],
      });
      host.sendNotification("ui/notifications/host-context-changed", {
        theme: "dark",
        tokens: {},
      });
      expect(toolResultHandler).toHaveBeenCalledTimes(1);
      expect(themeHandler).toHaveBeenCalledTimes(1);
    });
  });

  // -----------------------------------------------------------------------
  // 2. Handshake ordering verification
  // -----------------------------------------------------------------------
  describe("handshake ordering", () => {
    it("sends size-changed BEFORE ui/initialize, and initialized AFTER host response", async () => {
      app = await connectApp();

      const methods = host.sentMethods;

      const sizeIdx = methods.indexOf("ui/notifications/size-changed");
      const initIdx = methods.indexOf("ui/initialize");
      const initializedIdx = methods.indexOf("ui/notifications/initialized");

      // size-changed first
      expect(sizeIdx).toBeGreaterThanOrEqual(0);
      expect(initIdx).toBeGreaterThan(sizeIdx);

      // initialized last (after host responded to ui/initialize)
      expect(initializedIdx).toBeGreaterThan(initIdx);
    });

    it("initial size message contains body dimensions", async () => {
      app = await connectApp();

      const sizeMsg = host.sentMessages.find((m) => m.method === "ui/notifications/size-changed");
      expect(sizeMsg).toMatchObject({
        params: { width: 800, height: 600 },
      });
    });
  });

  // -----------------------------------------------------------------------
  // 3. callTool through connect()
  // -----------------------------------------------------------------------
  describe("callTool end-to-end", () => {
    it("sends tools/call, host responds, app receives parsed result", async () => {
      app = await connectApp();
      host.clearSpy();

      const resultPromise = app.callTool("echo", { text: "hello" });

      // Verify message format
      const toolCallMsg = host.sentMessages.find((m) => m.method === "tools/call");
      expect(toolCallMsg).toMatchObject({
        jsonrpc: "2.0",
        method: "tools/call",
        params: { name: "echo", arguments: { text: "hello" } },
      });

      // Host responds with MCP content array
      host.respondToLastRequest({
        content: [{ type: "text", text: '{"message":"hi back"}' }],
      });

      const result = await resultPromise;
      expect(result.data).toEqual({ message: "hi back" });
      expect(result.isError).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // 4. sendMessage format
  // -----------------------------------------------------------------------
  describe("sendMessage format", () => {
    it("sends ui/message with context as _meta", async () => {
      app = await connectApp();
      host.clearSpy();

      app.sendMessage("Summarize the board", { action: "summarize", entity: "board" });

      expect(host.sentMessages[0]).toMatchObject({
        method: "ui/message",
        params: {
          role: "user",
          content: [
            {
              type: "text",
              text: "Summarize the board",
              _meta: { context: { action: "summarize", entity: "board" } },
            },
          ],
        },
      });
    });

    it("sends ui/message without _meta when no context", async () => {
      app = await connectApp();
      host.clearSpy();

      app.sendMessage("Just chatting");

      const msg = host.sentMessages[0];
      expect(msg).toMatchObject({
        method: "ui/message",
        params: {
          role: "user",
          content: [{ type: "text", text: "Just chatting" }],
        },
      });
      // Verify no _meta key
      const content = (msg.params as Record<string, unknown>).content as Record<string, unknown>[];
      expect(content[0]).not.toHaveProperty("_meta");
    });
  });

  // -----------------------------------------------------------------------
  // 5. updateModelContext format
  // -----------------------------------------------------------------------
  describe("updateModelContext format", () => {
    it("sends structuredContent + summary as text content block", async () => {
      app = await connectApp();
      host.clearSpy();

      app.updateModelContext({ board: "bd_1", items: 5 }, "Viewing board with 5 items");

      expect(host.sentMessages[0]).toMatchObject({
        method: "ui/update-model-context",
        params: {
          structuredContent: { board: "bd_1", items: 5 },
          content: [{ type: "text", text: "Viewing board with 5 items" }],
        },
      });
    });

    it("sends only structuredContent when no summary", async () => {
      app = await connectApp();
      host.clearSpy();

      app.updateModelContext({ x: 1 });

      const params = host.sentMessages[0].params as Record<string, unknown>;
      expect(params.structuredContent).toEqual({ x: 1 });
      expect(params).not.toHaveProperty("content");
    });
  });

  // -----------------------------------------------------------------------
  // 6. Multiple on() handlers
  // -----------------------------------------------------------------------
  describe("multiple handlers", () => {
    it("same event fires all registered handlers", async () => {
      app = await connectApp();
      const h1 = vi.fn();
      const h2 = vi.fn();
      const h3 = vi.fn();
      app.on("tool-input", h1);
      app.on("tool-input", h2);
      app.on("tool-input", h3);

      host.sendNotification("ui/notifications/tool-input", { query: "hello" });

      expect(h1).toHaveBeenCalledTimes(1);
      expect(h2).toHaveBeenCalledTimes(1);
      expect(h3).toHaveBeenCalledTimes(1);
      // All receive the same payload
      expect(h1).toHaveBeenCalledWith({ query: "hello" });
      expect(h2).toHaveBeenCalledWith({ query: "hello" });
    });
  });

  // -----------------------------------------------------------------------
  // 7. Unsubscribe
  // -----------------------------------------------------------------------
  describe("unsubscribe", () => {
    it("prevents unsubscribed handler from firing while others continue", async () => {
      app = await connectApp();
      const stays = vi.fn();
      const leaves = vi.fn();
      app.on("tool-input", stays);
      const unsub = app.on("tool-input", leaves);

      host.sendNotification("ui/notifications/tool-input", { a: 1 });
      expect(stays).toHaveBeenCalledTimes(1);
      expect(leaves).toHaveBeenCalledTimes(1);

      unsub();

      host.sendNotification("ui/notifications/tool-input", { a: 2 });
      expect(stays).toHaveBeenCalledTimes(2);
      expect(leaves).toHaveBeenCalledTimes(1); // did not fire again
    });
  });

  // -----------------------------------------------------------------------
  // 8. Content parsing end-to-end
  // -----------------------------------------------------------------------
  describe("content parsing end-to-end", () => {
    it("text array content is JSON-parsed", async () => {
      app = await connectApp();
      const handler = vi.fn();
      app.on("tool-result", handler);

      host.sendNotification("ui/notifications/tool-result", {
        content: [
          { type: "text", text: '{"items":' },
          { type: "text", text: "[1,2,3]}" },
        ],
      });

      const data = handler.mock.calls[0][0];
      expect(data.content).toEqual({ items: [1, 2, 3] });
      expect(data.structuredContent).toBeNull();
    });

    it("structuredContent is used as content when present (takes priority)", async () => {
      app = await connectApp();
      const handler = vi.fn();
      app.on("tool-result", handler);

      host.sendNotification("ui/notifications/tool-result", {
        structuredContent: { direct: true, count: 7 },
        content: [{ type: "text", text: "fallback text" }],
      });

      const data = handler.mock.calls[0][0];
      expect(data.content).toEqual({ direct: true, count: 7 });
      expect(data.structuredContent).toEqual({ direct: true, count: 7 });
    });

    it("non-JSON text content is delivered as raw string", async () => {
      app = await connectApp();
      const handler = vi.fn();
      app.on("tool-result", handler);

      host.sendNotification("ui/notifications/tool-result", {
        content: [{ type: "text", text: "not valid json {" }],
      });

      const data = handler.mock.calls[0][0];
      expect(data.content).toBe("not valid json {");
      expect(data.structuredContent).toBeNull();
    });

    it("raw params are always preserved", async () => {
      app = await connectApp();
      const handler = vi.fn();
      app.on("tool-result", handler);

      const rawParams = {
        structuredContent: { a: 1 },
        content: [{ type: "text", text: "fallback" }],
      };
      host.sendNotification("ui/notifications/tool-result", rawParams);

      const data = handler.mock.calls[0][0];
      expect(data.raw).toEqual(rawParams);
    });
  });

  // -----------------------------------------------------------------------
  // 9. Resize end-to-end
  // -----------------------------------------------------------------------
  describe("resize end-to-end", () => {
    it("resize() with no args sends body dimensions", async () => {
      app = await connectApp();
      host.clearSpy();

      app.resize();

      expect(host.sentMessages[0]).toMatchObject({
        method: "ui/notifications/size-changed",
        params: { width: 800, height: 600 },
      });
    });

    it("resize(w, h) sends exact dimensions", async () => {
      app = await connectApp();
      host.clearSpy();

      app.resize(320, 480);

      expect(host.sentMessages[0]).toMatchObject({
        method: "ui/notifications/size-changed",
        params: { width: 320, height: 480 },
      });
    });
  });

  // -----------------------------------------------------------------------
  // 10. Backwards compatibility: createSynapse still works
  // -----------------------------------------------------------------------
  describe("backwards compat: createSynapse", () => {
    it("createSynapse handshake + callTool still works", async () => {
      const synapse = createSynapse({ name: "legacy-app", version: "1.0.0" });

      // Complete the legacy handshake
      const initCall = (window.parent.postMessage as ReturnType<typeof vi.fn>).mock.calls.find(
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
              serverInfo: { name: "nimblebrain", version: "1.0.0" },
              capabilities: {},
              hostContext: { theme: { mode: "dark", primaryColor: "#fff", tokens: {} } },
            },
          },
        }),
      );

      await synapse.ready;
      expect(synapse.isNimbleBrainHost).toBe(true);

      // callTool through legacy API
      host.clearSpy();
      const resultPromise = synapse.callTool("echo", { text: "legacy" });

      // Find the tools/call request and respond
      const toolCall = (window.parent.postMessage as ReturnType<typeof vi.fn>).mock.calls.find(
        (c: unknown[]) =>
          c[0] &&
          typeof c[0] === "object" &&
          (c[0] as Record<string, unknown>).method === "tools/call",
      );
      const toolId = (toolCall?.[0] as Record<string, unknown>).id as string;
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            jsonrpc: "2.0",
            id: toolId,
            result: { content: [{ type: "text", text: '{"ok":true}' }] },
          },
        }),
      );

      const result = await resultPromise;
      expect(result.data).toEqual({ ok: true });

      synapse.destroy();
    });
  });

  // -----------------------------------------------------------------------
  // 11. Race condition: events before handlers are registered
  // -----------------------------------------------------------------------
  describe("race conditions", () => {
    it("events sent before on() is called are not lost if handler is registered synchronously after connect", async () => {
      // This tests that registering a handler right after connect() resolves
      // works correctly — there's no gap where events could be missed
      // because the transport listener is set up eagerly.
      app = await connectApp();

      // Register handler synchronously
      const handler = vi.fn();
      app.on("tool-input", handler);

      // Now an event arrives — should be delivered
      host.sendNotification("ui/notifications/tool-input", { q: "test" });
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("destroy during pending callTool rejects the pending promise", async () => {
      app = await connectApp();

      // Start a call but never respond
      const resultPromise = app.callTool("slow-tool");

      // Destroy while pending
      app.destroy();

      // The pending callTool should reject with transport destroyed
      await expect(resultPromise).rejects.toThrow("Transport destroyed");
    });
  });
});

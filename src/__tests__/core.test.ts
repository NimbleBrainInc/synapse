import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSynapse } from "../core.js";
import type { Synapse } from "../types.js";

// --- Helpers ---

let postMessageSpy: ReturnType<typeof vi.fn>;

function makeInitResult(serverName = "nimblebrain") {
  return {
    protocolVersion: "2026-01-26",
    serverInfo: { name: serverName, version: "1.0.0" },
    capabilities: {},
    hostContext: {
      theme: { mode: "dark", primaryColor: "#fff", tokens: {} },
    },
  };
}

/** Find the ui/initialize request sent via postMessage and respond to it. */
function completeHandshake(serverName = "nimblebrain") {
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
      data: { jsonrpc: "2.0", id, result: makeInitResult(serverName) },
    }),
  );
}

function dispatchNotification(method: string, params?: Record<string, unknown>) {
  window.dispatchEvent(
    new MessageEvent("message", {
      data: {
        jsonrpc: "2.0",
        method,
        ...(params !== undefined && { params }),
      },
    }),
  );
}

function respondToLastRequest(result: unknown) {
  const calls = postMessageSpy.mock.calls;
  // Walk backwards to find the most recent request (has an id)
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

function rejectLastRequest(code: number, message: string) {
  const calls = postMessageSpy.mock.calls;
  for (let i = calls.length - 1; i >= 0; i--) {
    const msg = calls[i][0] as Record<string, unknown>;
    if (msg.id && msg.method) {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            jsonrpc: "2.0",
            id: msg.id,
            error: { code, message },
          },
        }),
      );
      return;
    }
  }
  throw new Error("No pending request found");
}

// --- Tests ---

describe("createSynapse", () => {
  let synapse: Synapse;

  beforeEach(() => {
    vi.useFakeTimers();
    postMessageSpy = vi.fn();
    window.parent.postMessage = postMessageSpy;
  });

  afterEach(() => {
    synapse?.destroy();
    vi.useRealTimers();
  });

  it("creates an instance", () => {
    synapse = createSynapse({ name: "test-app", version: "1.0.0" });
    // Catch the pending handshake promise so destroy() in afterEach
    // doesn't cause an unhandled rejection.
    synapse.ready.catch(() => {});

    expect(synapse).toBeDefined();
    expect(synapse.ready).toBeInstanceOf(Promise);
    expect(typeof synapse.callTool).toBe("function");
    expect(typeof synapse.destroy).toBe("function");
  });

  it("ready resolves after mock ext-apps handshake", async () => {
    synapse = createSynapse({ name: "test-app", version: "1.0.0" });
    completeHandshake();
    await expect(synapse.ready).resolves.toBeUndefined();
  });

  it("isNimbleBrainHost is true when serverInfo.name = 'nimblebrain'", async () => {
    synapse = createSynapse({ name: "test-app", version: "1.0.0" });
    completeHandshake("nimblebrain");
    await synapse.ready;
    expect(synapse.isNimbleBrainHost).toBe(true);
  });

  it("isNimbleBrainHost is false for other hosts", async () => {
    synapse = createSynapse({ name: "test-app", version: "1.0.0" });
    completeHandshake("other-host");
    await synapse.ready;
    expect(synapse.isNimbleBrainHost).toBe(false);
  });

  it("callTool() sends correct JSON-RPC tools/call message and resolves with parsed result", async () => {
    synapse = createSynapse({ name: "test-app", version: "1.0.0" });
    completeHandshake();
    await synapse.ready;

    postMessageSpy.mockClear();

    const resultPromise = synapse.callTool("echo", { text: "hello" });

    // Verify the tools/call message was sent
    const toolCall = postMessageSpy.mock.calls.find(
      (c: unknown[]) => (c[0] as Record<string, unknown>).method === "tools/call",
    );
    expect(toolCall).toBeDefined();
    expect(toolCall?.[0]).toMatchObject({
      jsonrpc: "2.0",
      method: "tools/call",
      params: { name: "echo", arguments: { text: "hello" } },
    });

    // Respond with MCP-style content
    respondToLastRequest({
      content: [{ type: "text", text: '{"message":"hi"}' }],
    });

    const result = await resultPromise;
    expect(result.data).toEqual({ message: "hi" });
    expect(result.isError).toBe(false);
  });

  it("callTool() rejects on error response", async () => {
    synapse = createSynapse({ name: "test-app", version: "1.0.0" });
    completeHandshake();
    await synapse.ready;

    postMessageSpy.mockClear();

    const resultPromise = synapse.callTool("bad-tool");
    rejectLastRequest(-32000, "Tool not found");

    await expect(resultPromise).rejects.toThrow("Tool not found");
  });

  it("onDataChanged() fires callback when ui/datachanged message arrives", async () => {
    synapse = createSynapse({ name: "test-app", version: "1.0.0" });
    completeHandshake();
    await synapse.ready;

    const callback = vi.fn();
    synapse.onDataChanged(callback);

    dispatchNotification("ui/datachanged", {
      server: "my-server",
      tool: "my-tool",
    });

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith({
      source: "agent",
      server: "my-server",
      tool: "my-tool",
    });
  });

  it("onDataChanged() unsubscribe stops callback", async () => {
    synapse = createSynapse({ name: "test-app", version: "1.0.0" });
    completeHandshake();
    await synapse.ready;

    const callback = vi.fn();
    const unsub = synapse.onDataChanged(callback);

    dispatchNotification("ui/datachanged", {
      server: "s",
      tool: "t",
    });
    expect(callback).toHaveBeenCalledTimes(1);

    unsub();

    dispatchNotification("ui/datachanged", {
      server: "s2",
      tool: "t2",
    });
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("action() sends ui/action when NB host", async () => {
    synapse = createSynapse({ name: "test-app", version: "1.0.0" });
    completeHandshake("nimblebrain");
    await synapse.ready;

    postMessageSpy.mockClear();

    synapse.action("refresh", { scope: "all" });

    expect(postMessageSpy).toHaveBeenCalledWith(
      {
        jsonrpc: "2.0",
        method: "ui/action",
        params: { action: "refresh", scope: "all" },
      },
      "*",
    );
  });

  it("action() is no-op when not NB host", async () => {
    synapse = createSynapse({ name: "test-app", version: "1.0.0" });
    completeHandshake("other-host");
    await synapse.ready;

    postMessageSpy.mockClear();

    synapse.action("refresh");

    expect(postMessageSpy).not.toHaveBeenCalled();
  });

  it("chat() sends ui/chat when NB host", async () => {
    synapse = createSynapse({ name: "test-app", version: "1.0.0" });
    completeHandshake("nimblebrain");
    await synapse.ready;

    postMessageSpy.mockClear();

    synapse.chat("Hello agent", { action: "summarize" });

    expect(postMessageSpy).toHaveBeenCalledWith(
      {
        jsonrpc: "2.0",
        method: "ui/chat",
        params: {
          message: "Hello agent",
          context: { action: "summarize" },
        },
      },
      "*",
    );
  });

  it("setVisibleState() debounces (3 calls fast -> 1 message after 250ms)", async () => {
    synapse = createSynapse({ name: "test-app", version: "1.0.0" });
    completeHandshake("nimblebrain");
    await synapse.ready;

    postMessageSpy.mockClear();

    synapse.setVisibleState({ count: 1 }, "first");
    synapse.setVisibleState({ count: 2 }, "second");
    synapse.setVisibleState({ count: 3 }, "third");

    // Nothing sent yet
    expect(postMessageSpy).not.toHaveBeenCalled();

    // Advance past the 250ms debounce
    vi.advanceTimersByTime(250);

    // Only the last call should have been sent
    expect(postMessageSpy).toHaveBeenCalledTimes(1);
    expect(postMessageSpy).toHaveBeenCalledWith(
      {
        jsonrpc: "2.0",
        method: "ui/stateChanged",
        params: { state: { count: 3 }, summary: "third" },
      },
      "*",
    );
  });

  it("openLink() sends ui/openLink when NB host", async () => {
    synapse = createSynapse({ name: "test-app", version: "1.0.0" });
    completeHandshake("nimblebrain");
    await synapse.ready;

    postMessageSpy.mockClear();

    synapse.openLink("https://example.com");

    expect(postMessageSpy).toHaveBeenCalledWith(
      {
        jsonrpc: "2.0",
        method: "ui/openLink",
        params: { url: "https://example.com" },
      },
      "*",
    );
  });

  it("destroyed is false before destroy and true after", async () => {
    synapse = createSynapse({ name: "test-app", version: "1.0.0" });
    completeHandshake();
    await synapse.ready;

    expect(synapse.destroyed).toBe(false);
    synapse.destroy();
    expect(synapse.destroyed).toBe(true);
  });

  it("destroy() cleans up everything", async () => {
    synapse = createSynapse({ name: "test-app", version: "1.0.0" });
    completeHandshake("nimblebrain");
    await synapse.ready;

    const dataCallback = vi.fn();
    synapse.onDataChanged(dataCallback);

    synapse.destroy();

    postMessageSpy.mockClear();

    // After destroy, NB methods should not send messages
    synapse.action("test");
    expect(postMessageSpy).not.toHaveBeenCalled();

    // Data callbacks should no longer fire
    dispatchNotification("ui/datachanged", {
      server: "s",
      tool: "t",
    });
    expect(dataCallback).not.toHaveBeenCalled();

    // setVisibleState debounce timer should be cleared (no message after advance)
    synapse.setVisibleState({ x: 1 });
    vi.advanceTimersByTime(500);
    expect(postMessageSpy).not.toHaveBeenCalled();

    // Double destroy should not throw
    expect(() => synapse.destroy()).not.toThrow();
  });
});

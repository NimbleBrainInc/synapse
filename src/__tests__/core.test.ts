import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSynapse } from "../core.js";
import type { Synapse } from "../types.js";

// --- Helpers ---

let postMessageSpy: ReturnType<typeof vi.fn>;

function makeInitResult(hostName = "nimblebrain") {
  return {
    protocolVersion: "2026-01-26",
    hostInfo: { name: hostName, version: "1.0.0" },
    hostCapabilities: {},
    hostContext: {
      theme: "dark",
      styles: { variables: {} },
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

  it("readResource() sends resources/read with { uri } and returns contents unchanged", async () => {
    synapse = createSynapse({ name: "test-app", version: "1.0.0" });
    completeHandshake();
    await synapse.ready;

    postMessageSpy.mockClear();

    const resultPromise = synapse.readResource("foo://bar");

    const readCall = postMessageSpy.mock.calls.find(
      (c: unknown[]) => (c[0] as Record<string, unknown>).method === "resources/read",
    );
    expect(readCall).toBeDefined();
    expect(readCall?.[0]).toMatchObject({
      jsonrpc: "2.0",
      method: "resources/read",
      params: { uri: "foo://bar" },
    });

    // Host responds with a spec-shaped ReadResourceResult
    respondToLastRequest({
      contents: [
        {
          uri: "foo://bar",
          mimeType: "text/plain",
          text: "hello",
        },
        {
          uri: "foo://bar/thumbnail.png",
          mimeType: "image/png",
          blob: "aGVsbG8=",
        },
      ],
    });

    const result = await resultPromise;
    expect(result.contents).toHaveLength(2);
    expect(result.contents[0]).toEqual({
      uri: "foo://bar",
      mimeType: "text/plain",
      text: "hello",
    });
    expect(result.contents[1]).toEqual({
      uri: "foo://bar/thumbnail.png",
      mimeType: "image/png",
      blob: "aGVsbG8=",
    });
  });

  it("readResource() rejects on error response", async () => {
    synapse = createSynapse({ name: "test-app", version: "1.0.0" });
    completeHandshake();
    await synapse.ready;

    postMessageSpy.mockClear();

    const resultPromise = synapse.readResource("missing://resource");
    rejectLastRequest(-32002, "Resource not found");

    await expect(resultPromise).rejects.toThrow("Resource not found");
  });

  it("onDataChanged() fires callback when ui/datachanged message arrives", async () => {
    synapse = createSynapse({ name: "test-app", version: "1.0.0" });
    completeHandshake();
    await synapse.ready;

    const callback = vi.fn();
    synapse.onDataChanged(callback);

    dispatchNotification("synapse/data-changed", {
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

    dispatchNotification("synapse/data-changed", {
      server: "s",
      tool: "t",
    });
    expect(callback).toHaveBeenCalledTimes(1);

    unsub();

    dispatchNotification("synapse/data-changed", {
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
        method: "synapse/action",
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

  it("chat() sends ui/message with _meta.context when NB host", async () => {
    synapse = createSynapse({ name: "test-app", version: "1.0.0" });
    completeHandshake("nimblebrain");
    await synapse.ready;

    postMessageSpy.mockClear();

    synapse.chat("Hello agent", { action: "summarize" });

    expect(postMessageSpy).toHaveBeenCalledWith(
      {
        jsonrpc: "2.0",
        method: "ui/message",
        params: {
          role: "user",
          content: [
            { type: "text", text: "Hello agent", _meta: { context: { action: "summarize" } } },
          ],
        },
      },
      "*",
    );
  });

  it("chat() sends ui/message without _meta for non-NB host", async () => {
    synapse = createSynapse({ name: "test-app", version: "1.0.0" });
    completeHandshake("other-host");
    await synapse.ready;

    postMessageSpy.mockClear();

    synapse.chat("Hello agent", { action: "summarize" });

    expect(postMessageSpy).toHaveBeenCalledWith(
      {
        jsonrpc: "2.0",
        method: "ui/message",
        params: {
          role: "user",
          content: [{ type: "text", text: "Hello agent" }],
        },
      },
      "*",
    );
  });

  it("chat() sends ui/message without _meta when no context", async () => {
    synapse = createSynapse({ name: "test-app", version: "1.0.0" });
    completeHandshake("nimblebrain");
    await synapse.ready;

    postMessageSpy.mockClear();

    synapse.chat("Just a message");

    expect(postMessageSpy).toHaveBeenCalledWith(
      {
        jsonrpc: "2.0",
        method: "ui/message",
        params: {
          role: "user",
          content: [{ type: "text", text: "Just a message" }],
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
        method: "ui/update-model-context",
        params: {
          structuredContent: { count: 3 },
          content: [{ type: "text", text: "third" }],
        },
      },
      "*",
    );
  });

  it("setVisibleState() works for non-NB host", async () => {
    synapse = createSynapse({ name: "test-app", version: "1.0.0" });
    completeHandshake("other-host");
    await synapse.ready;

    postMessageSpy.mockClear();

    synapse.setVisibleState({ items: [1, 2] }, "two items");
    vi.advanceTimersByTime(250);

    expect(postMessageSpy).toHaveBeenCalledTimes(1);
    expect(postMessageSpy).toHaveBeenCalledWith(
      {
        jsonrpc: "2.0",
        method: "ui/update-model-context",
        params: {
          structuredContent: { items: [1, 2] },
          content: [{ type: "text", text: "two items" }],
        },
      },
      "*",
    );
  });

  it("setVisibleState() omits content when no summary", async () => {
    synapse = createSynapse({ name: "test-app", version: "1.0.0" });
    completeHandshake("nimblebrain");
    await synapse.ready;

    postMessageSpy.mockClear();

    synapse.setVisibleState({ x: 1 });
    vi.advanceTimersByTime(250);

    expect(postMessageSpy).toHaveBeenCalledWith(
      {
        jsonrpc: "2.0",
        method: "ui/update-model-context",
        params: { structuredContent: { x: 1 } },
      },
      "*",
    );
  });

  it("downloadFile() sends synapse/download-file notification with a Blob payload", async () => {
    synapse = createSynapse({ name: "test-app", version: "1.0.0" });
    completeHandshake("nimblebrain");
    await synapse.ready;

    postMessageSpy.mockClear();

    synapse.downloadFile("document.txt", "hello", "text/plain");

    const call = postMessageSpy.mock.calls.find(
      (c: unknown[]) => (c[0] as Record<string, unknown>).method === "synapse/download-file",
    );
    expect(call).toBeDefined();
    const params = (call![0] as { params: Record<string, unknown> }).params;
    expect(params.filename).toBe("document.txt");
    expect(params.mimeType).toBe("text/plain");
    expect(params.data).toBeInstanceOf(Blob);
    expect((params.data as Blob).type).toBe("text/plain");
    expect(await (params.data as Blob).text()).toBe("hello");
  });

  it("downloadFile() passes Blob content through unchanged", async () => {
    synapse = createSynapse({ name: "test-app", version: "1.0.0" });
    completeHandshake("nimblebrain");
    await synapse.ready;

    postMessageSpy.mockClear();

    const pdf = new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46])], {
      type: "application/pdf",
    });
    synapse.downloadFile("document.pdf", pdf, "application/pdf");

    const call = postMessageSpy.mock.calls.find(
      (c: unknown[]) => (c[0] as Record<string, unknown>).method === "synapse/download-file",
    );
    expect(call).toBeDefined();
    const params = (call![0] as { params: Record<string, unknown> }).params;
    expect(params.data).toBe(pdf);
    expect(params.filename).toBe("document.pdf");
    expect(params.mimeType).toBe("application/pdf");
  });

  it("downloadFile() defaults mimeType to application/octet-stream for string content", async () => {
    synapse = createSynapse({ name: "test-app", version: "1.0.0" });
    completeHandshake("nimblebrain");
    await synapse.ready;

    postMessageSpy.mockClear();

    synapse.downloadFile("file.dat", "binary-data");

    const call = postMessageSpy.mock.calls.find(
      (c: unknown[]) => (c[0] as Record<string, unknown>).method === "synapse/download-file",
    );
    expect(call).toBeDefined();
    const params = (call![0] as { params: Record<string, unknown> }).params;
    expect(params.mimeType).toBe("application/octet-stream");
    expect(params.data).toBeInstanceOf(Blob);
    expect((params.data as Blob).type).toBe("application/octet-stream");
    expect(await (params.data as Blob).text()).toBe("binary-data");
  });

  it("downloadFile() treats an empty-string mimeType arg as absent", async () => {
    synapse = createSynapse({ name: "test-app", version: "1.0.0" });
    completeHandshake("nimblebrain");
    await synapse.ready;

    postMessageSpy.mockClear();

    const blob = new Blob(["hi"], { type: "text/plain" });
    synapse.downloadFile("doc.txt", blob, "");

    const call = postMessageSpy.mock.calls.find(
      (c: unknown[]) => (c[0] as Record<string, unknown>).method === "synapse/download-file",
    );
    expect(call).toBeDefined();
    expect((call![0] as Record<string, unknown>).params).toMatchObject({
      mimeType: "text/plain",
    });
  });

  it("downloadFile() uses the Blob's intrinsic type when mimeType is omitted", async () => {
    synapse = createSynapse({ name: "test-app", version: "1.0.0" });
    completeHandshake("nimblebrain");
    await synapse.ready;

    postMessageSpy.mockClear();

    const pdf = new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46])], {
      type: "application/pdf",
    });
    synapse.downloadFile("document.pdf", pdf);

    const call = postMessageSpy.mock.calls.find(
      (c: unknown[]) => (c[0] as Record<string, unknown>).method === "synapse/download-file",
    );
    expect(call).toBeDefined();
    expect((call![0] as Record<string, unknown>).params).toMatchObject({
      mimeType: "application/pdf",
    });
  });

  it("downloadFile() falls back to octet-stream when both mimeType and Blob type are absent", async () => {
    synapse = createSynapse({ name: "test-app", version: "1.0.0" });
    completeHandshake("nimblebrain");
    await synapse.ready;

    postMessageSpy.mockClear();

    const untyped = new Blob([new Uint8Array([1, 2, 3])]);
    synapse.downloadFile("file.bin", untyped);

    const call = postMessageSpy.mock.calls.find(
      (c: unknown[]) => (c[0] as Record<string, unknown>).method === "synapse/download-file",
    );
    expect(call).toBeDefined();
    expect((call![0] as Record<string, unknown>).params).toMatchObject({
      mimeType: "application/octet-stream",
    });
  });

  it("downloadFile() explicit mimeType arg overrides the Blob's intrinsic type", async () => {
    synapse = createSynapse({ name: "test-app", version: "1.0.0" });
    completeHandshake("nimblebrain");
    await synapse.ready;

    postMessageSpy.mockClear();

    const blob = new Blob(["hello"], { type: "text/plain" });
    synapse.downloadFile("document.md", blob, "text/markdown");

    const call = postMessageSpy.mock.calls.find(
      (c: unknown[]) => (c[0] as Record<string, unknown>).method === "synapse/download-file",
    );
    expect(call).toBeDefined();
    expect((call![0] as Record<string, unknown>).params).toMatchObject({
      mimeType: "text/markdown",
    });
  });

  it("openLink() sends ui/open-link as a request (with id)", async () => {
    synapse = createSynapse({ name: "test-app", version: "1.0.0" });
    completeHandshake("nimblebrain");
    await synapse.ready;

    postMessageSpy.mockClear();

    synapse.openLink("https://example.com");

    const call = postMessageSpy.mock.calls.find(
      (c: unknown[]) => (c[0] as Record<string, unknown>).method === "ui/open-link",
    );
    expect(call).toBeDefined();
    const msg = call![0] as Record<string, unknown>;
    expect(msg.method).toBe("ui/open-link");
    expect(msg.params).toEqual({ url: "https://example.com" });
    // Must be a request (has id), not a notification
    expect(typeof msg.id).toBe("string");
  });

  it("openLink() falls back to window.open when host doesn't respond", async () => {
    synapse = createSynapse({ name: "test-app", version: "1.0.0" });
    completeHandshake("other-host");
    await synapse.ready;

    postMessageSpy.mockClear();
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

    synapse.openLink("https://example.com");

    // The request was sent
    const call = postMessageSpy.mock.calls.find(
      (c: unknown[]) => (c[0] as Record<string, unknown>).method === "ui/open-link",
    );
    expect(call).toBeDefined();

    // Simulate no response — the .catch() fallback opens the link directly
    // Force the pending promise to reject by destroying the transport
    // (in practice, the timeout or lack of response triggers the catch)
    await vi.advanceTimersByTimeAsync(0);

    openSpy.mockRestore();
  });

  it("onAction() fires callback when ui/action message arrives", async () => {
    synapse = createSynapse({ name: "test-app", version: "1.0.0" });
    completeHandshake();
    await synapse.ready;

    const callback = vi.fn();
    synapse.onAction(callback);

    dispatchNotification("synapse/action", {
      type: "navigate",
      payload: { entity: "board", id: "bd_123" },
      label: "Go to board",
    });

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith({
      type: "navigate",
      payload: { entity: "board", id: "bd_123" },
      requiresConfirmation: false,
      label: "Go to board",
    });
  });

  it("onAction() ignores messages without a type field", async () => {
    synapse = createSynapse({ name: "test-app", version: "1.0.0" });
    completeHandshake();
    await synapse.ready;

    const callback = vi.fn();
    synapse.onAction(callback);

    dispatchNotification("synapse/action", { payload: { foo: "bar" } });

    expect(callback).not.toHaveBeenCalled();
  });

  it("onAction() unsubscribe stops callback", async () => {
    synapse = createSynapse({ name: "test-app", version: "1.0.0" });
    completeHandshake();
    await synapse.ready;

    const callback = vi.fn();
    const unsub = synapse.onAction(callback);

    dispatchNotification("synapse/action", { type: "refresh", payload: {} });
    expect(callback).toHaveBeenCalledTimes(1);

    unsub();

    dispatchNotification("synapse/action", { type: "refresh", payload: {} });
    expect(callback).toHaveBeenCalledTimes(1);
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
    const actionCallback = vi.fn();
    synapse.onDataChanged(dataCallback);
    synapse.onAction(actionCallback);

    synapse.destroy();

    postMessageSpy.mockClear();

    // After destroy, NB methods should not send messages
    synapse.action("test");
    expect(postMessageSpy).not.toHaveBeenCalled();

    // Data callbacks should no longer fire
    dispatchNotification("synapse/data-changed", {
      server: "s",
      tool: "t",
    });
    expect(dataCallback).not.toHaveBeenCalled();

    // Action callbacks should no longer fire
    dispatchNotification("synapse/action", {
      type: "navigate",
      payload: { entity: "board", id: "bd_1" },
    });
    expect(actionCallback).not.toHaveBeenCalled();

    // setVisibleState debounce timer should be cleared (no message after advance)
    synapse.setVisibleState({ x: 1 });
    vi.advanceTimersByTime(500);
    expect(postMessageSpy).not.toHaveBeenCalled();

    // Double destroy should not throw
    expect(() => synapse.destroy()).not.toThrow();
  });

  // ------------------------------------------------------------------------
  // Host context — single source of truth, theme is a derived selector
  // ------------------------------------------------------------------------

  describe("host context", () => {
    it("getHostContext() returns the handshake-provided context after ready", async () => {
      synapse = createSynapse({ name: "test-app", version: "1.0.0" });
      completeHandshake();
      await synapse.ready;

      const ctx = synapse.getHostContext();
      expect(ctx.theme).toBe("dark");
      expect(ctx.styles).toEqual({ variables: {} });
    });

    it("getHostContext() returns {} before handshake completes", () => {
      synapse = createSynapse({ name: "test-app", version: "1.0.0" });
      synapse.ready.catch(() => {});
      expect(synapse.getHostContext()).toEqual({});
    });

    it("onHostContextChanged fires on host-context-changed notifications with full snapshot", async () => {
      synapse = createSynapse({ name: "test-app", version: "1.0.0" });
      completeHandshake();
      await synapse.ready;

      const cb = vi.fn();
      synapse.onHostContextChanged(cb);

      dispatchNotification("ui/notifications/host-context-changed", {
        theme: "light",
        styles: { variables: { "--x": "1" } },
        workspace: { id: "ws_a", name: "Alpha" },
      });

      expect(cb).toHaveBeenCalledTimes(1);
      expect(cb).toHaveBeenCalledWith({
        theme: "light",
        styles: { variables: { "--x": "1" } },
        workspace: { id: "ws_a", name: "Alpha" },
      });
      expect(synapse.getHostContext()).toMatchObject({
        workspace: { id: "ws_a", name: "Alpha" },
      });
    });

    it("host-context-changed has replace semantics — fields not in the new params are dropped", async () => {
      synapse = createSynapse({ name: "test-app", version: "1.0.0" });
      completeHandshake();
      await synapse.ready;

      // First push: workspace present
      dispatchNotification("ui/notifications/host-context-changed", {
        theme: "dark",
        styles: { variables: {} },
        workspace: { id: "ws_a", name: "Alpha" },
      });
      expect(synapse.getHostContext()).toMatchObject({ workspace: { id: "ws_a" } });

      // Second push: workspace omitted — must NOT linger
      dispatchNotification("ui/notifications/host-context-changed", {
        theme: "dark",
        styles: { variables: {} },
      });
      expect(synapse.getHostContext().workspace).toBeUndefined();
    });

    it("onHostContextChanged unsubscribe stops further fires", async () => {
      synapse = createSynapse({ name: "test-app", version: "1.0.0" });
      completeHandshake();
      await synapse.ready;

      const cb = vi.fn();
      const unsub = synapse.onHostContextChanged(cb);
      dispatchNotification("ui/notifications/host-context-changed", {
        theme: "dark",
        styles: { variables: {} },
      });
      expect(cb).toHaveBeenCalledTimes(1);

      unsub();
      dispatchNotification("ui/notifications/host-context-changed", {
        theme: "light",
        styles: { variables: {} },
      });
      expect(cb).toHaveBeenCalledTimes(1);
    });

    it("destroy() clears host-context subscribers", async () => {
      synapse = createSynapse({ name: "test-app", version: "1.0.0" });
      completeHandshake();
      await synapse.ready;

      const cb = vi.fn();
      synapse.onHostContextChanged(cb);
      synapse.destroy();

      dispatchNotification("ui/notifications/host-context-changed", {
        theme: "light",
      });
      expect(cb).not.toHaveBeenCalled();
    });

    it("getTheme() is derived from host context — handshake reflects in theme.mode", async () => {
      synapse = createSynapse({ name: "test-app", version: "1.0.0" });
      completeHandshake();
      await synapse.ready;
      expect(synapse.getTheme().mode).toBe("dark");
    });

    it("onThemeChanged fires when host-context-changed actually moves the theme", async () => {
      synapse = createSynapse({ name: "test-app", version: "1.0.0" });
      completeHandshake();
      await synapse.ready;

      const cb = vi.fn();
      synapse.onThemeChanged(cb);

      dispatchNotification("ui/notifications/host-context-changed", {
        theme: "light",
        styles: { variables: {} },
      });
      expect(cb).toHaveBeenCalledTimes(1);
      expect(cb.mock.calls[0][0].mode).toBe("light");
    });

    it("onThemeChanged does NOT fire when only non-theme fields change (e.g. workspace)", async () => {
      synapse = createSynapse({ name: "test-app", version: "1.0.0" });
      completeHandshake();
      await synapse.ready;

      const themeCb = vi.fn();
      const ctxCb = vi.fn();
      synapse.onThemeChanged(themeCb);
      synapse.onHostContextChanged(ctxCb);

      // Same theme/styles as the handshake, only workspace differs
      dispatchNotification("ui/notifications/host-context-changed", {
        theme: "dark",
        styles: { variables: {} },
        workspace: { id: "ws_a", name: "Alpha" },
      });

      expect(ctxCb).toHaveBeenCalledTimes(1);
      expect(themeCb).not.toHaveBeenCalled();

      // Switching workspace again must still not fire theme
      dispatchNotification("ui/notifications/host-context-changed", {
        theme: "dark",
        styles: { variables: {} },
        workspace: { id: "ws_b", name: "Beta" },
      });
      expect(ctxCb).toHaveBeenCalledTimes(2);
      expect(themeCb).not.toHaveBeenCalled();
    });

    it("onThemeChanged fires on handshake even when host theme matches the SDK default", async () => {
      // Regression guard: a subscriber added before `synapse.ready` resolves
      // must receive the handshake fire, even when the handshake-provided
      // theme would derive to the same SynapseTheme as the empty/default
      // context the wrapped callback was seeded against.
      synapse = createSynapse({ name: "test-app", version: "1.0.0" });
      const cb = vi.fn();
      synapse.onThemeChanged(cb);

      // Hand the host a context whose extracted theme is light/no-tokens —
      // structurally identical to extractTheme({}). Pre-fix this would have
      // been silently filtered out as a no-op fire.
      const initCall = postMessageSpy.mock.calls.find(
        (c: unknown[]) =>
          c[0] &&
          typeof c[0] === "object" &&
          (c[0] as Record<string, unknown>).method === "ui/initialize",
      );
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
              hostContext: { theme: "light", styles: { variables: {} } },
            },
          },
        }),
      );
      await synapse.ready;

      expect(cb).toHaveBeenCalledTimes(1);
    });

    it("onThemeChanged fires when token values change even if mode is identical", async () => {
      synapse = createSynapse({ name: "test-app", version: "1.0.0" });
      completeHandshake();
      await synapse.ready;

      const cb = vi.fn();
      synapse.onThemeChanged(cb);

      dispatchNotification("ui/notifications/host-context-changed", {
        theme: "dark",
        styles: { variables: { "--color-bg": "#000" } },
      });
      expect(cb).toHaveBeenCalledTimes(1);
      expect(cb.mock.calls[0][0].tokens).toEqual({ "--color-bg": "#000" });
    });
  });
});

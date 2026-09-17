/**
 * Capability coverage for `connect()` — the host identity gate, the
 * `tools/call` wire shape, the NimbleBrain host extensions, the host-context and
 * theme views, and the tasks handshake.
 *
 * `connect.test.ts` covers the handshake and the ext-apps message shapes; this
 * file covers what an app can do once connected.
 */
import type { McpUiHostCapabilities } from "@modelcontextprotocol/ext-apps";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connect } from "../connect.js";
import { downloadFile } from "../download-file.js";
import { HostCapabilityError } from "../errors.js";
import { action, hostSupports, pickFile, pickFiles } from "../extensions.js";
import { readHostTasksCapability, TASKS_EXTENSION_ID } from "../task-handle.js";
import type { App, TasksCapability } from "../types.js";
import { FULL_HOST_CAPABILITIES } from "./helpers/host-capabilities.js";

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

function makeInitResult(hostName = "nimblebrain", overrides?: Record<string, unknown>) {
  return {
    protocolVersion: "2026-01-26",
    hostInfo: { name: hostName, version: "1.0.0" },
    hostCapabilities: FULL_HOST_CAPABILITIES,
    hostContext: {
      theme: "dark",
      styles: { variables: {} },
    },
    ...overrides,
  };
}

/** Start a connect() and answer its `ui/initialize`. */
async function connectAndHandshake(
  options?: Partial<Parameters<typeof connect>[0]>,
  initResult?: Record<string, unknown>,
): Promise<App> {
  const promise = connect({ name: "test-app", version: "1.0.0", ...options });

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
      data: { jsonrpc: "2.0", id, result: initResult ?? makeInitResult() },
    }),
  );

  const app = await promise;
  await flush();
  return app;
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

function lastRequest(): Record<string, unknown> {
  const calls = postMessageSpy.mock.calls;
  for (let i = calls.length - 1; i >= 0; i--) {
    const msg = calls[i][0] as Record<string, unknown>;
    if (msg.id !== undefined && msg.method) return msg;
  }
  throw new Error("No pending request found");
}

async function respondToLastRequest(result: unknown) {
  const msg = lastRequest();
  window.dispatchEvent(
    new MessageEvent("message", {
      source: window.parent,
      data: { jsonrpc: "2.0", id: msg.id, result },
    }),
  );
  await flush();
}

async function rejectLastRequest(code: number, message: string) {
  const msg = lastRequest();
  window.dispatchEvent(
    new MessageEvent("message", {
      source: window.parent,
      data: { jsonrpc: "2.0", id: msg.id, error: { code, message } },
    }),
  );
  await flush();
}

/** Every message sent for `method`, in order. `ui/message` is a request:
 * the spec defines it as one, and the client sends it as one. */
function sentByMethod(method: string): Record<string, unknown>[] {
  return postMessageSpy.mock.calls
    .map((c: unknown[]) => c[0] as Record<string, unknown>)
    .filter((m) => m?.method === method);
}

/** Every notification sent for `method`, in order. */
function sentNotifications(method: string): Record<string, unknown>[] {
  return postMessageSpy.mock.calls
    .map((c: unknown[]) => c[0] as Record<string, unknown>)
    .filter((m) => m?.method === method && m.id === undefined);
}

// --- Tests ---

describe("connect() capabilities", () => {
  let app: App;

  beforeEach(() => {
    postMessageSpy = vi.fn();
    window.parent.postMessage = postMessageSpy;
  });

  afterEach(() => {
    app?.destroy();
  });

  describe("host identity", () => {
    it("isNimbleBrainHost is true when hostInfo.name is 'nimblebrain'", async () => {
      app = await connectAndHandshake();
      expect(app.isNimbleBrainHost).toBe(true);
    });

    it("isNimbleBrainHost is false for other hosts", async () => {
      app = await connectAndHandshake({}, makeInitResult("claude"));
      expect(app.isNimbleBrainHost).toBe(false);
    });
  });

  describe("callTool", () => {
    it("sends tools/call and resolves with the parsed result", async () => {
      app = await connectAndHandshake();
      const p = app.callTool("search", { q: "test" });

      const msg = lastRequest();
      expect(msg.method).toBe("tools/call");
      expect(msg.params).toEqual({ name: "search", arguments: { q: "test" } });

      await respondToLastRequest({
        content: [{ type: "text", text: '{"hits":3}' }],
        structuredContent: { hits: 3 },
      });
      await expect(p).resolves.toMatchObject({ data: { hits: 3 }, isError: false });
    });

    // An app reaches its own server and nothing else. A host scopes every call
    // to whatever mounted the app, so there is no target to send — and the
    // params carry no way to name one, by either route a previous version used.
    // The guard is on the wire rather than on the type, because a type is not
    // what a host reads.
    it("names no target server, by any route", async () => {
      app = await connectAndHandshake();
      app.callTool("search").catch(() => {});
      const { params } = lastRequest();
      expect(params).toEqual({ name: "search", arguments: {} });
      expect(params).not.toHaveProperty("_meta");
      expect(params).not.toHaveProperty("server");
    });

    it("rejects on an error response", async () => {
      app = await connectAndHandshake();
      const p = app.callTool("boom");
      await rejectLastRequest(-32603, "tool exploded");
      await expect(p).rejects.toThrow("tool exploded");
    });
  });

  describe("readServerResource", () => {
    it("sends resources/read and returns contents unchanged", async () => {
      app = await connectAndHandshake();
      const p = app.readServerResource({ uri: "files://abc" });

      const msg = lastRequest();
      expect(msg.method).toBe("resources/read");
      expect(msg.params).toEqual({ uri: "files://abc" });

      const contents = { contents: [{ uri: "files://abc", mimeType: "text/plain", text: "hi" }] };
      await respondToLastRequest(contents);
      await expect(p).resolves.toEqual(contents);
    });

    it("rejects on an error response", async () => {
      app = await connectAndHandshake();
      const p = app.readServerResource({ uri: "files://missing" });
      await rejectLastRequest(-32602, "not found");
      await expect(p).rejects.toThrow("not found");
    });
  });

  describe("pickFile / pickFiles", () => {
    const fileResult = {
      id: "fl_0123456789abcdef01234567",
      filename: "a.csv",
      mimeType: "text/csv",
      size: 12,
    };

    it("pickFile sends ai.nimblebrain/request-file with multiple: false", async () => {
      app = await connectAndHandshake();
      const p = pickFile(app, { accept: ".csv" });

      const msg = lastRequest();
      expect(msg.method).toBe("ai.nimblebrain/request-file");
      expect(msg.params).toMatchObject({ accept: ".csv", multiple: false });

      await respondToLastRequest({ files: [fileResult] });
      await expect(p).resolves.toEqual(fileResult);
    });

    it("pickFiles sends multiple: true and resolves the files the host returned", async () => {
      app = await connectAndHandshake();
      const p = pickFiles(app);
      expect(lastRequest().params).toMatchObject({ multiple: true });
      await respondToLastRequest({
        files: [fileResult, { ...fileResult, id: "fl_ffffffffffffffffffffffff" }],
      });
      await expect(p).resolves.toHaveLength(2);
    });

    it("pickFile resolves null when the user cancels", async () => {
      app = await connectAndHandshake();
      const p = pickFile(app);
      await respondToLastRequest({ files: [] });
      await expect(p).resolves.toBeNull();
    });

    it("pickFiles resolves [] when the user cancels", async () => {
      app = await connectAndHandshake();
      const p = pickFiles(app);
      await respondToLastRequest({ files: [] });
      await expect(p).resolves.toEqual([]);
    });

    it("pickFile throws loudly on the legacy base64 shape (no `id`)", async () => {
      app = await connectAndHandshake();
      const p = pickFile(app);
      await respondToLastRequest({ files: [{ base64Data: "AAA=", filename: "a.csv" }] });
      await expect(p).rejects.toThrow(/without a string `id`/);
    });

    it("pickFiles throws if any entry is missing `id`", async () => {
      app = await connectAndHandshake();
      const p = pickFiles(app);
      await respondToLastRequest({ files: [fileResult, { filename: "b.csv" }] });
      await expect(p).rejects.toThrow(/without a string `id`/);
    });

    it("rejects without sending where the host did not declare it, whatever the host is called", async () => {
      app = await connectAndHandshake({}, makeInitResult("nimblebrain", { hostCapabilities: {} }));
      expect(hostSupports(app, "requestFile")).toBe(false);
      for (const pick of [pickFile, pickFiles]) {
        const error = await pick(app).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(HostCapabilityError);
        expect((error as HostCapabilityError).capability).toBe("ai.nimblebrain/request-file");
      }
      expect(sentByMethod("ai.nimblebrain/request-file")).toHaveLength(0);
    });

    it("works on any host that declares it", async () => {
      app = await connectAndHandshake({}, makeInitResult("another-host"));
      expect(hostSupports(app, "requestFile")).toBe(true);
      const p = pickFile(app);
      await respondToLastRequest({ files: [] });
      await expect(p).resolves.toBeNull();
    });
  });

  describe("resources/list_changed", () => {
    it("a subscriber on the wire method gets the params verbatim", async () => {
      app = await connectAndHandshake();
      const raw = vi.fn();
      app.on("notifications/resources/list_changed", raw);

      await dispatchNotification("notifications/resources/list_changed", { _meta: { k: "v" } });

      expect(raw).toHaveBeenCalledTimes(1);
      expect(raw).toHaveBeenCalledWith({ _meta: { k: "v" } });
    });

    it("unsubscribe stops delivery", async () => {
      app = await connectAndHandshake();
      const cb = vi.fn();
      const off = app.on("notifications/resources/list_changed", cb);
      off();
      await dispatchNotification("notifications/resources/list_changed", {});
      expect(cb).not.toHaveBeenCalled();
    });

    it("synapse/data-changed feeds no event", async () => {
      // A NimbleBrain host still sends it, and nothing here translates it. A
      // leftover `on("data-changed")` type-checks through the string overload
      // and subscribes to a method of that name, which nothing sends.
      app = await connectAndHandshake();
      const cb = vi.fn();
      app.on("data-changed", cb);

      await dispatchNotification("synapse/data-changed", { server: "s", tool: "t" });

      expect(cb).not.toHaveBeenCalled();
    });
  });

  describe("action", () => {
    it("sends ai.nimblebrain/action on a NimbleBrain host", async () => {
      app = await connectAndHandshake();
      action(app, "navigate", { entity: "board", id: "b1" });

      const sent = sentNotifications("ai.nimblebrain/action");
      expect(sent).toHaveLength(1);
      expect(sent[0].params).toEqual({ action: "navigate", entity: "board", id: "b1" });
    });

    it("is a no-op where the host did not declare it, whatever the host is called", async () => {
      app = await connectAndHandshake({}, makeInitResult("nimblebrain", { hostCapabilities: {} }));
      action(app, "navigate", { id: "b1" });
      await flush();
      expect(sentNotifications("ai.nimblebrain/action")).toHaveLength(0);
    });

    it("sends on any host that declares it", async () => {
      app = await connectAndHandshake({}, makeInitResult("another-host"));
      action(app, "navigate", { id: "b1" });
      await flush();
      expect(sentNotifications("ai.nimblebrain/action")).toHaveLength(1);
    });
  });

  describe("sendMessage", () => {
    it('attaches the chat context under _meta["ai.nimblebrain/context"] on a NimbleBrain host', async () => {
      app = await connectAndHandshake();
      app.sendMessage("hello", { action: "open", entity: "board" });
      await flush();

      const sent = sentByMethod("ui/message");
      expect(sent[0].params).toEqual({
        role: "user",
        content: [
          {
            type: "text",
            text: "hello",
            _meta: { "ai.nimblebrain/context": { action: "open", entity: "board" } },
          },
        ],
      });
    });

    it("omits _meta off a NimbleBrain host — the field is a NimbleBrain convention", async () => {
      app = await connectAndHandshake({}, makeInitResult("claude"));
      app.sendMessage("hello", { action: "open" });
      await flush();

      const sent = sentByMethod("ui/message");
      expect(sent[0].params).toEqual({
        role: "user",
        content: [{ type: "text", text: "hello" }],
      });
    });

    it("omits _meta when no context is given", async () => {
      app = await connectAndHandshake();
      app.sendMessage("hello");
      await flush();
      const sent = sentByMethod("ui/message");
      expect(sent[0].params).toEqual({ role: "user", content: [{ type: "text", text: "hello" }] });
    });
  });

  describe("downloadFile", () => {
    /** A NimbleBrain host that advertises `downloadFile`. */
    function connectAdvertising(hostName = "nimblebrain"): Promise<App> {
      return connectAndHandshake(
        {},
        makeInitResult(hostName, { hostCapabilities: { downloadFile: {} } }),
      );
    }

    /**
     * The `ui/download-file` request once it is on the wire. A Blob is read
     * before the request goes out, so it arrives some microtasks after the call.
     */
    async function sentDownload(): Promise<Record<string, unknown>> {
      return vi.waitFor(() => {
        const msg = lastRequest();
        if (msg.method !== "ui/download-file") throw new Error("not sent yet");
        return msg;
      });
    }

    async function sentResource(): Promise<Record<string, unknown>> {
      const params = (await sentDownload()).params as { contents: Record<string, unknown>[] };
      expect(params.contents).toHaveLength(1);
      expect(params.contents[0].type).toBe("resource");
      return params.contents[0].resource as Record<string, unknown>;
    }

    /** A call whose outcome this test does not assert: `destroy()` rejects it on teardown. */
    function settle(pending: Promise<unknown>): void {
      pending.catch(() => {});
    }

    function decode(base64: string): number[] {
      return Array.from(atob(base64), (c) => c.charCodeAt(0));
    }

    it("sends a string as an embedded text resource", async () => {
      app = await connectAdvertising();
      settle(downloadFile(app, "a.csv", "a,b\n1,2", "text/csv"));
      expect(await sentResource()).toEqual({
        uri: "file:///a.csv",
        mimeType: "text/csv",
        text: "a,b\n1,2",
      });
    });

    it("sends a Blob as base64, byte for byte", async () => {
      app = await connectAdvertising();
      const bytes = [0, 1, 127, 128, 254, 255];
      settle(downloadFile(app, "a.bin", new Blob([new Uint8Array(bytes)])));
      const resource = await sentResource();
      expect(resource.text).toBeUndefined();
      expect(decode(resource.blob as string)).toEqual(bytes);
    });

    it("encodes a Blob larger than one encoding chunk", async () => {
      app = await connectAdvertising();
      const bytes = Array.from({ length: 100_000 }, (_, i) => i % 256);
      settle(downloadFile(app, "a.bin", new Blob([new Uint8Array(bytes)])));
      expect(decode((await sentResource()).blob as string)).toEqual(bytes);
    });

    it("resolves with the host's result, including a refusal", async () => {
      app = await connectAdvertising();
      const pending = downloadFile(app, "a.txt", "x");
      await sentDownload();
      await respondToLastRequest({ isError: true });
      await expect(pending).resolves.toEqual({ isError: true });
    });

    it("rejects without sending when the host did not advertise downloadFile", async () => {
      // A host that does not implement the request may never answer it, and a
      // request has no deadline — sending would leave the promise pending forever.
      app = await connectAndHandshake({}, makeInitResult("nimblebrain", { hostCapabilities: {} }));
      const error = await downloadFile(app, "a.txt", "x").catch((e: unknown) => e);
      expect(error).toBeInstanceOf(HostCapabilityError);
      expect((error as HostCapabilityError).capability).toBe("downloadFile");
      const sent = postMessageSpy.mock.calls.some(
        (c: unknown[]) => (c[0] as Record<string, unknown>)?.method === "ui/download-file",
      );
      expect(sent).toBe(false);
    });

    it("rejects when an advertising host answers with an error", async () => {
      app = await connectAdvertising();
      const pending = downloadFile(app, "a.txt", "x");
      await sentDownload();
      await rejectLastRequest(-32601, "method not found");
      await expect(pending).rejects.toThrow("method not found");
    });

    it("is not gated on a NimbleBrain host — it is spec surface", async () => {
      app = await connectAdvertising("claude");
      settle(downloadFile(app, "a.txt", "x"));
      expect((await sentResource()).text).toBe("x");
    });

    it("defaults string content to application/octet-stream", async () => {
      app = await connectAdvertising();
      settle(downloadFile(app, "a.bin", "x"));
      expect((await sentResource()).mimeType).toBe("application/octet-stream");
    });

    it("treats an empty-string mimeType argument as absent", async () => {
      app = await connectAdvertising();
      settle(downloadFile(app, "a.txt", new Blob(["x"], { type: "text/plain" }), ""));
      expect((await sentResource()).mimeType).toBe("text/plain");
    });

    it("uses the Blob's intrinsic type when mimeType is omitted", async () => {
      app = await connectAdvertising();
      settle(downloadFile(app, "a.json", new Blob(["{}"], { type: "application/json" })));
      expect((await sentResource()).mimeType).toBe("application/json");
    });

    it("falls back to octet-stream when neither is present", async () => {
      app = await connectAdvertising();
      settle(downloadFile(app, "a.bin", new Blob(["x"])));
      expect((await sentResource()).mimeType).toBe("application/octet-stream");
    });

    it("an explicit mimeType overrides the Blob's intrinsic type", async () => {
      app = await connectAdvertising();
      settle(downloadFile(app, "a.csv", new Blob(["x"], { type: "text/plain" }), "text/csv"));
      expect((await sentResource()).mimeType).toBe("text/csv");
    });
  });

  describe("openLink", () => {
    it("sends ui/open-link as a request", async () => {
      app = await connectAndHandshake();
      app.openLink("https://example.com");
      const msg = lastRequest();
      expect(msg.method).toBe("ui/open-link");
      expect(msg.params).toEqual({ url: "https://example.com" });
      expect(msg.id).toBeDefined();
    });

    it("falls back to window.open when the host rejects", async () => {
      app = await connectAndHandshake();
      const openSpy = vi.fn();
      window.open = openSpy as unknown as typeof window.open;

      app.openLink("https://example.com");
      await rejectLastRequest(-32601, "method not found");
      await Promise.resolve();
      await Promise.resolve();

      expect(openSpy).toHaveBeenCalledWith("https://example.com", "_blank", "noopener");
    });
  });

  describe("host context", () => {
    it("hostContext is the handshake-provided context", async () => {
      app = await connectAndHandshake(
        {},
        makeInitResult("nimblebrain", {
          hostContext: { theme: "dark", styles: { variables: {} }, workspace: { id: "ws_1" } },
        }),
      );
      expect(app.hostContext).toMatchObject({ theme: "dark", workspace: { id: "ws_1" } });
    });

    it("host-context-changed delivers the notification's snapshot", async () => {
      app = await connectAndHandshake();
      const seen: unknown[] = [];
      app.on("host-context-changed", (c) => seen.push(c));

      await dispatchNotification("ui/notifications/host-context-changed", {
        theme: "light",
        styles: { variables: { "--color-background-primary": "#fff" } },
      });

      expect(seen).toHaveLength(1);
      expect(app.hostContext).toMatchObject({ theme: "light" });
    });

    // The spec types the notification as "a partial context update containing
    // only changed fields", so a bare `{ theme }` toggle must not cost the host
    // its palette or its extensions.
    it("a partial host-context-changed preserves the fields it omits", async () => {
      app = await connectAndHandshake(
        {},
        makeInitResult("nimblebrain", {
          hostContext: {
            theme: "dark",
            styles: { variables: { "--color-ring-primary": "#315EDB" } },
            toolInfo: { tool: { name: "search", inputSchema: { type: "object" } } },
            containerDimensions: { width: 400 },
            workspace: { id: "ws_1" },
          },
        }),
      );

      await dispatchNotification("ui/notifications/host-context-changed", { theme: "light" });

      expect(app.theme).toEqual({ mode: "light", tokens: { "--color-ring-primary": "#315EDB" } });
      expect(app.hostContext).toMatchObject({
        theme: "light",
        toolInfo: { tool: { name: "search" } },
        containerDimensions: { width: 400 },
        workspace: { id: "ws_1" },
      });
    });

    it("an explicit value still replaces", async () => {
      app = await connectAndHandshake(
        {},
        makeInitResult("nimblebrain", {
          hostContext: {
            theme: "dark",
            styles: {
              variables: { "--color-background-primary": "1", "--color-text-primary": "2" },
            },
          },
        }),
      );

      // `styles.variables` is a complete map when the host sends one, so the
      // merge is shallow: this drops `--b` rather than keeping it around
      // forever with no way for a host to remove a variable.
      await dispatchNotification("ui/notifications/host-context-changed", {
        styles: { variables: { "--color-background-primary": "9" } },
      });

      expect(app.theme.tokens).toEqual({ "--color-background-primary": "9" });
    });

    it("the short event delivers the merged snapshot; the wire method delivers the delta", async () => {
      app = await connectAndHandshake(
        {},
        makeInitResult("nimblebrain", {
          hostContext: { theme: "dark", styles: { variables: {} }, workspace: { id: "ws_1" } },
        }),
      );
      const merged = vi.fn();
      const delta = vi.fn();
      app.on("host-context-changed", merged);
      app.on("ui/notifications/host-context-changed", delta);

      await dispatchNotification("ui/notifications/host-context-changed", { theme: "light" });

      expect(merged).toHaveBeenCalledWith(
        expect.objectContaining({ theme: "light", workspace: { id: "ws_1" } }),
      );
      expect(delta).toHaveBeenCalledWith({ theme: "light" });
    });

    it("unsubscribe stops further fires", async () => {
      app = await connectAndHandshake();
      const cb = vi.fn();
      const off = app.on("host-context-changed", cb);
      off();
      await dispatchNotification("ui/notifications/host-context-changed", { theme: "light" });
      expect(cb).not.toHaveBeenCalled();
    });

    it("destroy() clears host-context subscribers", async () => {
      app = await connectAndHandshake();
      const cb = vi.fn();
      app.on("host-context-changed", cb);
      app.destroy();
      await dispatchNotification("ui/notifications/host-context-changed", { theme: "light" });
      expect(cb).not.toHaveBeenCalled();
    });
  });

  describe("theme", () => {
    it("is derived from the host context", async () => {
      app = await connectAndHandshake();
      expect(app.theme.mode).toBe("dark");
    });

    it("theme-changed fires when the context actually moves the theme", async () => {
      app = await connectAndHandshake();
      const seen: unknown[] = [];
      app.on("theme-changed", (t) => seen.push(t));

      await dispatchNotification("ui/notifications/host-context-changed", {
        theme: "light",
        styles: { variables: {} },
      });

      expect(seen).toEqual([{ mode: "light", tokens: {} }]);
    });

    it("theme-changed does NOT fire when only non-theme fields change", async () => {
      app = await connectAndHandshake();
      const cb = vi.fn();
      app.on("theme-changed", cb);

      await dispatchNotification("ui/notifications/host-context-changed", {
        theme: "dark",
        styles: { variables: {} },
        workspace: { id: "ws_2" },
      });

      expect(cb).not.toHaveBeenCalled();
    });

    it("theme-changed fires when token values change even if the mode is identical", async () => {
      app = await connectAndHandshake();
      const cb = vi.fn();
      app.on("theme-changed", cb);

      await dispatchNotification("ui/notifications/host-context-changed", {
        theme: "dark",
        styles: { variables: { "--color-background-primary": "#000" } },
      });

      expect(cb).toHaveBeenCalledTimes(1);
    });
  });

  describe("tasks capability", () => {
    it("ui/initialize advertises appCapabilities.tasks with cancel and requests.tools.call", async () => {
      connect({ name: "test-app", version: "1.0.0" }).catch(() => {});

      await flush();

      const initCall = postMessageSpy.mock.calls.find(
        (c: unknown[]) => (c[0] as Record<string, unknown>)?.method === "ui/initialize",
      );
      const params = (initCall?.[0] as Record<string, unknown>).params as Record<string, unknown>;
      expect(params.appCapabilities).toEqual({
        tasks: { cancel: {}, requests: { tools: { call: {} } } },
      });
    });

    const tasks: TasksCapability = { cancel: {}, requests: { tools: { call: {} } } };
    const withExperimental = (experimental: Record<string, unknown>) =>
      makeInitResult("nimblebrain", { hostCapabilities: { experimental } });

    it("supportsTasks is true when the host advertised it under the extension identifier", async () => {
      app = await connectAndHandshake(
        {},
        withExperimental({ "io.modelcontextprotocol/tasks": tasks }),
      );
      expect(app.supportsTasks).toBe(true);
    });

    it("a key other than the extension identifier is not read", async () => {
      // One key. A host publishing the capability under some other name is not
      // advertising this extension, and reading it anyway would make the
      // identifier decorative.
      app = await connectAndHandshake({}, withExperimental({ "ai.nimblebrain/tasks": tasks }));
      expect(app.supportsTasks).toBe(false);
    });

    it("a malformed experimental entry reads as no capability", () => {
      // Read directly rather than driven through a handshake: `experimental` is
      // typed as a record of records, so a client that validates the result
      // against the spec's schema refuses this shape upstream and it never
      // reaches the read over the wire. What the guard prevents is a stored
      // capability that contradicts its own type — both callers ask only
      // `?.requests?.tools?.call`, so it is not visible in `supportsTasks`.
      expect(
        readHostTasksCapability({
          experimental: { [TASKS_EXTENSION_ID]: "yes" },
        } as unknown as McpUiHostCapabilities),
      ).toBeUndefined();
    });

    it("a top-level hostCapabilities.tasks is not read", async () => {
      // A spec client's handshake parse strips it, so honouring it here would
      // show a capability that no client validating the handshake can see.
      app = await connectAndHandshake(
        {},
        makeInitResult("nimblebrain", { hostCapabilities: { tasks } }),
      );
      expect(app.supportsTasks).toBe(false);
    });

    it("supportsTasks is false when the host advertised none", async () => {
      app = await connectAndHandshake();
      expect(app.supportsTasks).toBe(false);
    });

    it("supportsTasks is false when the host advertised tasks but not tools/call", async () => {
      app = await connectAndHandshake(
        {},
        withExperimental({ "io.modelcontextprotocol/tasks": { cancel: {} } }),
      );
      expect(app.supportsTasks).toBe(false);
    });
  });

  describe("keyboard forwarding", () => {
    function pressEscape() {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    }

    it("is off unless asked for", async () => {
      app = await connectAndHandshake();
      pressEscape();
      expect(sentNotifications("ai.nimblebrain/keydown")).toHaveLength(0);
    });

    it("forwards the default set when enabled on a NimbleBrain host", async () => {
      app = await connectAndHandshake({ forwardKeys: true });
      pressEscape();
      expect(sentNotifications("ai.nimblebrain/keydown")).toHaveLength(1);
    });

    it("forwards exactly the listed combos when given an array", async () => {
      app = await connectAndHandshake({ forwardKeys: [{ key: "k", meta: true }] });

      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }),
      );
      expect(sentNotifications("ai.nimblebrain/keydown")).toHaveLength(1);

      // Escape is in the default set but not in this one.
      pressEscape();
      expect(sentNotifications("ai.nimblebrain/keydown")).toHaveLength(1);
    });

    it("stays off where the host did not declare it, whatever the host is called", async () => {
      app = await connectAndHandshake(
        { forwardKeys: true },
        makeInitResult("nimblebrain", {
          hostCapabilities: { ...FULL_HOST_CAPABILITIES, experimental: {} },
        }),
      );
      pressEscape();
      expect(sentNotifications("ai.nimblebrain/keydown")).toHaveLength(0);
    });

    it("destroy() removes the listener", async () => {
      app = await connectAndHandshake({ forwardKeys: true });
      app.destroy();
      pressEscape();
      expect(sentNotifications("ai.nimblebrain/keydown")).toHaveLength(0);
    });
  });

  // The portable-app contract: what each call does on a host that declares
  // nothing. Requests with an answer reject before sending, because a host that
  // does not implement one may never answer and requests carry no deadline.
  // Fire-and-forget calls send nothing. Each row is documented on the method.
  describe("on a host that declares no capabilities", () => {
    beforeEach(async () => {
      app = await connectAndHandshake({}, makeInitResult("another-host", { hostCapabilities: {} }));
      postMessageSpy.mockClear();
    });

    it("exposes the declaration it read", () => {
      expect(app.hostCapabilities).toEqual({});
    });

    it("callTool rejects with HostCapabilityError and sends nothing", async () => {
      const error = await app.callTool("list").catch((e: unknown) => e);
      expect(error).toBeInstanceOf(HostCapabilityError);
      expect((error as HostCapabilityError).capability).toBe("serverTools");
      expect(sentByMethod("tools/call")).toHaveLength(0);
    });

    it("readServerResource rejects with HostCapabilityError and sends nothing", async () => {
      const error = await app.readServerResource({ uri: "x://a" }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(HostCapabilityError);
      expect((error as HostCapabilityError).capability).toBe("serverResources");
      expect(sentByMethod("resources/read")).toHaveLength(0);
    });

    it("sendMessage and updateModelContext send nothing", async () => {
      app.sendMessage("hello");
      app.updateModelContext({ a: 1 }, "summary");
      await flush();
      expect(sentByMethod("ui/message")).toHaveLength(0);
      expect(sentByMethod("ui/update-model-context")).toHaveLength(0);
    });

    it("openLink opens the URL itself instead of asking the host", async () => {
      const open = vi.spyOn(window, "open").mockReturnValue(null);
      app.openLink("https://example.com/");
      await flush();
      expect(open).toHaveBeenCalledWith("https://example.com/", "_blank", "noopener");
      expect(sentByMethod("ui/open-link")).toHaveLength(0);
    });

    it("resize still reports, because the spec gates it on nothing", async () => {
      app.resize(100, 200);
      await flush();
      expect(sentNotifications("ui/notifications/size-changed")).toHaveLength(1);
    });

    it("reports no NimbleBrain extension", () => {
      expect(hostSupports(app, "action")).toBe(false);
      expect(hostSupports(app, "requestFile")).toBe(false);
      expect(hostSupports(app, "keydown")).toBe(false);
    });
  });

  describe("lifecycle", () => {
    it("destroyed flips on destroy()", async () => {
      app = await connectAndHandshake();
      expect(app.destroyed).toBe(false);
      app.destroy();
      expect(app.destroyed).toBe(true);
    });

    it("double destroy does not throw", async () => {
      app = await connectAndHandshake();
      app.destroy();
      expect(() => app.destroy()).not.toThrow();
    });
  });
});

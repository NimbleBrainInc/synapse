/**
 * Capability coverage for `connect()` — the host identity gate, cross-server
 * routing, the `synapse/*` extensions, the host-context and theme views, and
 * the tasks handshake.
 *
 * `connect.test.ts` covers the handshake and the ext-apps message shapes; this
 * file covers what an app can do once connected.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connect } from "../connect.js";
import { SERVER_META_KEY } from "../event-map.js";
import { action, downloadFile, pickFile, pickFiles } from "../extensions.js";
import type { App, TasksCapability } from "../types.js";

// --- Helpers ---

let postMessageSpy: ReturnType<typeof vi.fn>;

function makeInitResult(hostName = "nimblebrain", overrides?: Record<string, unknown>) {
  return {
    protocolVersion: "2026-01-26",
    hostInfo: { name: hostName, version: "1.0.0" },
    hostCapabilities: {},
    hostContext: {
      theme: "dark",
      styles: { variables: {} },
    },
    ...overrides,
  };
}

/** Start a connect() and answer its `ui/initialize`. */
function connectAndHandshake(
  options?: Partial<Parameters<typeof connect>[0]>,
  initResult?: Record<string, unknown>,
): Promise<App> {
  const promise = connect({ name: "test-app", version: "1.0.0", ...options });

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

function lastRequest(): Record<string, unknown> {
  const calls = postMessageSpy.mock.calls;
  for (let i = calls.length - 1; i >= 0; i--) {
    const msg = calls[i][0] as Record<string, unknown>;
    if (msg.id && msg.method) return msg;
  }
  throw new Error("No pending request found");
}

function respondToLastRequest(result: unknown) {
  const msg = lastRequest();
  window.dispatchEvent(
    new MessageEvent("message", {
      data: { jsonrpc: "2.0", id: msg.id, result },
    }),
  );
}

function rejectLastRequest(code: number, message: string) {
  const msg = lastRequest();
  window.dispatchEvent(
    new MessageEvent("message", {
      data: { jsonrpc: "2.0", id: msg.id, error: { code, message } },
    }),
  );
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

      respondToLastRequest({
        content: [{ type: "text", text: '{"hits":3}' }],
        structuredContent: { hits: 3 },
      });
      await expect(p).resolves.toMatchObject({ data: { hits: 3 }, isError: false });
    });

    it("omits the server key entirely for a non-internal app", async () => {
      app = await connectAndHandshake();
      app.callTool("search").catch(() => {});
      expect(lastRequest().params).not.toHaveProperty("_meta");
      // The pre-`_meta` sibling field must not come back either: a spec host
      // strips it, so re-adding it would only make the call look addressed.
      expect(lastRequest().params).not.toHaveProperty("server");
    });

    it("an internal app carries its own name in the server _meta key", async () => {
      app = await connectAndHandshake({ internal: true });
      app.callTool("search").catch(() => {});
      expect(lastRequest().params).toMatchObject({
        _meta: { [SERVER_META_KEY]: "test-app" },
      });
      expect(lastRequest().params).not.toHaveProperty("server");
    });

    it("an explicit `server` option routes the call cross-server through _meta", async () => {
      app = await connectAndHandshake({ internal: true });
      app.callTool("list_contacts", undefined, { server: "people" }).catch(() => {});
      expect(lastRequest().params).toMatchObject({
        name: "list_contacts",
        _meta: { [SERVER_META_KEY]: "people" },
      });
      expect(lastRequest().params).not.toHaveProperty("server");
    });

    it("rejects on an error response", async () => {
      app = await connectAndHandshake();
      const p = app.callTool("boom");
      rejectLastRequest(-32603, "tool exploded");
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
      respondToLastRequest(contents);
      await expect(p).resolves.toEqual(contents);
    });

    it("rejects on an error response", async () => {
      app = await connectAndHandshake();
      const p = app.readServerResource({ uri: "files://missing" });
      rejectLastRequest(-32602, "not found");
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

    it("pickFile sends synapse/request-file with multiple: false", async () => {
      app = await connectAndHandshake();
      const p = pickFile(app, { accept: ".csv" });

      const msg = lastRequest();
      expect(msg.method).toBe("synapse/request-file");
      expect(msg.params).toMatchObject({ accept: ".csv", multiple: false });

      respondToLastRequest(fileResult);
      await expect(p).resolves.toEqual(fileResult);
    });

    it("pickFiles sends multiple: true and accepts an array result", async () => {
      app = await connectAndHandshake();
      const p = pickFiles(app);
      expect(lastRequest().params).toMatchObject({ multiple: true });
      respondToLastRequest([fileResult, { ...fileResult, id: "fl_ffffffffffffffffffffffff" }]);
      await expect(p).resolves.toHaveLength(2);
    });

    it("pickFile resolves null when the user cancels", async () => {
      app = await connectAndHandshake();
      const p = pickFile(app);
      respondToLastRequest(null);
      await expect(p).resolves.toBeNull();
    });

    it("pickFiles resolves [] when the user cancels", async () => {
      app = await connectAndHandshake();
      const p = pickFiles(app);
      respondToLastRequest(null);
      await expect(p).resolves.toEqual([]);
    });

    it("pickFile throws loudly on the legacy base64 shape (no `id`)", async () => {
      app = await connectAndHandshake();
      const p = pickFile(app);
      respondToLastRequest({ base64Data: "AAA=", filename: "a.csv" });
      await expect(p).rejects.toThrow(/without a string `id`/);
    });

    it("pickFiles throws if any entry is missing `id`", async () => {
      app = await connectAndHandshake();
      const p = pickFiles(app);
      respondToLastRequest([fileResult, { filename: "b.csv" }]);
      await expect(p).rejects.toThrow(/without a string `id`/);
    });

    it("throws off a NimbleBrain host rather than hanging", async () => {
      app = await connectAndHandshake({}, makeInitResult("claude"));
      await expect(pickFile(app)).rejects.toThrow(/not supported in this host/);
      await expect(pickFiles(app)).rejects.toThrow(/not supported in this host/);
    });
  });

  describe("data-changed", () => {
    it("fires on a synapse/data-changed notification", async () => {
      app = await connectAndHandshake();
      const seen: unknown[] = [];
      app.on("data-changed", (e) => seen.push(e));

      dispatchNotification("synapse/data-changed", { server: "people", tool: "update_contact" });

      expect(seen).toEqual([{ source: "agent", server: "people", tool: "update_contact" }]);
    });

    it("unsubscribe stops delivery", async () => {
      app = await connectAndHandshake();
      const cb = vi.fn();
      const off = app.on("data-changed", cb);
      off();
      dispatchNotification("synapse/data-changed", { server: "s", tool: "t" });
      expect(cb).not.toHaveBeenCalled();
    });

    it("a subscriber on the raw wire method gets the params verbatim", async () => {
      app = await connectAndHandshake();
      const raw = vi.fn();
      app.on("synapse/data-changed", raw);

      dispatchNotification("synapse/data-changed", { server: "s", tool: "t" });

      expect(raw).toHaveBeenCalledWith({ server: "s", tool: "t" });
    });
  });

  describe("action (outbound)", () => {
    it("sends synapse/action on a NimbleBrain host", async () => {
      app = await connectAndHandshake();
      action(app, "navigate", { entity: "board", id: "b1" });

      const sent = sentNotifications("synapse/action");
      expect(sent).toHaveLength(1);
      expect(sent[0].params).toEqual({ action: "navigate", entity: "board", id: "b1" });
    });

    it("is a no-op off a NimbleBrain host", async () => {
      app = await connectAndHandshake({}, makeInitResult("claude"));
      action(app, "navigate", { id: "b1" });
      expect(sentNotifications("synapse/action")).toHaveLength(0);
    });
  });

  describe("action (inbound)", () => {
    it("fires on a synapse/action notification", async () => {
      app = await connectAndHandshake();
      const seen: unknown[] = [];
      app.on("action", (a) => seen.push(a));

      dispatchNotification("synapse/action", {
        type: "navigate",
        payload: { entity: "board", id: "b1" },
        label: "Open board",
      });

      expect(seen).toEqual([
        {
          type: "navigate",
          payload: { entity: "board", id: "b1" },
          requiresConfirmation: false,
          label: "Open board",
        },
      ]);
    });

    it("ignores a notification with no `type`", async () => {
      app = await connectAndHandshake();
      const cb = vi.fn();
      app.on("action", cb);
      dispatchNotification("synapse/action", { payload: {} });
      expect(cb).not.toHaveBeenCalled();
    });

    it("unsubscribe stops delivery", async () => {
      app = await connectAndHandshake();
      const cb = vi.fn();
      const off = app.on("action", cb);
      off();
      dispatchNotification("synapse/action", { type: "refresh", payload: {} });
      expect(cb).not.toHaveBeenCalled();
    });
  });

  describe("sendMessage", () => {
    it("attaches _meta.context on a NimbleBrain host", async () => {
      app = await connectAndHandshake();
      app.sendMessage("hello", { action: "open", entity: "board" });

      const sent = sentNotifications("ui/message");
      expect(sent[0].params).toEqual({
        role: "user",
        content: [
          { type: "text", text: "hello", _meta: { context: { action: "open", entity: "board" } } },
        ],
      });
    });

    it("omits _meta off a NimbleBrain host — the field is a NimbleBrain convention", async () => {
      app = await connectAndHandshake({}, makeInitResult("claude"));
      app.sendMessage("hello", { action: "open" });

      const sent = sentNotifications("ui/message");
      expect(sent[0].params).toEqual({
        role: "user",
        content: [{ type: "text", text: "hello" }],
      });
    });

    it("omits _meta when no context is given", async () => {
      app = await connectAndHandshake();
      app.sendMessage("hello");
      const sent = sentNotifications("ui/message");
      expect(sent[0].params).toEqual({ role: "user", content: [{ type: "text", text: "hello" }] });
    });
  });

  describe("downloadFile", () => {
    function lastDownload(): Record<string, unknown> {
      const sent = sentNotifications("synapse/download-file");
      return sent[sent.length - 1].params as Record<string, unknown>;
    }

    it("sends synapse/download-file with a Blob payload", async () => {
      app = await connectAndHandshake();
      downloadFile(app, "a.csv", "a,b\n1,2", "text/csv");
      const params = lastDownload();
      expect(params.filename).toBe("a.csv");
      expect(params.mimeType).toBe("text/csv");
      expect(params.data).toBeInstanceOf(Blob);
    });

    it("passes a Blob through unchanged", async () => {
      app = await connectAndHandshake();
      const blob = new Blob(["x"], { type: "text/plain" });
      downloadFile(app, "a.txt", blob);
      expect(lastDownload().data).toBe(blob);
    });

    it("defaults string content to application/octet-stream", async () => {
      app = await connectAndHandshake();
      downloadFile(app, "a.bin", "x");
      expect(lastDownload().mimeType).toBe("application/octet-stream");
    });

    it("treats an empty-string mimeType argument as absent", async () => {
      app = await connectAndHandshake();
      downloadFile(app, "a.txt", new Blob(["x"], { type: "text/plain" }), "");
      expect(lastDownload().mimeType).toBe("text/plain");
    });

    it("uses the Blob's intrinsic type when mimeType is omitted", async () => {
      app = await connectAndHandshake();
      downloadFile(app, "a.json", new Blob(["{}"], { type: "application/json" }));
      expect(lastDownload().mimeType).toBe("application/json");
    });

    it("falls back to octet-stream when neither is present", async () => {
      app = await connectAndHandshake();
      downloadFile(app, "a.bin", new Blob(["x"]));
      expect(lastDownload().mimeType).toBe("application/octet-stream");
    });

    it("an explicit mimeType overrides the Blob's intrinsic type", async () => {
      app = await connectAndHandshake();
      downloadFile(app, "a.csv", new Blob(["x"], { type: "text/plain" }), "text/csv");
      expect(lastDownload().mimeType).toBe("text/csv");
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
      rejectLastRequest(-32601, "method not found");
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

      dispatchNotification("ui/notifications/host-context-changed", {
        theme: "light",
        styles: { variables: { "--bg": "#fff" } },
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
            styles: { variables: { "--nb-color-primary": "#315EDB" } },
            toolInfo: { tool: { name: "search" } },
            containerDimensions: { width: 400 },
            workspace: { id: "ws_1" },
          },
        }),
      );

      dispatchNotification("ui/notifications/host-context-changed", { theme: "light" });

      expect(app.theme).toEqual({ mode: "light", tokens: { "--nb-color-primary": "#315EDB" } });
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
          hostContext: { theme: "dark", styles: { variables: { "--a": "1", "--b": "2" } } },
        }),
      );

      // `styles.variables` is a complete map when the host sends one, so the
      // merge is shallow: this drops `--b` rather than keeping it around
      // forever with no way for a host to remove a variable.
      dispatchNotification("ui/notifications/host-context-changed", {
        styles: { variables: { "--a": "9" } },
      });

      expect(app.theme.tokens).toEqual({ "--a": "9" });
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

      dispatchNotification("ui/notifications/host-context-changed", { theme: "light" });

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
      dispatchNotification("ui/notifications/host-context-changed", { theme: "light" });
      expect(cb).not.toHaveBeenCalled();
    });

    it("destroy() clears host-context subscribers", async () => {
      app = await connectAndHandshake();
      const cb = vi.fn();
      app.on("host-context-changed", cb);
      app.destroy();
      dispatchNotification("ui/notifications/host-context-changed", { theme: "light" });
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

      dispatchNotification("ui/notifications/host-context-changed", {
        theme: "light",
        styles: { variables: {} },
      });

      expect(seen).toEqual([{ mode: "light", tokens: {} }]);
    });

    it("theme-changed does NOT fire when only non-theme fields change", async () => {
      app = await connectAndHandshake();
      const cb = vi.fn();
      app.on("theme-changed", cb);

      dispatchNotification("ui/notifications/host-context-changed", {
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

      dispatchNotification("ui/notifications/host-context-changed", {
        theme: "dark",
        styles: { variables: { "--bg": "#000" } },
      });

      expect(cb).toHaveBeenCalledTimes(1);
    });
  });

  describe("tasks capability", () => {
    it("ui/initialize advertises appCapabilities.tasks with cancel and requests.tools.call", () => {
      connect({ name: "test-app", version: "1.0.0" }).catch(() => {});

      const initCall = postMessageSpy.mock.calls.find(
        (c: unknown[]) => (c[0] as Record<string, unknown>)?.method === "ui/initialize",
      );
      const params = (initCall?.[0] as Record<string, unknown>).params as Record<string, unknown>;
      expect(params.appCapabilities).toEqual({
        tasks: { cancel: {}, requests: { tools: { call: {} } } },
      });
    });

    it("supportsTasks is true when the host advertised tasks.requests.tools.call", async () => {
      const tasks: TasksCapability = { cancel: {}, requests: { tools: { call: {} } } };
      app = await connectAndHandshake(
        {},
        makeInitResult("nimblebrain", { hostCapabilities: { tasks } }),
      );
      expect(app.supportsTasks).toBe(true);
    });

    it("supportsTasks is false when the host advertised none", async () => {
      app = await connectAndHandshake();
      expect(app.supportsTasks).toBe(false);
    });

    it("supportsTasks is false when the host advertised tasks but not tools/call", async () => {
      app = await connectAndHandshake(
        {},
        makeInitResult("nimblebrain", { hostCapabilities: { tasks: { cancel: {} } } }),
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
      expect(sentNotifications("synapse/keydown")).toHaveLength(0);
    });

    it("forwards the default set when enabled on a NimbleBrain host", async () => {
      app = await connectAndHandshake({ forwardKeys: true });
      pressEscape();
      expect(sentNotifications("synapse/keydown")).toHaveLength(1);
    });

    it("forwards exactly the listed combos when given an array", async () => {
      app = await connectAndHandshake({ forwardKeys: [{ key: "k", meta: true }] });

      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }),
      );
      expect(sentNotifications("synapse/keydown")).toHaveLength(1);

      // Escape is in the default set but not in this one.
      pressEscape();
      expect(sentNotifications("synapse/keydown")).toHaveLength(1);
    });

    it("stays off on a host that does not implement synapse/keydown", async () => {
      app = await connectAndHandshake({ forwardKeys: true }, makeInitResult("claude"));
      pressEscape();
      expect(sentNotifications("synapse/keydown")).toHaveLength(0);
    });

    it("destroy() removes the listener", async () => {
      app = await connectAndHandshake({ forwardKeys: true });
      app.destroy();
      pressEscape();
      expect(sentNotifications("synapse/keydown")).toHaveLength(0);
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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SynapseTransport } from "../transport.js";

function dispatchResponse(id: string, result: unknown) {
  window.dispatchEvent(
    new MessageEvent("message", {
      data: { jsonrpc: "2.0", id, result },
    }),
  );
}

function dispatchError(id: string, code: number, message: string) {
  window.dispatchEvent(
    new MessageEvent("message", {
      data: { jsonrpc: "2.0", id, error: { code, message } },
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

describe("SynapseTransport", () => {
  let transport: SynapseTransport;
  let postMessageSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    postMessageSpy = vi.fn();
    window.parent.postMessage = postMessageSpy;
    transport = new SynapseTransport();
  });

  afterEach(() => {
    transport.destroy();
  });

  describe("request()", () => {
    it("sends JSON-RPC with correct id and resolves on response", async () => {
      const promise = transport.request("tools/call", { name: "echo" });

      expect(postMessageSpy).toHaveBeenCalledWith(
        {
          jsonrpc: "2.0",
          method: "tools/call",
          params: { name: "echo" },
          id: "syn-1",
        },
        "*",
      );

      dispatchResponse("syn-1", { data: "hello" });

      await expect(promise).resolves.toEqual({ data: "hello" });
    });

    it("rejects with error when JSON-RPC error response arrives", async () => {
      const promise = transport.request("tools/call", { name: "fail" });

      dispatchError("syn-1", -32000, "Tool not found");

      await expect(promise).rejects.toThrow("Tool not found");
      await promise.catch((err) => {
        expect(err.code).toBe(-32000);
      });
    });

    it("auto-increments request ids", async () => {
      const p1 = transport.request("a");
      const p2 = transport.request("b");

      expect(postMessageSpy).toHaveBeenCalledTimes(2);
      expect(postMessageSpy.mock.calls[0][0].id).toBe("syn-1");
      expect(postMessageSpy.mock.calls[1][0].id).toBe("syn-2");

      // Resolve to avoid unhandled rejections on destroy
      dispatchResponse("syn-1", null);
      dispatchResponse("syn-2", null);
      await p1;
      await p2;
    });
  });

  describe("send()", () => {
    it("fires notification without id and does not create pending entry", () => {
      transport.send("state/update", { key: "val" });

      expect(postMessageSpy).toHaveBeenCalledWith(
        {
          jsonrpc: "2.0",
          method: "state/update",
          params: { key: "val" },
        },
        "*",
      );

      // No id property on the message
      const msg = postMessageSpy.mock.calls[0][0];
      expect(msg).not.toHaveProperty("id");
    });
  });

  describe("onMessage()", () => {
    it("handler fires for matching method", () => {
      const handler = vi.fn();
      transport.onMessage("theme/changed", handler);

      dispatchNotification("theme/changed", { mode: "dark" });

      expect(handler).toHaveBeenCalledWith({ mode: "dark" });
    });

    it("ignores non-matching methods", () => {
      const handler = vi.fn();
      transport.onMessage("theme/changed", handler);

      dispatchNotification("data/changed", { source: "agent" });

      expect(handler).not.toHaveBeenCalled();
    });

    it("returns unsubscribe function that stops the handler", () => {
      const handler = vi.fn();
      const unsub = transport.onMessage("theme/changed", handler);

      dispatchNotification("theme/changed", { mode: "dark" });
      expect(handler).toHaveBeenCalledTimes(1);

      unsub();

      dispatchNotification("theme/changed", { mode: "light" });
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe("destroy()", () => {
    it("rejects all pending requests with 'Transport destroyed' error", async () => {
      const p1 = transport.request("a");
      const p2 = transport.request("b");

      transport.destroy();

      await expect(p1).rejects.toThrow("Transport destroyed");
      await expect(p2).rejects.toThrow("Transport destroyed");
    });

    it("prevents subsequent send() from posting", () => {
      transport.destroy();
      postMessageSpy.mockClear();

      transport.send("foo");
      expect(postMessageSpy).not.toHaveBeenCalled();
    });

    it("prevents subsequent request() from posting", async () => {
      transport.destroy();
      postMessageSpy.mockClear();

      await expect(transport.request("foo")).rejects.toThrow("Transport destroyed");
      expect(postMessageSpy).not.toHaveBeenCalled();
    });

    it("stops dispatching to onMessage handlers after destroy", () => {
      const handler = vi.fn();
      transport.onMessage("theme/changed", handler);

      transport.destroy();

      dispatchNotification("theme/changed", { mode: "dark" });
      expect(handler).not.toHaveBeenCalled();
    });

    it("double destroy is safe (idempotent)", () => {
      transport.destroy();
      expect(() => transport.destroy()).not.toThrow();
    });
  });
});

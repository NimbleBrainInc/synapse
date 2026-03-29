import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KeyboardForwarder } from "../keyboard.js";
import type { SynapseTransport } from "../transport.js";

function createMockTransport(): SynapseTransport {
  return {
    send: vi.fn(),
    request: vi.fn(),
    onMessage: vi.fn(),
    destroy: vi.fn(),
  } as unknown as SynapseTransport;
}

function fireKeydown(
  key: string,
  modifiers: Partial<Pick<KeyboardEvent, "ctrlKey" | "metaKey" | "shiftKey" | "altKey">> = {},
) {
  const event = new KeyboardEvent("keydown", {
    key,
    ctrlKey: modifiers.ctrlKey ?? false,
    metaKey: modifiers.metaKey ?? false,
    shiftKey: modifiers.shiftKey ?? false,
    altKey: modifiers.altKey ?? false,
    bubbles: true,
    cancelable: true,
  });
  document.dispatchEvent(event);
  return event;
}

describe("KeyboardForwarder", () => {
  let transport: SynapseTransport;
  let forwarder: KeyboardForwarder;

  beforeEach(() => {
    transport = createMockTransport();
  });

  afterEach(() => {
    forwarder?.destroy();
  });

  it("forwards Ctrl+K keydown with correct params", () => {
    forwarder = new KeyboardForwarder(transport);
    fireKeydown("k", { ctrlKey: true });

    expect(transport.send).toHaveBeenCalledWith("ui/keydown", {
      key: "k",
      ctrlKey: true,
      metaKey: false,
      shiftKey: false,
      altKey: false,
    });
  });

  it("forwards Cmd+K (metaKey)", () => {
    forwarder = new KeyboardForwarder(transport);
    fireKeydown("k", { metaKey: true });

    expect(transport.send).toHaveBeenCalledWith("ui/keydown", {
      key: "k",
      ctrlKey: false,
      metaKey: true,
      shiftKey: false,
      altKey: false,
    });
  });

  it("does NOT forward plain 'k' without modifier", () => {
    forwarder = new KeyboardForwarder(transport);
    fireKeydown("k");

    expect(transport.send).not.toHaveBeenCalled();
  });

  it("does NOT forward clipboard shortcuts (Cmd+C, Cmd+V, Cmd+X, Cmd+A)", () => {
    forwarder = new KeyboardForwarder(transport);

    fireKeydown("c", { metaKey: true });
    fireKeydown("v", { metaKey: true });
    fireKeydown("x", { metaKey: true });
    fireKeydown("a", { metaKey: true });
    fireKeydown("c", { ctrlKey: true });
    fireKeydown("v", { ctrlKey: true });
    fireKeydown("x", { ctrlKey: true });
    fireKeydown("a", { ctrlKey: true });

    expect(transport.send).not.toHaveBeenCalled();
  });

  it("forwards Escape by default", () => {
    forwarder = new KeyboardForwarder(transport);
    fireKeydown("Escape");

    expect(transport.send).toHaveBeenCalledWith(
      "ui/keydown",
      expect.objectContaining({
        key: "Escape",
      }),
    );
  });

  it("custom config [{ key: 'k', ctrl: true }] only forwards Ctrl+K", () => {
    forwarder = new KeyboardForwarder(transport, [{ key: "k", ctrl: true }]);

    // Ctrl+K should be forwarded
    fireKeydown("k", { ctrlKey: true });
    expect(transport.send).toHaveBeenCalledTimes(1);

    // Cmd+K should NOT be forwarded (custom config, ctrl not matched)
    fireKeydown("k", { metaKey: true });
    expect(transport.send).toHaveBeenCalledTimes(1);

    // Escape should NOT be forwarded (not in custom config)
    fireKeydown("Escape");
    expect(transport.send).toHaveBeenCalledTimes(1);
  });

  it("empty config [] forwards nothing", () => {
    forwarder = new KeyboardForwarder(transport, []);

    fireKeydown("k", { ctrlKey: true });
    fireKeydown("Escape");
    fireKeydown("k", { metaKey: true });

    expect(transport.send).not.toHaveBeenCalled();
  });

  it("destroy() removes the event listener", () => {
    forwarder = new KeyboardForwarder(transport);
    forwarder.destroy();

    fireKeydown("k", { ctrlKey: true });

    expect(transport.send).not.toHaveBeenCalled();
  });

  it("destroy() is idempotent", () => {
    const removeSpy = vi.spyOn(document, "removeEventListener");
    forwarder = new KeyboardForwarder(transport);

    forwarder.destroy();
    forwarder.destroy();

    // removeEventListener should only be called once
    const keydownCalls = removeSpy.mock.calls.filter(([type]) => type === "keydown");
    expect(keydownCalls).toHaveLength(1);

    removeSpy.mockRestore();
  });
});

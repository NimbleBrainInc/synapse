import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KeyboardForwarder } from "../keyboard.js";

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
  let send: ReturnType<typeof vi.fn>;
  let forwarder: KeyboardForwarder;

  beforeEach(() => {
    send = vi.fn();
  });

  afterEach(() => {
    forwarder?.destroy();
  });

  it("forwards Ctrl+K keydown with correct params", () => {
    forwarder = new KeyboardForwarder(send);
    fireKeydown("k", { ctrlKey: true });

    expect(send).toHaveBeenCalledWith("ai.nimblebrain/keydown", {
      key: "k",
      ctrlKey: true,
      metaKey: false,
      shiftKey: false,
      altKey: false,
    });
  });

  it("forwards Cmd+K (metaKey)", () => {
    forwarder = new KeyboardForwarder(send);
    fireKeydown("k", { metaKey: true });

    expect(send).toHaveBeenCalledWith("ai.nimblebrain/keydown", {
      key: "k",
      ctrlKey: false,
      metaKey: true,
      shiftKey: false,
      altKey: false,
    });
  });

  it("does NOT forward plain 'k' without modifier", () => {
    forwarder = new KeyboardForwarder(send);
    fireKeydown("k");

    expect(send).not.toHaveBeenCalled();
  });

  it("does NOT forward clipboard shortcuts (Cmd+C, Cmd+V, Cmd+X, Cmd+A)", () => {
    forwarder = new KeyboardForwarder(send);

    fireKeydown("c", { metaKey: true });
    fireKeydown("v", { metaKey: true });
    fireKeydown("x", { metaKey: true });
    fireKeydown("a", { metaKey: true });
    fireKeydown("c", { ctrlKey: true });
    fireKeydown("v", { ctrlKey: true });
    fireKeydown("x", { ctrlKey: true });
    fireKeydown("a", { ctrlKey: true });

    expect(send).not.toHaveBeenCalled();
  });

  it("forwards Escape by default", () => {
    forwarder = new KeyboardForwarder(send);
    fireKeydown("Escape");

    expect(send).toHaveBeenCalledWith(
      "ai.nimblebrain/keydown",
      expect.objectContaining({
        key: "Escape",
      }),
    );
  });

  it("custom config [{ key: 'k', ctrl: true }] only forwards Ctrl+K", () => {
    forwarder = new KeyboardForwarder(send, [{ key: "k", ctrl: true }]);

    // Ctrl+K should be forwarded
    fireKeydown("k", { ctrlKey: true });
    expect(send).toHaveBeenCalledTimes(1);

    // Cmd+K should NOT be forwarded (custom config, ctrl not matched)
    fireKeydown("k", { metaKey: true });
    expect(send).toHaveBeenCalledTimes(1);

    // Escape should NOT be forwarded (not in custom config)
    fireKeydown("Escape");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("empty config [] forwards nothing", () => {
    forwarder = new KeyboardForwarder(send, []);

    fireKeydown("k", { ctrlKey: true });
    fireKeydown("Escape");
    fireKeydown("k", { metaKey: true });

    expect(send).not.toHaveBeenCalled();
  });

  it("destroy() removes the event listener", () => {
    forwarder = new KeyboardForwarder(send);
    forwarder.destroy();

    fireKeydown("k", { ctrlKey: true });

    expect(send).not.toHaveBeenCalled();
  });

  it("destroy() is idempotent", () => {
    const removeSpy = vi.spyOn(document, "removeEventListener");
    forwarder = new KeyboardForwarder(send);

    forwarder.destroy();
    forwarder.destroy();

    // removeEventListener should only be called once
    const keydownCalls = removeSpy.mock.calls.filter(([type]) => type === "keydown");
    expect(keydownCalls).toHaveLength(1);

    removeSpy.mockRestore();
  });
});

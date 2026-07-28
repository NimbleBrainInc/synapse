import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createResizer } from "../resize.js";

// --- Mock ResizeObserver ---

let resizeObserverCallback: (() => void) | null = null;
const mockObserve = vi.fn();
const mockDisconnect = vi.fn();

class MockResizeObserver {
  constructor(callback: () => void) {
    resizeObserverCallback = callback;
  }
  observe = mockObserve;
  disconnect = mockDisconnect;
  unobserve = vi.fn();
}

// --- Mock requestAnimationFrame ---

let rafCallbacks: Array<{ id: number; cb: FrameRequestCallback }> = [];
let nextRafId = 1;

function mockRAF(cb: FrameRequestCallback): number {
  const id = nextRafId++;
  rafCallbacks.push({ id, cb });
  return id;
}

function mockCancelRAF(id: number): void {
  rafCallbacks = rafCallbacks.filter((r) => r.id !== id);
}

function flushRAF(): void {
  const pending = [...rafCallbacks];
  rafCallbacks = [];
  for (const { cb } of pending) {
    cb(performance.now());
  }
}

// --- Helpers ---

function mockBodyDimensions(width: number, height: number) {
  Object.defineProperty(document.body, "scrollWidth", {
    value: width,
    configurable: true,
  });
  Object.defineProperty(document.body, "scrollHeight", {
    value: height,
    configurable: true,
  });
}

describe("createResizer", () => {
  let send: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    send = vi.fn();
    resizeObserverCallback = null;
    rafCallbacks = [];
    nextRafId = 1;
    mockObserve.mockClear();
    mockDisconnect.mockClear();

    vi.stubGlobal("ResizeObserver", MockResizeObserver);
    vi.stubGlobal("requestAnimationFrame", mockRAF);
    vi.stubGlobal("cancelAnimationFrame", mockCancelRAF);

    mockBodyDimensions(800, 600);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resize() with no args sends measured body dimensions", () => {
    const resizer = createResizer(send, false);
    resizer.resize();

    expect(send).toHaveBeenCalledWith("ui/notifications/size-changed", {
      width: 800,
      height: 600,
    });

    resizer.destroy();
  });

  it("resize(100, 200) sends exact dimensions", () => {
    const resizer = createResizer(send, false);
    resizer.resize(100, 200);

    expect(send).toHaveBeenCalledWith("ui/notifications/size-changed", {
      width: 100,
      height: 200,
    });

    resizer.destroy();
  });

  it("measureAndSend() sends current body dimensions", () => {
    const resizer = createResizer(send, false);
    resizer.measureAndSend();

    expect(send).toHaveBeenCalledWith("ui/notifications/size-changed", {
      width: 800,
      height: 600,
    });

    // Change dimensions and measure again
    mockBodyDimensions(1024, 768);
    resizer.measureAndSend();

    expect(send).toHaveBeenCalledWith("ui/notifications/size-changed", {
      width: 1024,
      height: 768,
    });

    resizer.destroy();
  });

  it("auto mode attaches ResizeObserver on document.body", () => {
    const resizer = createResizer(send, true);

    expect(mockObserve).toHaveBeenCalledWith(document.body);
    expect(resizeObserverCallback).not.toBeNull();

    resizer.destroy();
  });

  it("auto mode does NOT attach ResizeObserver when autoResize is false", () => {
    const resizer = createResizer(send, false);

    expect(mockObserve).not.toHaveBeenCalled();

    resizer.destroy();
  });

  it("auto mode debounces rapid resize events via requestAnimationFrame", () => {
    const resizer = createResizer(send, true);

    // Trigger observer callback multiple times rapidly
    resizeObserverCallback?.();
    resizeObserverCallback?.();
    resizeObserverCallback?.();

    // No send yet — waiting for rAF
    expect(send).not.toHaveBeenCalled();

    // Only one rAF callback should be pending (previous ones cancelled)
    expect(rafCallbacks).toHaveLength(1);

    // Flush rAF
    flushRAF();

    // Only one send call
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("ui/notifications/size-changed", {
      width: 800,
      height: 600,
    });

    resizer.destroy();
  });

  it("destroy() disconnects observer and prevents further sends", () => {
    const resizer = createResizer(send, true);

    // Trigger a pending rAF
    resizeObserverCallback?.();
    expect(rafCallbacks).toHaveLength(1);

    resizer.destroy();

    expect(mockDisconnect).toHaveBeenCalled();

    // Flush rAF — should not send because destroyed
    flushRAF();
    expect(send).not.toHaveBeenCalled();
  });

  it("resize() after destroy() is a no-op", () => {
    const resizer = createResizer(send, false);
    resizer.destroy();

    resizer.resize();
    resizer.resize(100, 200);
    resizer.measureAndSend();

    expect(send).not.toHaveBeenCalled();
  });

  it("destroy() is idempotent", () => {
    const resizer = createResizer(send, true);

    resizer.destroy();
    resizer.destroy();

    // disconnect called only once
    expect(mockDisconnect).toHaveBeenCalledTimes(1);
  });
});

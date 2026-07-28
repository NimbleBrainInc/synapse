type SendFn = (method: string, params: Record<string, unknown>) => void;

interface Resizer {
  resize(width?: number, height?: number): void;
  measureAndSend(): void;
  destroy(): void;
}

export function createResizer(send: SendFn, autoResize: boolean): Resizer {
  let destroyed = false;
  let observer: ResizeObserver | null = null;
  let rafId: number | null = null;

  function measureAndSend(): void {
    if (destroyed) return;
    // A document with no `body` has nothing to measure, and a size nobody can
    // observe is not worth a throw: `connect()` calls this at step 2, before
    // `ui/initialize` is sent, and `connect` is async — so the failure arrives as
    // an unhandled rejection with the session already dead.
    const body = typeof document !== "undefined" ? document.body : undefined;
    if (!body) return;
    send("ui/notifications/size-changed", {
      width: body.scrollWidth,
      height: body.scrollHeight,
    });
  }

  function resize(width?: number, height?: number): void {
    if (destroyed) return;
    if (width !== undefined && height !== undefined) {
      send("ui/notifications/size-changed", { width, height });
    } else {
      measureAndSend();
    }
  }

  // Auto mode: attach ResizeObserver, debounced at 16ms via requestAnimationFrame
  if (autoResize && typeof ResizeObserver !== "undefined") {
    observer = new ResizeObserver(() => {
      if (destroyed) return;
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        rafId = null;
        measureAndSend();
      });
    });
    observer.observe(document.body);
  }

  function destroy(): void {
    if (destroyed) return;
    destroyed = true;
    if (rafId !== null) cancelAnimationFrame(rafId);
    observer?.disconnect();
    observer = null;
  }

  return { resize, measureAndSend, destroy };
}

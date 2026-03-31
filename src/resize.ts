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
    const width = document.body.scrollWidth;
    const height = document.body.scrollHeight;
    send("ui/notifications/size-changed", { width, height });
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

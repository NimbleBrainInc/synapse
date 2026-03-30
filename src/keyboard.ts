import type { SynapseTransport } from "./transport.js";
import type { KeyForwardConfig } from "./types.js";

/**
 * Forward keyboard shortcuts from the iframe document to the host.
 *
 * By default, forwards all Ctrl/Cmd+key combos and Escape.
 * Apps can customize via `forwardKeys` config.
 */
export class KeyboardForwarder {
  private listener: (event: KeyboardEvent) => void;
  private destroyed = false;

  constructor(transport: SynapseTransport, customKeys?: KeyForwardConfig[]) {
    const config = customKeys ?? null; // null = default behavior

    this.listener = (event: KeyboardEvent) => {
      if (this.destroyed) return;
      if (this.shouldForward(event, config)) {
        event.preventDefault();
        transport.send("synapse/keydown", {
          key: event.key,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          shiftKey: event.shiftKey,
          altKey: event.altKey,
        });
      }
    };

    document.addEventListener("keydown", this.listener);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    document.removeEventListener("keydown", this.listener);
  }

  private shouldForward(event: KeyboardEvent, config: KeyForwardConfig[] | null): boolean {
    // Empty array = forwarding disabled
    if (config && config.length === 0) return false;

    // Custom config: match exactly
    if (config) {
      return config.some(
        (k) =>
          event.key.toLowerCase() === k.key.toLowerCase() &&
          (k.ctrl === undefined || event.ctrlKey === k.ctrl) &&
          (k.meta === undefined || event.metaKey === k.meta) &&
          (k.shift === undefined || event.shiftKey === k.shift) &&
          (k.alt === undefined || event.altKey === k.alt),
      );
    }

    // Default: forward all Ctrl/Cmd combos + Escape,
    // EXCEPT clipboard shortcuts (c, v, x, a) which the browser must handle natively.
    if (event.key === "Escape") return true;
    if (event.ctrlKey || event.metaKey) {
      const key = event.key.toLowerCase();
      if (key === "c" || key === "v" || key === "x" || key === "a") return false;
      return true;
    }
    return false;
  }
}

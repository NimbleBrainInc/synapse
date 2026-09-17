import { createInlineAdapter } from "./adapters/inline.js";
import { createMcpAppsAdapter } from "./adapters/mcpapps.js";
import type { ConnectUIOptions, HostAdapter, HostKind } from "./types.js";

/**
 * Minimal window shape the detector inspects. Kept structural so detection is
 * unit-testable with a plain object — no full `Window` fake required.
 */
interface DetectableWindow {
  parent?: unknown;
}

/**
 * Detect the bridge from the browsing context.
 *
 *  - a nested browsing context (`parent !== self`, or a cross-origin access that
 *    throws) → **mcp-apps**: every host that frames a component speaks the MCP
 *    Apps standard.
 *  - top-level document → **generic** (inline / standalone).
 *
 * Nothing on the window names the host. `window.openai` in particular does not:
 * ChatGPT injects it into every frame it serves, whatever the component is.
 * Which host answered is in the handshake, not here.
 */
export function detectHostKind(win: DetectableWindow): HostKind {
  try {
    if (win.parent != null && win.parent !== win) return "mcp-apps";
  } catch {
    // Cross-origin parent access throws → we are framed by another origin.
    return "mcp-apps";
  }
  return "generic";
}

/** Build the adapter for an explicit host kind (`options.host` or a detected one). */
export function adapterForKind(
  kind: HostKind,
  win: Window & typeof globalThis,
  options: ConnectUIOptions,
): HostAdapter {
  return kind === "mcp-apps"
    ? createMcpAppsAdapter(win, options)
    : createInlineAdapter(win, options);
}

/** Select and construct the host adapter, honoring `options.host` when set. */
export function selectAdapter(
  win: Window & typeof globalThis,
  options: ConnectUIOptions,
): HostAdapter {
  const kind = options.host ?? detectHostKind(win as unknown as DetectableWindow);
  return adapterForKind(kind, win, options);
}

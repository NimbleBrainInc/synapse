import { createChatGPTAdapter } from "./adapters/chatgpt.js";
import { createInlineAdapter } from "./adapters/inline.js";
import { createMcpAppsAdapter } from "./adapters/mcpapps.js";
import type { ConnectUIOptions, HostAdapter, HostKind } from "./types.js";

/**
 * Minimal window shape the detector inspects. Kept structural so detection is
 * unit-testable with a plain object — no full `Window` fake required.
 */
interface DetectableWindow {
  openai?: unknown;
  parent?: unknown;
  self?: unknown;
}

/**
 * Feature-detect the host from the browsing context.
 *
 *  - `window.openai` present → **chatgpt** (OpenAI Apps SDK).
 *  - otherwise, a nested browsing context (`parent !== self`, or a cross-origin
 *    access that throws) → **claude** (MCP Apps standard postMessage host).
 *  - top-level document → **generic** (inline / standalone).
 *
 * Returns the host *kind*; `chooseAdapter` maps it to a concrete adapter and
 * honors an explicit `options.host` override for previews/SSR/tests.
 */
export function detectHostKind(win: DetectableWindow): HostKind {
  if (win.openai != null) return "chatgpt";
  try {
    if (win.parent != null && win.parent !== win) return "claude";
  } catch {
    // Cross-origin parent access throws → we are framed by another origin.
    return "claude";
  }
  return "generic";
}

/** Build the adapter for an explicit host kind (`options.host` or a detected one). */
export function adapterForKind(
  kind: HostKind,
  win: Window & typeof globalThis,
  options: ConnectUIOptions,
): HostAdapter {
  switch (kind) {
    case "chatgpt":
      return createChatGPTAdapter(win, options);
    case "claude":
    case "nimblebrain":
      // Both speak the MCP Apps standard (SEP-1865). `nimblebrain` shares it for
      // now; a dedicated adapter over the `synapse/*` extension lands in P3.
      return createMcpAppsAdapter(win, options);
    default:
      return createInlineAdapter(win, options);
  }
}

/** Select and construct the host adapter, honoring `options.host` when set. */
export function selectAdapter(
  win: Window & typeof globalThis,
  options: ConnectUIOptions,
): HostAdapter {
  const kind = options.host ?? detectHostKind(win as unknown as DetectableWindow);
  return adapterForKind(kind, win, options);
}

/**
 * Cross-host UI client — types and wire constants.
 *
 * The cross-host client (`connectUI`) renders one Synapse-authored component in
 * any MCP Apps host (ChatGPT, Claude, NimbleBrain) and standalone. Apps code
 * against `synapse.*` and never touch the bridge. This is a **push-first** surface: the tool output that spawned
 * the widget is delivered at render (`data()` / `onData()`); `callTool()` is the
 * pull escape hatch, advertised per host via `capabilities()`.
 *
 * This layer intentionally has ZERO dependency on `@modelcontextprotocol/*` — the
 * bridge is JSON-RPC over `postMessage`, spoken by hand, so the IIFE that apps
 * inline stays tiny (no Zod, no ext-apps schemas).
 */

import type { FontFaceDescriptor } from "../types.js";

/**
 * The bridge the client resolved to, as reported by `synapse.host()`:
 * `"mcp-apps"` in a frame, `"generic"` standalone. It names the bridge, not the
 * product — every framing host speaks the same one. Apps should rarely branch on
 * it; `capabilities()` is the supported way to feature-detect.
 */
export type HostKind = "mcp-apps" | "generic";

/** Resolved theme. `mode` always resolves to light or dark. `tokens` are CSS
 *  custom properties the host publishes — the MCP Apps adapter reads them from
 *  `hostContext.styles.variables`; where a host sends none they stay empty and the
 *  SDK's neutral defaults back them. */
export interface SynapseUITheme {
  mode: "light" | "dark";
  tokens: Record<string, string>;
  /** Font faces the host wants loaded. Absent where the host sends none, which
   *  leaves the SDK's web-safe fallbacks in force. See `FontFaceDescriptor`. */
  fontFaces?: FontFaceDescriptor[];
}

/** What the active host actually supports. `data()`/`onData()`/`theme()`/
 *  `resize()` work everywhere; these three vary. */
export interface HostCapabilities {
  /** `callTool()` can reach the server (widget→server fetch). */
  pull: boolean;
  /** `sendPrompt()` reaches the agent conversation. */
  sendPrompt: boolean;
  /** `openLink()` opens an external URL through the host. */
  openLink: boolean;
}

/** Thrown by `callTool()` when the active host offers no widget→server call. */
export class HostUnsupportedError extends Error {
  constructor(feature: string, host: HostKind) {
    super(`"${feature}" is not supported by the "${host}" host`);
    this.name = "HostUnsupportedError";
  }
}

/**
 * Thrown by `callTool()` when the tool result says the call failed
 * (`isError: true`). MCP reports a tool failure inside the result rather than as
 * a JSON-RPC error, and a host reports a refusal the same way — ChatGPT answers a
 * call to a tool the app may not see with an `isError` result — so without this a
 * failure would resolve as if it were data. The message is the result's first
 * text block; the whole result is on `result`.
 */
export class ToolCallError extends Error {
  readonly result: unknown;
  constructor(name: string, result: unknown) {
    super(toolErrorText(result) ?? `tool "${name}" returned an error`);
    this.name = "ToolCallError";
    this.result = result;
  }
}

function toolErrorText(result: unknown): string | undefined {
  const content = (result as { content?: unknown } | null)?.content;
  if (!Array.isArray(content)) return undefined;
  for (const block of content) {
    const b = block as { type?: unknown; text?: unknown } | null;
    if (b?.type === "text" && typeof b.text === "string" && b.text !== "") return b.text;
  }
  return undefined;
}

/** True when a tool result reports failure, as MCP defines it. */
export function isToolError(result: unknown): boolean {
  return (
    result != null &&
    typeof result === "object" &&
    (result as { isError?: unknown }).isError === true
  );
}

export interface ConnectUIOptions {
  /** App name — informational; forwarded to hosts that accept an appInfo. */
  name?: string;
  /** App semver — informational. */
  version?: string;
  /**
   * Force a host adapter instead of auto-detecting. Used by preview harnesses,
   * SSR, and tests; production apps omit it and let the SDK feature-detect.
   * `"mcp-apps"` → MCP Apps standard adapter, `"generic"` → inline adapter.
   */
  host?: HostKind;
  /**
   * `id` of the `<script type="application/json">` element carrying pushed data
   * baked into the HTML (the SSR / standalone path). Defaults to
   * {@link SYNAPSE_DATA_ELEMENT_ID}.
   */
  dataElementId?: string;
  /**
   * Auto-report content height to the host on layout changes (MCP Apps only).
   * Defaults to `true`. Set `false` to size manually via `resize()`.
   */
  autoResize?: boolean;
  /** Window to bind to. Defaults to the global `window`. Injectable for tests. */
  window?: Window & typeof globalThis;
}

/**
 * The public cross-host client. Bound to `synapse` by convention.
 *
 * ```ts
 * const synapse = connectUI();
 * synapse.onData(render);          // future pushes/updates
 * render(synapse.data());          // current value (may be null → empty state)
 * ```
 */
export interface SynapseUIClient {
  /** The current pushed data, or `null` before anything has been delivered. */
  data<T = unknown>(): T | null;
  /** Subscribe to data updates (NOT replayed — read `data()` for the current
   *  value). Returns an unsubscribe. */
  onData<T = unknown>(cb: (data: T) => void): () => void;

  /** The current resolved theme. */
  theme(): SynapseUITheme;
  /** Subscribe to theme changes. The client already applies the theme to the DOM
   *  (`data-theme` attribute + CSS variables) before this fires. */
  onTheme(cb: (theme: SynapseUITheme) => void): () => void;

  /** Widget→server tool call. Resolves with the tool result. Rejects with
   *  {@link ToolCallError} when the result reports failure (`isError: true`), and
   *  with {@link HostUnsupportedError} where the host advertises no pull
   *  (`capabilities().pull === false`). */
  callTool<O = unknown>(name: string, args?: Record<string, unknown>): Promise<O>;
  /** Send a follow-up message to the agent conversation. No-op where unsupported. */
  sendPrompt(text: string): void;
  /** Open an external URL through the host (falls back to `window.open`). */
  openLink(url: string): void;
  /** Report content height to the host. Omit `height` to measure `document.body`. */
  resize(height?: number): void;

  /** What the active host supports. */
  capabilities(): HostCapabilities;
  /** The resolved host — an escape hatch; prefer `capabilities()`. */
  host(): HostKind;
  /** Tear down listeners/observers. */
  destroy(): void;
}

/**
 * Internal adapter contract. One per host bridge; the client is a thin façade
 * over the selected adapter.
 */
export interface HostAdapter {
  readonly host: HostKind;
  getData<T = unknown>(): T | null;
  onData<T = unknown>(cb: (data: T) => void): () => void;
  getTheme(): SynapseUITheme;
  onTheme(cb: (theme: SynapseUITheme) => void): () => void;
  callTool<O = unknown>(name: string, args?: Record<string, unknown>): Promise<O>;
  sendPrompt(text: string): void;
  openLink(url: string): void;
  resize(height?: number): void;
  capabilities(): HostCapabilities;
  /** Begin listening / send the ready handshake / read baked-in data. Called once
   *  by `connectUI` synchronously so `getData()` is populated on return. */
  start(): void;
  destroy(): void;
}

// ---------------------------------------------------------------------------
// Wire constants — the bridge message shapes. Centralized so a
// host protocol tweak is a one-line change, not a grep-and-pray.
// ---------------------------------------------------------------------------

/** Default `id` of the baked-in data `<script type="application/json">`. */
export const SYNAPSE_DATA_ELEMENT_ID = "synapse-ui-data";

// ---------------------------------------------------------------------------
// MCP Apps standard (SEP-1865) — the bridge every framing host speaks. The View iframe is an MCP client and the
// host an MCP server; they exchange raw JSON-RPC 2.0 objects over `postMessage`
// (no wrapper envelope). Method names are canonical to the ext-apps spec.
// ---------------------------------------------------------------------------

/** Protocol version exchanged in the `ui/initialize` handshake. */
export const MCPAPP_PROTOCOL_VERSION = "2026-01-26";
/** View → host handshake request; the result carries the host context. */
export const MCPAPP_INITIALIZE = "ui/initialize";
/** View → host notification sent once after the init result — the host holds all
 *  pushes until it arrives. */
export const MCPAPP_INITIALIZED = "ui/notifications/initialized";
/** Host → view notification carrying the tool output. `params` IS the
 *  `CallToolResult` (data at `params.structuredContent`) — no `result` wrapper. */
export const MCPAPP_TOOL_RESULT = "ui/notifications/tool-result";
/** Host → view notification carrying a partial host context (theme, styles, …). */
export const MCPAPP_HOST_CONTEXT_CHANGED = "ui/notifications/host-context-changed";
/** View → host notification reporting intrinsic size (`{ width?, height? }`). A
 *  host may keep the frame hidden until it receives one, so it is sent promptly. */
export const MCPAPP_SIZE_CHANGED = "ui/notifications/size-changed";
/** View → host request: open an external URL (`{ url }`). */
export const MCPAPP_OPEN_LINK = "ui/open-link";
/** View → host request: send a follow-up to the conversation
 *  (`{ role: "user", content: ContentBlock[] }`). */
export const MCPAPP_MESSAGE = "ui/message";
/** Host → view request: graceful teardown; the view replies `{}`. */
export const MCPAPP_TEARDOWN = "ui/resource-teardown";
/** Standard MCP method the View may call over the same channel (pull). */
export const MCP_TOOLS_CALL = "tools/call";

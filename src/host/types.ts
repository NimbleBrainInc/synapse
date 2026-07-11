/**
 * Cross-host UI client — types and wire constants.
 *
 * The cross-host client (`connectUI`) renders one Synapse-authored component in
 * hosts that each speak a different bridge: ChatGPT (OpenAI Apps SDK), Claude
 * (mcp-ui), and plain/standalone. Apps code against `synapse.*` and never touch
 * a host protocol. This is a **push-first** surface: the tool output that spawned
 * the widget is delivered at render (`data()` / `onData()`); `callTool()` is the
 * pull escape hatch, advertised per host via `capabilities()`.
 *
 * This layer intentionally has ZERO dependency on `@modelcontextprotocol/*` — the
 * ChatGPT / mcp-ui / inline bridges are pure `window.openai` + `postMessage`, so
 * the IIFE that apps inline stays tiny (no Zod, no ext-apps schemas).
 */

/**
 * The host the client resolved to, as reported by `synapse.host()`. An escape
 * hatch — apps should rarely branch on it; `capabilities()` is the supported way
 * to feature-detect. `"nimblebrain"` is reserved for the runtime adapter (P3).
 */
export type HostKind = "chatgpt" | "claude" | "nimblebrain" | "generic";

/** Resolved theme. `tokens` are CSS custom properties a host could publish, but
 *  no P1 adapter extracts them yet — mcp-ui carries them in its render-data, but
 *  wiring that through is deferred — so `tokens` stays empty and the SDK's neutral
 *  defaults back it. `mode` always resolves to light or dark. */
export interface SynapseUITheme {
  mode: "light" | "dark";
  tokens: Record<string, string>;
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

export interface ConnectUIOptions {
  /** App name — informational; forwarded to hosts that accept an appInfo. */
  name?: string;
  /** App semver — informational. */
  version?: string;
  /**
   * Force a host adapter instead of auto-detecting. Used by preview harnesses,
   * SSR, and tests; production apps omit it and let the SDK feature-detect.
   * `"claude"` → mcp-ui adapter, `"chatgpt"` → OpenAI Apps adapter, `"generic"`
   * → inline adapter.
   */
  host?: HostKind;
  /**
   * `id` of the `<script type="application/json">` element carrying pushed data
   * baked into the HTML (the mcp-ui / SSR path). Defaults to
   * {@link SYNAPSE_DATA_ELEMENT_ID}.
   */
  dataElementId?: string;
  /**
   * Auto-report content height to the host on layout changes (mcp-ui only).
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

  /** Widget→server tool call. Rejects with {@link HostUnsupportedError} where the
   *  host advertises no pull (`capabilities().pull === false`). */
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
// Wire constants — the bridge message shapes each host speaks. Centralized so a
// host protocol tweak is a one-line change, not a grep-and-pray.
// ---------------------------------------------------------------------------

/** Default `id` of the baked-in data `<script type="application/json">`. */
export const SYNAPSE_DATA_ELEMENT_ID = "synapse-ui-data";

/** mcp-ui iframe-lifecycle messages (child → host, host → child). */
export const MCPUI_READY = "ui-lifecycle-iframe-ready";
export const MCPUI_RENDER_DATA = "ui-lifecycle-iframe-render-data";
export const MCPUI_SIZE_CHANGE = "ui-size-change";
/** mcp-ui action messages (child → host). */
export const MCPUI_LINK = "link";
export const MCPUI_PROMPT = "prompt";

/** OpenAI Apps SDK globals-broadcast event (host → child). */
export const OPENAI_SET_GLOBALS = "openai:set_globals";

/** ext-apps tool-result notification method — the generic push a NimbleBrain /
 *  MCP-Apps host emits. Accepted as a data-in source by the mcp-ui adapter so a
 *  generic host delivers data without a bespoke adapter (full nimblebrain
 *  adapter is P3). */
export const EXTAPPS_TOOL_RESULT = "ui/notifications/tool-result";

import { readInlineData, unwrapRenderData } from "../data.js";
import { coerceMode, preferredMode } from "../theme.js";
import {
  type ConnectUIOptions,
  EXTAPPS_TOOL_RESULT,
  type HostAdapter,
  type HostCapabilities,
  HostUnsupportedError,
  MCPUI_LINK,
  MCPUI_PROMPT,
  MCPUI_READY,
  MCPUI_RENDER_DATA,
  MCPUI_SIZE_CHANGE,
  SYNAPSE_DATA_ELEMENT_ID,
  type SynapseUITheme,
} from "../types.js";

/**
 * Claude / mcp-ui adapter.
 *
 * Data reaches the widget two ways, both handled here:
 *  - **baked in** — the embedded `ui://` resource carries the payload in a
 *    `<script type="application/json">`, read synchronously at `start()` so the
 *    first paint needs no round-trip; and
 *  - **pushed** — the host answers the `ui-lifecycle-iframe-ready` handshake with
 *    a `ui-lifecycle-iframe-render-data` message (theme included).
 *
 * A generic MCP-Apps host that emits `ui/notifications/tool-result` instead is
 * also accepted as a data source, so a non-mcp-ui postMessage host still renders
 * (the dedicated `nimblebrain` adapter with the `synapse/*` extension is P3).
 *
 * Actions go up to `window.parent` as mcp-ui messages: `link`, `prompt`,
 * `ui-size-change`. There is no widget→server call in the base protocol, so
 * `callTool` reports unsupported and rejects.
 */
export function createMcpUiAdapter(
  win: Window & typeof globalThis,
  options: ConnectUIOptions,
): HostAdapter {
  const dataElementId = options.dataElementId ?? SYNAPSE_DATA_ELEMENT_ID;
  const autoResize = options.autoResize !== false;

  let currentData: unknown = null;
  let currentTheme: SynapseUITheme = { mode: preferredMode(win), tokens: {} };

  const dataCbs = new Set<(d: unknown) => void>();
  const themeCbs = new Set<(t: SynapseUITheme) => void>();
  let destroyed = false;
  let lastReportedHeight = -1;
  let resizeObserver: ResizeObserver | null = null;

  const parent = () => win.parent ?? win;

  function emitData(next: unknown): void {
    if (next == null) return;
    currentData = next;
    for (const cb of dataCbs) cb(next);
  }

  function emitTheme(mode: unknown): void {
    const next = coerceMode(mode, currentTheme.mode);
    if (next === currentTheme.mode) return;
    currentTheme = { mode: next, tokens: currentTheme.tokens };
    for (const cb of themeCbs) cb(currentTheme);
  }

  const onMessage = (event: MessageEvent) => {
    if (destroyed) return;
    const d = event.data as Record<string, unknown> | null | undefined;
    if (!d || typeof d !== "object") return;

    // mcp-ui render-data handshake response.
    if (d.type === MCPUI_RENDER_DATA || d.type === "renderData") {
      const payload = (d.payload ?? {}) as Record<string, unknown>;
      if (payload.theme != null) emitTheme(payload.theme);
      emitData(unwrapRenderData(payload));
      return;
    }

    // Generic MCP-Apps push (ext-apps `ui/notifications/tool-result`).
    if (d.method === EXTAPPS_TOOL_RESULT) {
      const params = (d.params ?? {}) as Record<string, unknown>;
      const result = (params.result ?? params) as Record<string, unknown>;
      const payload = result.structuredContent ?? result.toolOutput;
      emitData(payload);
    }
  };

  function reportSize(height?: number): void {
    if (destroyed) return;
    const h = typeof height === "number" ? height : Math.ceil(win.document.body.scrollHeight);
    if (h === lastReportedHeight) return;
    lastReportedHeight = h;
    parent().postMessage({ type: MCPUI_SIZE_CHANGE, payload: { height: h } }, "*");
  }

  return {
    host: "claude",
    getData: <T>() => currentData as T | null,
    onData(cb) {
      dataCbs.add(cb as (d: unknown) => void);
      return () => dataCbs.delete(cb as (d: unknown) => void);
    },
    getTheme: () => currentTheme,
    onTheme(cb) {
      themeCbs.add(cb);
      return () => themeCbs.delete(cb);
    },
    async callTool<O>(_name: string): Promise<O> {
      throw new HostUnsupportedError("callTool", "claude");
    },
    sendPrompt(text: string) {
      parent().postMessage({ type: MCPUI_PROMPT, payload: { prompt: text } }, "*");
    },
    openLink(url: string) {
      parent().postMessage({ type: MCPUI_LINK, payload: { url } }, "*");
    },
    resize(height?: number) {
      reportSize(height);
    },
    capabilities(): HostCapabilities {
      return { pull: false, sendPrompt: true, openLink: true };
    },
    start() {
      win.addEventListener("message", onMessage as EventListener);

      // Baked-in data → available on first paint, before the handshake resolves.
      currentData = readInlineData(win.document, dataElementId);

      if (autoResize) {
        win.addEventListener("resize", () => reportSize());
        if (typeof win.ResizeObserver !== "undefined") {
          resizeObserver = new win.ResizeObserver(() => reportSize());
          resizeObserver.observe(win.document.body);
        }
      }

      // Tell the host we're mounted and want render data.
      parent().postMessage({ type: MCPUI_READY }, "*");
      reportSize();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      win.removeEventListener("message", onMessage as EventListener);
      resizeObserver?.disconnect();
      resizeObserver = null;
      dataCbs.clear();
      themeCbs.clear();
    },
  };
}

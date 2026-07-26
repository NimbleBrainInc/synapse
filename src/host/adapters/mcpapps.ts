// `detection` and `theme-defaults` are type-only against `@modelcontextprotocol/*`,
// so importing them keeps this adapter free of the ext-apps runtime (and Zod)
// that the lean `window.SynapseUI` IIFE deliberately excludes.
import { foldFontFaces } from "../../detection.js";
import { fontFacesKey } from "../../theme-defaults.js";
import { readInlineData, unwrapRenderData } from "../data.js";
import { coerceMode, preferredMode } from "../theme.js";
import {
  type ConnectUIOptions,
  type HostAdapter,
  type HostCapabilities,
  MCP_TOOLS_CALL,
  MCPAPP_HOST_CONTEXT_CHANGED,
  MCPAPP_INITIALIZE,
  MCPAPP_INITIALIZED,
  MCPAPP_MESSAGE,
  MCPAPP_OPEN_LINK,
  MCPAPP_PROTOCOL_VERSION,
  MCPAPP_SIZE_CHANGED,
  MCPAPP_TEARDOWN,
  MCPAPP_TOOL_RESULT,
  MCPUI_LINK,
  MCPUI_PROMPT,
  MCPUI_READY,
  MCPUI_RENDER_DATA,
  MCPUI_SIZE_CHANGE,
  SYNAPSE_DATA_ELEMENT_ID,
  type SynapseUITheme,
} from "../types.js";

/** How long a widget→host request (`callTool`, `openLink`, `sendPrompt`) waits
 *  for its response before rejecting, so a silent host never hangs a promise. */
const REQUEST_TIMEOUT_MS = 30_000;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * MCP Apps standard (SEP-1865) adapter — the convergence bridge for Claude
 * Desktop and other MCP Apps hosts.
 *
 * The View iframe is an MCP client speaking JSON-RPC 2.0 to `window.parent`:
 *
 *  1. posts `ui/initialize` and awaits the host context (theme, style variables);
 *  2. posts `ui/notifications/initialized`, then a `size-changed` — a host keeps
 *     the frame hidden until it has both the handshake and a size;
 *  3. receives data via `ui/notifications/tool-result` (`params` IS the
 *     `CallToolResult`, so data is at `params.structuredContent`) and theme via
 *     `ui/notifications/host-context-changed`.
 *
 * Actions go up as requests: `ui/open-link`, `ui/message` (follow-up), and
 * `tools/call` (pull). The legacy mcp-ui `ui-lifecycle-*` messages are sent and
 * accepted alongside so a pre-standard host still renders — a standard host drops
 * the non-JSON-RPC frames, and a legacy host ignores the JSON-RPC ones.
 */
export function createMcpAppsAdapter(
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
  // Set once `ui/initialize` resolves — proof we're on an MCP Apps standard host,
  // which lets us stop mirroring actions to the legacy shim.
  let standardConfirmed = false;
  let nextId = 1;
  const pending = new Map<number, PendingRequest>();
  let lastReportedHeight = -1;
  let resizeObserver: ResizeObserver | null = null;
  let onWindowResize: (() => void) | null = null;

  const parent = () => win.parent ?? win;

  function post(message: Record<string, unknown>): void {
    parent().postMessage(message, "*");
  }

  // The legacy mcp-ui frames (render-data in, size/link/prompt out) are a
  // transitional shim for the one host that still speaks it — the NimbleBrain
  // runtime, which shares this adapter via the `nimblebrain` kind until the P3
  // `nimblebrain` adapter lands and this shim is removed. Once the handshake
  // confirms a standard host we stop mirroring, so a host that understood both
  // dialects never acts on an action twice.
  function postLegacy(message: Record<string, unknown>): void {
    if (standardConfirmed) return;
    post(message);
  }

  function notify(method: string, params?: Record<string, unknown>): void {
    post({ jsonrpc: "2.0", method, params: params ?? {} });
  }

  function request<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    const id = nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`"${method}" timed out`));
      }, REQUEST_TIMEOUT_MS);
      pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      post({ jsonrpc: "2.0", id, method, params: params ?? {} });
    });
  }

  function emitData(next: unknown): void {
    if (next == null) return;
    currentData = next;
    for (const cb of dataCbs) cb(next);
  }

  /** Merge a full or partial host context into the resolved theme (mode, tokens,
   *  font faces). Fonts ride the `synapse/fontFaces` extension: absent means
   *  unchanged, an explicit (possibly empty) list replaces. ChatGPT supplies
   *  only a mode string, so this is the adapter where host typography arrives. */
  function applyHostContext(ctx: Record<string, unknown> | null | undefined): void {
    if (!ctx || typeof ctx !== "object") return;
    let { mode, tokens, fontFaces } = currentTheme;
    let changed = false;
    if (ctx.theme != null) {
      const next = coerceMode(ctx.theme, mode);
      if (next !== mode) {
        mode = next;
        changed = true;
      }
    }
    const styles = ctx.styles as { variables?: Record<string, string> } | undefined;
    if (styles?.variables && typeof styles.variables === "object") {
      tokens = { ...tokens, ...styles.variables };
      changed = true;
    }
    const nextFaces = foldFontFaces(fontFaces, ctx);
    if (fontFacesKey(nextFaces) !== fontFacesKey(fontFaces)) {
      fontFaces = nextFaces;
      changed = true;
    }
    if (changed) {
      currentTheme = { mode, tokens, ...(fontFaces ? { fontFaces } : {}) };
      for (const cb of themeCbs) cb(currentTheme);
    }
  }

  function reportSize(height?: number): void {
    if (destroyed) return;
    const h = typeof height === "number" ? height : Math.ceil(win.document.body.scrollHeight);
    if (h === lastReportedHeight) return;
    lastReportedHeight = h;
    notify(MCPAPP_SIZE_CHANGED, { height: h });
    postLegacy({ type: MCPUI_SIZE_CHANGE, payload: { height: h } });
  }

  function handleResponse(d: Record<string, unknown>): void {
    // Normalize the echoed id: JSON-RPC requires a same-type echo, but a lax host
    // that returned "1" for 1 would otherwise miss the numeric-keyed pending map.
    const id = Number(d.id);
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    clearTimeout(p.timer);
    if (d.error != null) {
      const err = d.error as { message?: string };
      p.reject(new Error(err.message ?? "request failed"));
    } else {
      p.resolve(d.result);
    }
  }

  function handleNotification(method: string, params: Record<string, unknown>): void {
    if (method === MCPAPP_TOOL_RESULT) {
      // `params` is the CallToolResult: the render data lives at structuredContent.
      const structured = params.structuredContent;
      emitData(structured != null ? structured : unwrapRenderData(params));
    } else if (method === MCPAPP_HOST_CONTEXT_CHANGED) {
      applyHostContext(params);
    }
  }

  function handleRequest(d: Record<string, unknown>): void {
    // The one host→view request we honor: acknowledge teardown so the host can
    // dispose the frame cleanly.
    if (d.method === MCPAPP_TEARDOWN) {
      post({ jsonrpc: "2.0", id: d.id, result: {} });
    }
  }

  /** Legacy mcp-ui render-data (non-JSON-RPC) — a pre-standard host's data path. */
  function handleLegacy(d: Record<string, unknown>): void {
    if (d.type === MCPUI_RENDER_DATA || d.type === "renderData") {
      const { theme, ...rest } = (d.payload ?? {}) as Record<string, unknown>;
      if (theme != null) applyHostContext({ theme });
      if (Object.keys(rest).length > 0) emitData(unwrapRenderData(rest));
    }
  }

  const onMessage = (event: MessageEvent) => {
    if (destroyed) return;
    // Accept only frames from the host window when the browser sets a source.
    if (event.source && event.source !== parent()) return;
    const d = event.data as Record<string, unknown> | null | undefined;
    if (!d || typeof d !== "object") return;
    if (d.jsonrpc !== "2.0") {
      handleLegacy(d);
      return;
    }
    if (d.id != null && ("result" in d || "error" in d)) {
      handleResponse(d);
    } else if (typeof d.method === "string") {
      if (d.id != null) handleRequest(d);
      else handleNotification(d.method, (d.params ?? {}) as Record<string, unknown>);
    }
  };

  function setupResize(): void {
    onWindowResize = () => reportSize();
    win.addEventListener("resize", onWindowResize);
    if (typeof win.ResizeObserver !== "undefined") {
      resizeObserver = new win.ResizeObserver(() => reportSize());
      resizeObserver.observe(win.document.body);
    }
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
    async callTool<O>(name: string, args?: Record<string, unknown>): Promise<O> {
      return (await request(MCP_TOOLS_CALL, { name, arguments: args ?? {} })) as O;
    },
    sendPrompt(text: string) {
      // Standard follow-up (ack ignored); legacy mirror for a pre-standard host.
      void request(MCPAPP_MESSAGE, { role: "user", content: [{ type: "text", text }] }).catch(
        () => {},
      );
      postLegacy({ type: MCPUI_PROMPT, payload: { prompt: text } });
    },
    openLink(url: string) {
      void request(MCPAPP_OPEN_LINK, { url }).catch(() => {});
      postLegacy({ type: MCPUI_LINK, payload: { url } });
    },
    resize(height?: number) {
      reportSize(height);
    },
    capabilities(): HostCapabilities {
      // The MCP Apps standard host answers `tools/call` over this bridge, so pull
      // is advertised. A legacy-only host that shares this adapter (nimblebrain,
      // pre-P3) does not, so there callTool rejects only after REQUEST_TIMEOUT_MS
      // rather than failing fast.
      return { pull: true, sendPrompt: true, openLink: true };
    },
    start() {
      win.addEventListener("message", onMessage as EventListener);

      // Baked-in data → available on first paint, before the handshake resolves.
      currentData = readInlineData(win.document, dataElementId);

      if (autoResize) setupResize();

      // Legacy mcp-ui ready (a standard host drops this non-JSON-RPC frame).
      post({ type: MCPUI_READY });

      // MCP Apps standard handshake. A legacy-only host never answers, so the
      // legacy render-data path (handleLegacy) still feeds the widget.
      request<{ hostContext?: Record<string, unknown> }>(MCPAPP_INITIALIZE, {
        appInfo: { name: options.name ?? "synapse-ui", version: options.version ?? "0.0.0" },
        appCapabilities: { availableDisplayModes: ["inline"] },
        protocolVersion: MCPAPP_PROTOCOL_VERSION,
      })
        .then((result) => {
          if (destroyed) return;
          standardConfirmed = true;
          applyHostContext(result?.hostContext);
          notify(MCPAPP_INITIALIZED, {});
          // A host keeps the frame hidden until it gets a size after init — force one.
          lastReportedHeight = -1;
          reportSize();
        })
        .catch(() => {
          // Not an MCP Apps host (or it was slow) — the legacy path covers data.
        });

      reportSize();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      win.removeEventListener("message", onMessage as EventListener);
      if (onWindowResize) win.removeEventListener("resize", onWindowResize);
      onWindowResize = null;
      resizeObserver?.disconnect();
      resizeObserver = null;
      for (const p of pending.values()) {
        clearTimeout(p.timer);
        p.reject(new Error("adapter destroyed"));
      }
      pending.clear();
      dataCbs.clear();
      themeCbs.clear();
    },
  };
}

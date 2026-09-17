// `detection` is type-only against `@modelcontextprotocol/*`, so importing it
// keeps this adapter free of the ext-apps runtime (and Zod) that the lean
// `window.SynapseUI` IIFE deliberately excludes.
import { extractHostFontCss } from "../../detection.js";
import { readInlineData } from "../data.js";
import { coerceMode, injectHostFonts, preferredMode } from "../theme.js";
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
 * MCP Apps standard (SEP-1865) adapter — the bridge for every framed host.
 * ChatGPT, Claude and NimbleBrain all implement the standard, so there is one.
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
 * `tools/call` (pull).
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
  // Set once the host has answered `ui/initialize` and been told `initialized`.
  let initialized = false;
  let nextId = 1;
  const pending = new Map<number, PendingRequest>();
  let lastReportedHeight = -1;
  let resizeObserver: ResizeObserver | null = null;
  let onWindowResize: (() => void) | null = null;

  const parent = () => win.parent ?? win;

  function post(message: Record<string, unknown>): void {
    parent().postMessage(message, "*");
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

  /** Merge a full or partial host context into the resolved theme (mode, tokens),
   *  and load the host's `@font-face` CSS from the spec's `styles.css.fonts`. */
  function applyHostContext(ctx: Record<string, unknown> | null | undefined): void {
    if (!ctx || typeof ctx !== "object") return;
    const fontCss = extractHostFontCss(ctx);
    if (fontCss !== undefined) injectHostFonts(fontCss);
    let { mode, tokens } = currentTheme;
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
    if (changed) {
      currentTheme = { mode, tokens };
      for (const cb of themeCbs) cb(currentTheme);
    }
  }

  function reportSize(height?: number): void {
    // `ui/initialize` is the app's first word on this bridge, and a strict host
    // drops anything that arrives before it — leaving the frame hidden. The
    // handshake reports a size as soon as it completes, so nothing is lost.
    if (destroyed || !initialized) return;
    const h = typeof height === "number" ? height : Math.ceil(win.document.body.scrollHeight);
    if (h === lastReportedHeight) return;
    lastReportedHeight = h;
    notify(MCPAPP_SIZE_CHANGED, { height: h });
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
      emitData(structured != null ? structured : params);
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

  const onMessage = (event: MessageEvent) => {
    if (destroyed) return;
    // Accept only frames from the host window when the browser sets a source.
    if (event.source && event.source !== parent()) return;
    const d = event.data as Record<string, unknown> | null | undefined;
    if (!d || typeof d !== "object" || d.jsonrpc !== "2.0") return;
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
    host: "mcp-apps",
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
      void request(MCPAPP_MESSAGE, { role: "user", content: [{ type: "text", text }] }).catch(
        () => {},
      );
    },
    openLink(url: string) {
      void request(MCPAPP_OPEN_LINK, { url }).catch(() => {});
    },
    resize(height?: number) {
      reportSize(height);
    },
    capabilities(): HostCapabilities {
      // An MCP Apps host answers `tools/call`, `ui/message` and `ui/open-link`
      // over this bridge.
      return { pull: true, sendPrompt: true, openLink: true };
    },
    start() {
      win.addEventListener("message", onMessage as EventListener);

      // Baked-in data → available on first paint, before the handshake resolves.
      currentData = readInlineData(win.document, dataElementId);

      if (autoResize) setupResize();

      request<{ hostContext?: Record<string, unknown> }>(MCPAPP_INITIALIZE, {
        appInfo: { name: options.name ?? "synapse-ui", version: options.version ?? "0.0.0" },
        appCapabilities: { availableDisplayModes: ["inline"] },
        protocolVersion: MCPAPP_PROTOCOL_VERSION,
      })
        .then((result) => {
          if (destroyed) return;
          applyHostContext(result?.hostContext);
          notify(MCPAPP_INITIALIZED, {});
          initialized = true;
          // A host keeps the frame hidden until it gets a size after init, and
          // this is the first point at which sending one is allowed.
          reportSize();
        })
        .catch(() => {
          // The parent never answered: it is not an MCP Apps host, and nothing
          // reaches the component over this bridge. Baked-in data still renders.
        });
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

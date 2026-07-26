import { coerceMode } from "../theme.js";
import {
  type ConnectUIOptions,
  type HostAdapter,
  type HostCapabilities,
  HostUnsupportedError,
  OPENAI_SET_GLOBALS,
  type SynapseUITheme,
} from "../types.js";

/**
 * The subset of the OpenAI Apps SDK `window.openai` surface this adapter uses.
 * All members are optional — the SDK version a host ships may not carry every
 * one, so each call is guarded and degraded.
 */
interface OpenAiHost {
  toolOutput?: unknown;
  theme?: unknown;
  callTool?: (name: string, args?: Record<string, unknown>) => Promise<unknown>;
  sendFollowUpMessage?: (arg: { prompt: string }) => void;
  /** Older casing seen in the wild — tried as a fallback. */
  sendFollowupMessage?: (arg: { prompt: string }) => void;
  openExternal?: (arg: { href: string }) => void;
}

interface SetGlobalsDetail {
  globals?: { toolOutput?: unknown; theme?: unknown };
}

/**
 * ChatGPT (OpenAI Apps SDK) adapter.
 *
 * Data arrives on `window.openai.toolOutput` (available synchronously before the
 * widget script runs) and updates via the `openai:set_globals` event. Theme is a
 * mode string on the same surface. The host auto-sizes the iframe, so `resize()`
 * is a no-op. `callTool` is available when the host exposes `window.openai.callTool`.
 */
export function createChatGPTAdapter(
  win: Window & typeof globalThis,
  _options: ConnectUIOptions,
): HostAdapter {
  const openai = () => (win as unknown as { openai?: OpenAiHost }).openai;

  let currentData: unknown = openai()?.toolOutput ?? null;
  let currentTheme: SynapseUITheme = {
    mode: coerceMode(openai()?.theme, "light"),
    tokens: {},
  };

  const dataCbs = new Set<(d: unknown) => void>();
  const themeCbs = new Set<(t: SynapseUITheme) => void>();
  let destroyed = false;

  const onSetGlobals = (event: Event) => {
    if (destroyed) return;
    const globals = (event as CustomEvent<SetGlobalsDetail>).detail?.globals;
    if (!globals) return;
    if ("toolOutput" in globals && globals.toolOutput != null) {
      currentData = globals.toolOutput;
      for (const cb of dataCbs) cb(currentData);
    }
    if ("theme" in globals && globals.theme != null) {
      const mode = coerceMode(globals.theme, currentTheme.mode);
      if (mode !== currentTheme.mode) {
        currentTheme = { mode, tokens: {} };
        for (const cb of themeCbs) cb(currentTheme);
      }
    }
  };

  return {
    host: "chatgpt",
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
      const call = openai()?.callTool;
      if (!call) throw new HostUnsupportedError("callTool", "chatgpt");
      return (await call(name, args ?? {})) as O;
    },
    sendPrompt(text: string) {
      const o = openai();
      const send = o?.sendFollowUpMessage ?? o?.sendFollowupMessage;
      send?.({ prompt: text });
    },
    openLink(url: string) {
      const open = openai()?.openExternal;
      if (open) open({ href: url });
      else win.open(url, "_blank", "noopener,noreferrer");
    },
    resize() {
      // ChatGPT auto-sizes the widget iframe — nothing to report.
    },
    capabilities(): HostCapabilities {
      const o = openai();
      return {
        pull: typeof o?.callTool === "function",
        sendPrompt:
          typeof o?.sendFollowUpMessage === "function" ||
          typeof o?.sendFollowupMessage === "function",
        openLink: true,
      };
    },
    start() {
      win.addEventListener(OPENAI_SET_GLOBALS, onSetGlobals as EventListener, { passive: true });
      // Re-read in case the host mutated globals between construction and start.
      currentData = openai()?.toolOutput ?? currentData;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      win.removeEventListener(OPENAI_SET_GLOBALS, onSetGlobals as EventListener);
      dataCbs.clear();
      themeCbs.clear();
    },
  };
}

import { readInlineData } from "../data.js";
import { coerceMode, preferredMode } from "../theme.js";
import {
  type ConnectUIOptions,
  type HostAdapter,
  type HostCapabilities,
  HostUnsupportedError,
  SYNAPSE_DATA_ELEMENT_ID,
  type SynapseUITheme,
} from "../types.js";

/**
 * Inline / standalone fallback adapter.
 *
 * No live host bridge — used for SSR, previews, and a plain browser render. Data
 * comes only from the baked-in `<script type="application/json">` blob; there is
 * nothing to push, so `onData` never fires after `start()`. Theme follows the OS
 * color scheme and tracks `prefers-color-scheme` changes. `openLink` opens a new
 * tab; `sendPrompt`/`callTool` have no destination.
 */
export function createInlineAdapter(
  win: Window & typeof globalThis,
  options: ConnectUIOptions,
): HostAdapter {
  const dataElementId = options.dataElementId ?? SYNAPSE_DATA_ELEMENT_ID;

  let currentData: unknown = null;
  let currentTheme: SynapseUITheme = { mode: preferredMode(win), tokens: {} };

  const themeCbs = new Set<(t: SynapseUITheme) => void>();
  let destroyed = false;
  let media: MediaQueryList | null = null;

  const onSchemeChange = (event: MediaQueryListEvent) => {
    if (destroyed) return;
    const mode = coerceMode(event.matches ? "dark" : "light", currentTheme.mode);
    if (mode === currentTheme.mode) return;
    currentTheme = { mode, tokens: {} };
    for (const cb of themeCbs) cb(currentTheme);
  };

  return {
    host: "generic",
    getData: <T>() => currentData as T | null,
    onData() {
      // Static render — no updates after the initial baked-in read.
      return () => {};
    },
    getTheme: () => currentTheme,
    onTheme(cb) {
      themeCbs.add(cb);
      return () => themeCbs.delete(cb);
    },
    async callTool<O>(_name: string): Promise<O> {
      throw new HostUnsupportedError("callTool", "generic");
    },
    sendPrompt() {
      // No agent to reach in a standalone render.
    },
    openLink(url: string) {
      win.open(url, "_blank", "noopener,noreferrer");
    },
    resize() {
      // No host to size for.
    },
    capabilities(): HostCapabilities {
      return { pull: false, sendPrompt: false, openLink: true };
    },
    start() {
      currentData = readInlineData(win.document, dataElementId);
      try {
        media = win.matchMedia?.("(prefers-color-scheme: dark)") ?? null;
        media?.addEventListener?.("change", onSchemeChange);
      } catch {
        media = null;
      }
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      media?.removeEventListener?.("change", onSchemeChange);
      media = null;
      themeCbs.clear();
    },
  };
}

import { applyTheme } from "../theme-defaults.js";
import type { SynapseUITheme } from "./types.js";

/**
 * Apply a resolved theme to the DOM for the cross-host client.
 *
 * Two conventions coexist across Synapse components, so the client drives both:
 *
 *  - `document.documentElement[data-theme="light"|"dark"]` — how self-contained
 *    HTML components (Bassethound's report) gate their `--var` palettes, and the
 *    lever a host's light/dark signal actually flips.
 *  - CSS custom properties via {@link applyTheme} — how the
 *    `@nimblebrain/synapse/ui` token components consume theme, backed by the
 *    SDK's neutral defaults so every referenced var resolves in both modes.
 *
 * Setting both means an app can use either convention (and a host that supplies
 * only a mode string still themes correctly). SSR-safe.
 *
 * Fonts travel separately, as the host's `@font-face` CSS: see
 * {@link injectHostFonts}.
 */
export function applyHostTheme(theme: SynapseUITheme): void {
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-theme", theme.mode);
  }
  applyTheme(theme.mode, theme.tokens);
}

/** The style element the host's font CSS goes in — the same id the spec's
 *  `applyHostFonts` uses, so both clients agree on one element. */
export const HOST_FONTS_STYLE_ID = "__mcp-host-fonts";

/**
 * Load the host's `@font-face` CSS (the spec's `hostContext.styles.css.fonts`)
 * into the document.
 *
 * Mirrors ext-apps `applyHostFonts`, which this client cannot import without
 * pulling the ext-apps runtime into its IIFE: the CSS is injected once and left
 * in place, so a later host-context change without `css` keeps the typeface
 * loaded. A host that sends none leaves the web-safe fallbacks in force.
 * SSR-safe.
 */
export function injectHostFonts(css: string): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(HOST_FONTS_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = HOST_FONTS_STYLE_ID;
  style.textContent = css;
  document.head.appendChild(style);
}

/** Read the OS-level color scheme as a sane default for hosts that don't push a
 *  theme until the handshake completes, or ever (standalone). */
export function preferredMode(win: Window | undefined): "light" | "dark" {
  try {
    if (win?.matchMedia?.("(prefers-color-scheme: dark)").matches) return "dark";
  } catch {
    // matchMedia unavailable (older test envs) — fall through to light.
  }
  return "light";
}

/** Coerce an arbitrary host-supplied theme signal to a mode. Accepts the string
 *  form (`"dark"`) both hosts use; anything else falls back. */
export function coerceMode(value: unknown, fallback: "light" | "dark"): "light" | "dark" {
  return value === "light" || value === "dark" ? value : fallback;
}

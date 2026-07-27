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
 * Setting both means an app can use either convention (or a host that supplies
 * only a mode string, like the OpenAI Apps SDK, still themes correctly). SSR-safe.
 *
 * Any `fontFaces` the host supplies are loaded here too — a token can name a
 * family but not load it, so the two travel together. A host that sends none
 * leaves the web-safe fallbacks in force.
 */
export function applyHostTheme(theme: SynapseUITheme): void {
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-theme", theme.mode);
  }
  applyTheme(theme.mode, theme.tokens, theme.fontFaces);
}

/** Read the OS-level color scheme as a sane default for hosts that don't push a
 *  theme until later (mcp-ui) or ever (standalone). */
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

/**
 * Theme-aware default backing for the `@nimblebrain/synapse/ui` token contract.
 *
 * `tokens` (see `ui/tokens.ts`) are `var(--token, fallback)` references. A CSS
 * `var()` fallback is a *static literal* — it cannot branch on light vs. dark.
 * So any var the host does NOT inject resolves to its single hardcoded (light)
 * fallback in BOTH themes. Pair such a token with a theme-aware one and you get
 * white-on-white in dark mode: it looks correct in light, passes `tsc`/build,
 * and only breaks when the theme is toggled.
 *
 * This module closes that gap with a default layer the SDK controls and that
 * CAN branch on theme. {@link applyThemeVariables} writes the neutral defaults
 * for the active `mode` first, then the host's variables on top — so:
 *   - the host's (brand) values always win for the keys it provides, and
 *   - any var the host omits still resolves to a theme-correct neutral value.
 *
 * It's the `var()` fallback, but able to branch on theme. The values stay
 * deliberately NEUTRAL (grays + a generic blue), never NimbleBrain brand —
 * brand arrives only by host injection, mirroring `ui/tokens.ts`. This keeps
 * the library host-agnostic while guaranteeing every token resolves correctly
 * in both themes even against an incomplete host, a standalone `connect()`
 * widget, or a third-party host.
 *
 * Only theme-sensitive (color) vars are listed here. Theme-invariant vars
 * (radii, type scale, shadows, font stacks, weights, border widths) look the
 * same in both themes, so their static `var()` fallback is already correct —
 * they are intentionally absent. The `tokens` regression test enforces this
 * with a TOTAL partition: every referenced var must be either declared
 * theme-invariant (an explicit allowlist) or defined in both maps below, so a
 * newly added theme-sensitive token can't slip through unbacked.
 */

/**
 * Light-theme neutral defaults. Values match the (light) fallbacks baked into
 * `tokens` — applying them changes nothing observable in light mode; they exist
 * so the light path flows through the same code as dark and so a standalone
 * render with an explicit `light` theme is backed identically to its fallbacks.
 */
const LIGHT: Record<string, string> = {
  // ── Surfaces ──
  "--color-background-primary": "#ffffff",
  "--color-background-secondary": "#fafafa",
  "--color-background-tertiary": "#f3f4f6",
  // ── Text ──
  "--color-text-primary": "#111827",
  "--color-text-secondary": "#6b7280",
  "--color-text-tertiary": "#9ca3af",
  "--color-text-accent": "#2563eb",
  "--nb-color-accent-foreground": "#ffffff",
  // ── Border / ring ──
  "--color-border-primary": "#e5e7eb",
  "--color-border-secondary": "#d1d5db",
  "--color-ring-primary": "#2563eb",
  // ── Status / brand semantics ──
  "--nb-color-danger": "#dc2626",
  "--nb-color-success": "#059669",
  "--nb-color-warning": "#f59e0b",
  "--nb-color-warm": "#d4620a",
  "--nb-color-warm-light": "#fef5ee",
  "--nb-color-processing": "#7c3aed",
  "--nb-color-processing-light": "#f3eeff",
  "--nb-color-info-light": "#eef4ff",
};

/**
 * Dark-theme neutral defaults. A monotonic neutral ladder — the three surface
 * tiers are the darkest, borders sit a step lighter so they stay visible
 * against every surface, and text inverts to light. "Subtle"/"strong" keep
 * their light-mode semantics: `bgSubtle` reads as a lifted hover/inset tint and
 * `borderStrong` is more prominent than `border`.
 */
const DARK: Record<string, string> = {
  // ── Surfaces (base → lifted) ──
  "--color-background-primary": "#18181b",
  "--color-background-secondary": "#27272a",
  "--color-background-tertiary": "#2f2f34",
  // ── Text ──
  "--color-text-primary": "#fafafa",
  "--color-text-secondary": "#a1a1aa",
  "--color-text-tertiary": "#71717a",
  "--color-text-accent": "#818cf8",
  "--nb-color-accent-foreground": "#ffffff",
  // ── Border / ring (lighter than surfaces so they remain visible) ──
  "--color-border-primary": "#3f3f46",
  "--color-border-secondary": "#52525b",
  "--color-ring-primary": "#818cf8",
  // ── Status / brand semantics (brightened for contrast on dark) ──
  "--nb-color-danger": "#f87171",
  "--nb-color-success": "#34d399",
  "--nb-color-warning": "#fbbf24",
  "--nb-color-warm": "#fb923c",
  "--nb-color-warm-light": "#3a2a1e",
  "--nb-color-processing": "#a78bfa",
  "--nb-color-processing-light": "#2a2440",
  "--nb-color-info-light": "#1e2a44",
};

/**
 * The neutral default theme, keyed by mode. Exported for the regression test
 * that asserts every color var referenced by `tokens` is backed in both modes.
 */
export const DEFAULT_THEME_VARS: Record<"light" | "dark", Record<string, string>> = {
  light: LIGHT,
  dark: DARK,
};

/**
 * Apply theme CSS custom properties onto `document.documentElement`.
 *
 * Writes the neutral defaults for `mode` FIRST, then the host's variables on
 * top — so the host's values win for the keys it provides, and any var it omits
 * still resolves to a theme-correct neutral default. This is the single path by
 * which theming reaches the DOM (the handshake, `host-context-changed`, and the
 * React `<SynapseProvider>` all funnel through here).
 *
 * SSR-safe (no-ops when `document` is unavailable). Idempotent — `setProperty`
 * overwrites, so re-applying on every theme change is correct and cheap.
 */
export function applyThemeVariables(
  mode: "light" | "dark",
  hostVars: Record<string, string> | undefined | null,
): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement.style;
  for (const [k, v] of Object.entries(DEFAULT_THEME_VARS[mode])) {
    root.setProperty(k, v);
  }
  if (hostVars && typeof hostVars === "object") {
    for (const [k, v] of Object.entries(hostVars)) {
      if (typeof k === "string" && typeof v === "string") {
        root.setProperty(k, v);
      }
    }
  }
}

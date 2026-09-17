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
 * CAN branch on theme. {@link applyThemeVariables} puts the neutral defaults for
 * the active `mode` in a cascade layer and the host's variables inline — so:
 *   - the host's (brand) values always win for the keys it provides, through
 *     either the protocol or a stylesheet it injects, and
 *   - any var nobody declares still resolves to a theme-correct neutral value.
 *
 * It's the `var()` fallback, but able to branch on theme. The values stay
 * neutral grays, a generic blue, and generic semantic hues for danger, success,
 * warning and processing — never a *brand* value. Brand arrives only by host
 * injection, mirroring `ui/tokens.ts`. `__tests__/ui/tokens.test.ts` holds the
 * line: every hex here must be in the sanctioned set. This keeps
 * the library host-agnostic while guaranteeing every token resolves correctly
 * in both themes even against an incomplete host, a standalone `connect()`
 * widget, or a third-party host.
 *
 * Font *faces* are the one part of theming CSS variables cannot carry — a token
 * names a family, it cannot load one. The spec carries them separately, as
 * `@font-face` CSS in `hostContext.styles.css.fonts`, and each client applies
 * that string itself. The CSS is injected as the host sent it: it is trusted,
 * because the host already controls the frame it renders into.
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
  "--nb-color-danger-foreground": "#ffffff",
  "--nb-color-success": "#059669",
  "--nb-color-warning": "#f59e0b",
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
  // Dark text on the brightened red: white on #f87171 is under 3:1.
  "--nb-color-danger-foreground": "#18181b",
  "--nb-color-success": "#34d399",
  "--nb-color-warning": "#fbbf24",
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

/** Cascade layer holding the neutral defaults. Named so an app can order it. */
export const DEFAULTS_LAYER_NAME = "synapse-defaults";

/** `id` of the single `<style>` element this module owns. */
export const DEFAULTS_STYLE_ID = "synapse-theme-defaults";

/** Custom properties this module last wrote inline, so a later apply clears only
 *  what it owns and never an inline property the app set itself. */
let appliedInlineKeys = new Set<string>();

/** Test seam — forget what was written inline so a fresh apply is observable. */
export function resetAppliedInlineKeys(): void {
  appliedInlineKeys = new Set();
}

/**
 * Whether this document can host the defaults stylesheet.
 *
 * Not the same question as `typeof document !== "undefined"`. An embedder or a
 * test harness may install a *partial* `document` — `documentElement.style` plus
 * listeners and nothing else — which is everything this module needed while the
 * defaults were inline properties. Moving them into a stylesheet added three new
 * requirements (`getElementById`, `createElement`, `head.prepend`), and reaching
 * for them on such a document throws.
 *
 * A throw here is not contained: it unwinds through `applyTheme` into the
 * handshake, so an app in that environment never finishes connecting. The
 * default layer is a rendering nicety and the connection is not, so a document
 * that cannot carry a stylesheet gets no layer rather than no session.
 */
function canInstallStylesheet(): boolean {
  return (
    typeof document !== "undefined" &&
    typeof document.getElementById === "function" &&
    typeof document.createElement === "function" &&
    typeof document.head?.prepend === "function"
  );
}

/**
 * Install the neutral defaults for `mode` as a cascade layer.
 *
 * A layer, not inline properties on `documentElement`, and that distinction is
 * the whole point: **a default has to lose.** An inline style outranks every
 * author stylesheet, so writing defaults there made them beat any rule a host or
 * app had written for the same var — the opposite of a fallback.
 *
 * A host cannot always deliver a var through the protocol.
 * `hostContext.styles.variables` is a closed enum, so a host whose design system
 * is larger than that enum has to put the remainder in a stylesheet it injects
 * into the app document. Those declarations are ordinary unlayered author rules.
 * Unlayered beats layered, so they now win — while a var nobody declares still
 * resolves to a neutral default, which is what this map is for.
 *
 * An app's own `:root` rule wins for the same reason, so overriding a default
 * needs no `!important` and no knowledge of this module.
 *
 * One element, replaced in place, so a mode flip swaps the whole map atomically
 * and repeat calls are cheap. SSR-safe.
 */
function applyDefaultThemeLayer(mode: "light" | "dark"): void {
  if (!canInstallStylesheet()) return;

  // Safe to concatenate ONLY because every key and value here is module-local
  // (`DEFAULT_THEME_VARS`). A host-supplied value containing `}` would escape
  // the rule, so never fold host or app input into this template; host
  // variables go through `setProperty`, which cannot escape.
  const declarations = Object.entries(DEFAULT_THEME_VARS[mode])
    .map(([k, v]) => `    ${k}: ${v};`)
    .join("\n");
  const css = `@layer ${DEFAULTS_LAYER_NAME} {\n  :root {\n${declarations}\n  }\n}`;

  const existing = document.getElementById(DEFAULTS_STYLE_ID);
  if (existing) {
    // Avoid a needless style invalidation when the mode hasn't changed.
    if (existing.textContent !== css) existing.textContent = css;
    return;
  }
  const el = document.createElement("style");
  el.id = DEFAULTS_STYLE_ID;
  el.textContent = css;
  // Prepended so this is the first layer the document declares, which puts it
  // first in layer order — an app that declares its own layers sorts after, and
  // therefore wins. Unlayered app rules win regardless of DOM order.
  document.head.prepend(el);
}

/**
 * Apply theme CSS custom properties to the app document.
 *
 * The host's variables go inline on `documentElement`, where they outrank
 * everything; the neutral defaults for `mode` go into a cascade layer, where
 * they lose to any rule that actually declares the var. So a host value beats
 * this module's default through *either* channel — the protocol or a stylesheet
 * it injects — and a var nobody declares still resolves to a theme-correct
 * default. Only the protocol channel also outranks the app: a host's injected
 * stylesheet and the app's own `:root` are both unlayered rules of equal
 * specificity, so document order decides between them, not this module.
 *
 * A key this module wrote on a previous call and the incoming set does NOT carry
 * is *removed* inline rather than left behind, because a host may legitimately
 * narrow its key set: stop sending a var and it must stop applying, or it stays
 * pinned inline forever where the layer, the host's own stylesheet and the app's
 * own rules all cannot reach it. Removing lets the cascade resolve it against
 * those instead, which is the property this module exists to establish, and is
 * strictly less destructive than overwriting the key with our own default.
 *
 * Tracked as the set of keys last written, not as `DEFAULT_THEME_VARS`'s keys.
 * Those are two different sets: a host can send any spec-enum var, and ~25
 * theme-sensitive ones (`--color-text-danger`, `--color-background-inverse`, …)
 * have no neutral default, so keying the removal off the default map would pin
 * exactly those at the previous mode's value. Tracking what we wrote also means
 * this module never clears an inline property it did not set — an app writing its
 * own `documentElement.style` is left alone.
 *
 * Today an empty var set also arrives for a reason that is a bug rather than a
 * narrowing — `core.ts` replaces the host context wholesale, so a partial
 * `host-context-changed` that omits `styles` reads as "no tokens" (#46;
 * `connect.ts` already carries them forward). Fixing #46 is the better outcome —
 * it keeps the host's brand across a mode flip instead of collapsing to our
 * neutral — and does not make this loop unnecessary.
 *
 * SSR-safe (no-ops when `document` is unavailable). Idempotent — re-applying on
 * every theme change is correct and cheap.
 *
 * Prefer {@link applyTheme}: it applies variables *and* font faces together, so
 * a caller cannot wire up half a theme.
 */
export function applyThemeVariables(
  mode: "light" | "dark",
  hostVars: Record<string, string> | undefined | null,
): void {
  if (typeof document === "undefined") return;
  applyDefaultThemeLayer(mode);

  // ONE definition of "the host provided this key", read by both loops below.
  // Wire data is untyped, so a key can arrive with a non-string value; that is
  // not a provided value, so the clear loop must reach it. Two predicates —
  // `k in hostVars` to clear, `typeof v === "string"` to write — leave such a key
  // in the gap: neither removed nor written, so the previous theme's value stays
  // pinned inline where the layer, the host's stylesheet and the app's `:root`
  // all cannot reach it. That is the un-self-healing pin this module exists to
  // eliminate, re-entered by a different door.
  const incoming: Record<string, string> = {};
  if (hostVars && typeof hostVars === "object") {
    for (const [k, v] of Object.entries(hostVars)) {
      if (typeof k === "string" && typeof v === "string") incoming[k] = v;
    }
  }

  const root = document.documentElement.style;
  // `removeProperty` is feature-checked and `setProperty` deliberately is not.
  // The setter is the one capability this module has always required, so a
  // document lacking it was never supported and gets no new promise here; the
  // clear pass arrived with the defaults layer, so a `style` carrying only the
  // setter is a shape that used to work. Dropping the clear pass for it is far
  // better than throwing out of the loop and leaving the host's variables
  // unwritten entirely.
  if (typeof root.removeProperty === "function") {
    for (const k of appliedInlineKeys) {
      if (!(k in incoming)) root.removeProperty(k);
    }
  }
  for (const [k, v] of Object.entries(incoming)) root.setProperty(k, v);
  appliedInlineKeys = new Set(Object.keys(incoming));
}

/**
 * Apply a resolved theme's variables to the app document.
 *
 * The single path by which theme variables reach the DOM: the handshake and
 * `host-context-changed` both funnel through here.
 */
export function applyTheme(
  mode: "light" | "dark",
  hostVars: Record<string, string> | undefined | null,
): void {
  applyThemeVariables(mode, hostVars);
}

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
 * deliberately NEUTRAL (grays + a generic blue), never NimbleBrain brand —
 * brand arrives only by host injection, mirroring `ui/tokens.ts`. This keeps
 * the library host-agnostic while guaranteeing every token resolves correctly
 * in both themes even against an incomplete host, a standalone `connect()`
 * widget, or a third-party host.
 *
 * Font *faces* are the one part of theming CSS variables cannot carry — a token
 * names a family, it cannot load one. {@link applyThemeFontFaces} closes that
 * half, and {@link applyTheme} applies both together.
 *
 * Only theme-sensitive (color) vars are listed here. Theme-invariant vars
 * (radii, type scale, shadows, font stacks, weights, border widths) look the
 * same in both themes, so their static `var()` fallback is already correct —
 * they are intentionally absent. The `tokens` regression test enforces this
 * with a TOTAL partition: every referenced var must be either declared
 * theme-invariant (an explicit allowlist) or defined in both maps below, so a
 * newly added theme-sensitive token can't slip through unbacked.
 */

import type { FontDisplayValue, FontFaceDescriptor } from "./types.js";

const FONT_DISPLAY_VALUES = new Set<FontDisplayValue>([
  "auto",
  "block",
  "swap",
  "fallback",
  "optional",
]);

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
  // (`DEFAULT_THEME_VARS`). `applyThemeFontFaces` below deliberately avoids
  // building CSS text for exactly this reason — a host-supplied value containing
  // `}` would escape the rule. Never fold host or app input into this template;
  // host variables go through `setProperty`, which cannot escape.
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

/** The faces this module has added, so a re-apply replaces rather than accumulates. */
const managedFaces = new Set<FontFace>();

/** Signature of the currently-applied set — lets a repeat call no-op. */
let appliedFontKey = "";

/** Stable signature of a face list — the one comparison rule for "same fonts?",
 *  shared by the sink's re-apply guard and `onThemeChanged`'s equality filter. */
export function fontFacesKey(faces: readonly FontFaceDescriptor[] | undefined | null): string {
  if (!Array.isArray(faces)) return "";
  return JSON.stringify(faces.map((d) => [d.family, d.src, d.weight, d.style, d.display]));
}

/**
 * Normalise an untrusted face list into the one shape every layer trusts.
 *
 * THE rule, in one place:
 *   - not an array           → `undefined` — nothing was said, keep what's loaded
 *   - array, none usable     → `undefined` — a shape mistake is not a clear
 *   - array, some usable     → those entries
 *   - empty array            → `[]` — the explicit clear
 *
 * The wire and the sink each used to spell this out separately and drifted
 * apart, so a host whose descriptors were mis-shaped kept its typeface through
 * one path and lost it through the other. One predicate, one spelling.
 */
export function normalizeFontFaces(raw: unknown): FontFaceDescriptor[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const usable = raw.filter(isFontFaceDescriptor);
  if (raw.length > 0 && usable.length === 0) return undefined;
  return usable;
}

/**
 * Load host-supplied `@font-face`s into the app document.
 *
 * Uses the CSSOM {@link FontFace} constructor rather than building `@font-face`
 * CSS text. That is deliberate, and load-bearing for two reasons:
 *
 *  1. **No CSS-injection sink.** `family` and `src` are separate arguments, not
 *     concatenated into a stylesheet, so a host value containing `}` cannot
 *     escape the rule and inject arbitrary CSS into the app.
 *  2. **Uniform URL handling.** The `src` descriptor is parsed by the browser
 *     against the `src` grammar, so relative (`url('/fonts/x.woff2')`), absolute
 *     (`url('https://cdn.example/x.woff2')`) and `data:` forms all just work.
 *     A malformed descriptor throws `SyntaxError` here instead of silently
 *     producing dead CSS.
 *
 * The SDK ships no font data. A host that sends nothing leaves the web-safe
 * fallbacks in `ui/tokens.ts` in force — which is why omitting fonts entirely is
 * a supported configuration, not a degraded one.
 *
 * Faces are added but not force-loaded: the browser fetches a face when CSS
 * first matches it, so an unused weight costs nothing. `display` defaults to
 * `swap` so text paints in the fallback immediately rather than blocking.
 *
 * SSR-safe, and safe in environments without the CSS Font Loading API (older
 * jsdom): both no-op. Re-applying an unchanged set is a no-op.
 */
export function applyThemeFontFaces(faces: readonly FontFaceDescriptor[] | undefined | null): void {
  // `normalizeFontFaces` owns what absent/garbage means. Reached from the public
  // `applyHostTheme`, so the input here is not necessarily typed: a host
  // building `fontFaces` from untrusted JSON can hand us mis-shaped entries,
  // and reading those as "clear" would unload the typeface over a typo.
  const next = normalizeFontFaces(faces);
  if (next === undefined) return;
  if (typeof document === "undefined") return;
  // `document.fonts` (CSS Font Loading API) is absent in some test DOMs.
  if (!document.fonts || typeof FontFace === "undefined") return;

  const key = fontFacesKey(next);
  if (key === appliedFontKey) return;
  appliedFontKey = key;

  for (const face of managedFaces) {
    try {
      document.fonts.delete(face);
    } catch {
      // Already evicted, or the API rejected the handle — nothing to undo.
    }
  }
  managedFaces.clear();

  for (const d of next) {
    try {
      const face = new FontFace(d.family, d.src, {
        weight: d.weight,
        style: d.style,
        // Wire data is untyped: ignore an unrecognised `display` rather than let
        // the constructor reject the descriptor and cost the app this face.
        display: d.display && FONT_DISPLAY_VALUES.has(d.display) ? d.display : "swap",
      });
      document.fonts.add(face);
      managedFaces.add(face);
    } catch {
      // Malformed descriptor — skip this face and keep the web-safe fallback.
      // One bad entry must not cost the app the rest of its typography.
    }
  }
}

function isFontFaceDescriptor(value: unknown): value is FontFaceDescriptor {
  if (!value || typeof value !== "object") return false;
  const d = value as Partial<FontFaceDescriptor>;
  return typeof d.family === "string" && typeof d.src === "string";
}

/**
 * Apply a resolved theme to the app document — CSS variables and font faces.
 *
 * This is the single path by which theming reaches the DOM: the handshake,
 * `host-context-changed`, and the React `<SynapseProvider>` all funnel through
 * here. Keeping colour and typography on one call is the point — two entry
 * points invite a caller to wire one and forget the other, shipping a host's
 * palette under the wrong typeface.
 *
 * Omitting `fontFaces` is safe and means "leave the loaded faces alone" (see
 * {@link applyThemeFontFaces}), so a caller re-applying a theme derived from a
 * partial host context cannot silently strip the host's typeface.
 */
export function applyTheme(
  mode: "light" | "dark",
  hostVars: Record<string, string> | undefined | null,
  fontFaces?: readonly FontFaceDescriptor[] | null,
): void {
  applyThemeVariables(mode, hostVars);
  applyThemeFontFaces(fontFaces);
}

/** Test seam — forget applied faces so a fresh apply is observable. */
export function resetAppliedFontFaces(): void {
  managedFaces.clear();
  appliedFontKey = "";
}

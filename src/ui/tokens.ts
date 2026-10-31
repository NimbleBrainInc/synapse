/**
 * The token contract for `@nimblebrain/synapse/ui`.
 *
 * Values are NOT brand hexes — they are `var(--token, fallback)` references to
 * the CSS custom properties the host injects into the app iframe (the MCP
 * ext-apps `hostContext.styles.variables`). Because styling resolves through
 * CSS variables, theme changes (including light↔dark) reflect automatically
 * with no React re-render: the host swaps the `:root` vars and every `var()`
 * re-resolves.
 *
 * The fallbacks are deliberately **unbranded** — system fonts, neutral grays, a
 * generic blue, and generic semantic hues for the status channels. NOT
 * NimbleBrain brand. Brand arrives by injection when the app runs inside the
 * NimbleBrain host; standalone/static renders get a sane
 * unbranded default. This keeps the library host-agnostic.
 * `__tests__/ui/tokens.test.ts` holds the line: every hex in these fallbacks
 * must be in the sanctioned set, same as `theme-defaults.ts`.
 *
 * Components import the static `tokens` object and style with CSS `var()`, so
 * theming (incl. light/dark) resolves in CSS with no re-render.
 */

import type { CSSProperties } from "react";

// The gutter's defaults, which apply when the host supplies no value. Exported so a host
// that supplies its own (`--nb-gutter-narrow`, `--nb-gutter`) can test them against these.
/** The gutter in a frame wider than {@link GUTTER_NARROW_BREAKPOINT}. */
export const GUTTER_DEFAULT = "1.5rem";
/** The gutter in a frame {@link GUTTER_NARROW_BREAKPOINT} wide or narrower. */
export const GUTTER_NARROW_DEFAULT = "1rem";
/** The frame width, in CSS pixels, at or below which `AppFrame` applies the narrow gutter. */
export const GUTTER_NARROW_BREAKPOINT = 640;

/** Resolved design tokens as CSS `var()` references with neutral fallbacks. */
export const tokens = {
  // ── Surfaces ──
  bg: "var(--color-background-primary, #ffffff)",
  bgRaised: "var(--color-background-secondary, #fafafa)",
  bgSubtle: "var(--color-background-tertiary, #f3f4f6)",

  // ── Text ──
  fg: "var(--color-text-primary, #111827)",
  fgMuted: "var(--color-text-secondary, #6b7280)",
  fgFaint: "var(--color-text-tertiary, #9ca3af)",
  accent: "var(--color-text-accent, #2563eb)",
  // Text on an accent or danger fill. The spec names no "on-accent" colour;
  // inverse text is text for a surface of the opposite polarity, which a
  // saturated fill is in both modes.
  accentFg: "var(--color-text-inverse, #ffffff)",

  // ── Border / ring ──
  border: "var(--color-border-primary, #e5e7eb)",
  borderStrong: "var(--color-border-secondary, #d1d5db)",
  ring: "var(--color-ring-primary, #2563eb)",

  // ── Status semantics ──
  danger: "var(--color-text-danger, #dc2626)",
  dangerFg: "var(--color-text-inverse, #ffffff)",
  success: "var(--color-text-success, #059669)",
  warning: "var(--color-text-warning, #f59e0b)",
  // The spec has no processing hue, so these two are the kit's own variables:
  // backed by its neutral defaults, and set by a host or an app that wants
  // its own.
  processing: "var(--nb-color-processing, #7c3aed)",
  processingLight: "var(--nb-color-processing-light, #f3eeff)",
  infoLight: "var(--color-background-info, #eef4ff)",

  // ── Typography ──
  fontSans: "var(--font-sans, system-ui, -apple-system, BlinkMacSystemFont, sans-serif)",
  fontMono: "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)",
  // The spec names one family, `--font-sans`, and headings follow it. Set
  // `--nb-font-heading` to give headings a family of their own.
  fontHeading:
    "var(--nb-font-heading, var(--font-sans, system-ui, -apple-system, BlinkMacSystemFont, sans-serif))",
  weightNormal: "var(--font-weight-normal, 400)",
  weightMedium: "var(--font-weight-medium, 500)",
  weightSemibold: "var(--font-weight-semibold, 600)",
  weightBold: "var(--font-weight-bold, 700)",

  // ── Type scale (size + line-height pairs) ──
  textXsSize: "var(--font-text-xs-size, 0.75rem)",
  textXsLine: "var(--font-text-xs-line-height, 1rem)",
  textSmSize: "var(--font-text-sm-size, 0.875rem)",
  textSmLine: "var(--font-text-sm-line-height, 1.25rem)",
  textBaseSize: "var(--font-text-base-size, 1rem)",
  textBaseLine: "var(--font-text-base-line-height, 1.5rem)",
  textLgSize: "var(--font-text-lg-size, 1.125rem)",
  textLgLine: "var(--font-text-lg-line-height, 1.75rem)",
  headingSmSize: "var(--font-heading-sm-size, 1.25rem)",
  headingSmLine: "var(--font-heading-sm-line-height, 1.75rem)",
  headingMdSize: "var(--font-heading-md-size, 1.5rem)",
  headingMdLine: "var(--font-heading-md-line-height, 2rem)",
  headingLgSize: "var(--font-heading-lg-size, 2rem)",
  headingLgLine: "var(--font-heading-lg-line-height, 2.5rem)",

  // ── Space ──
  // The inset between the frame's edge and content: titles, tabs, prose, a pane's text.
  //
  // The host owns the VALUE, as it owns the colour, font and radius values: it may supply
  // `--nb-gutter-narrow` (the gutter in a frame `GUTTER_NARROW_BREAKPOINT` px wide or narrower)
  // and `--nb-gutter` (one gutter at every width, which replaces the narrowing). Without them
  // the defaults apply: `GUTTER_DEFAULT`, and `GUTTER_NARROW_DEFAULT` in a narrow frame.
  // The kit owns the MECHANISM: `AppFrame` picks the value from its own width, by container
  // query, and sets `--nb-gutter-auto`; the kit's layouts inset by this token. The app owns
  // the PLACEMENT: it composes layouts and names no spacing, choosing per region whether
  // content insets or a container bleeds edge to edge. The host never pads the app's slot,
  // because a host gutter would make edge-to-edge panes impossible.
  gutter: `var(--nb-gutter, var(--nb-gutter-auto, ${GUTTER_DEFAULT}))`,

  // ── Radius / border width ──
  radiusXs: "var(--border-radius-xs, 0.25rem)",
  radiusSm: "var(--border-radius-sm, 0.5rem)",
  radiusMd: "var(--border-radius-md, 0.75rem)",
  radiusLg: "var(--border-radius-lg, 1rem)",
  radiusXl: "var(--border-radius-xl, 1.5rem)",
  borderWidth: "var(--border-width-regular, 1px)",

  // ── Shadows ──
  shadowHairline: "var(--shadow-hairline, 0 0 0 1px rgba(0,0,0,0.06))",
  shadowSm: "var(--shadow-sm, 0 1px 2px rgba(0,0,0,0.05))",
  shadowMd: "var(--shadow-md, 0 4px 6px -1px rgba(0,0,0,0.1))",
  shadowLg: "var(--shadow-lg, 0 10px 15px -3px rgba(0,0,0,0.1))",
} as const;

export type Tokens = typeof tokens;

/**
 * A style object that also permits CSS custom properties (`--foo`). React's
 * `CSSProperties` rejects custom-property keys; components that set CSS vars
 * inline (for `:hover`/keyframe plumbing) type their style as this, then pass
 * it to `style` (it down-casts cleanly to `CSSProperties`).
 */
export type StyleWithVars = CSSProperties & Record<`--${string}`, string | number>;

/** Body text sizes. */
export type TextSize = "xs" | "sm" | "base" | "lg";
/** Heading sizes. */
export type HeadingSize = "sm" | "md" | "lg";

const TEXT_SCALE: Record<TextSize, CSSProperties> = {
  xs: { fontSize: tokens.textXsSize, lineHeight: tokens.textXsLine },
  sm: { fontSize: tokens.textSmSize, lineHeight: tokens.textSmLine },
  base: { fontSize: tokens.textBaseSize, lineHeight: tokens.textBaseLine },
  lg: { fontSize: tokens.textLgSize, lineHeight: tokens.textLgLine },
};

const HEADING_SCALE: Record<HeadingSize, CSSProperties> = {
  sm: { fontSize: tokens.headingSmSize, lineHeight: tokens.headingSmLine },
  md: { fontSize: tokens.headingMdSize, lineHeight: tokens.headingMdLine },
  lg: { fontSize: tokens.headingLgSize, lineHeight: tokens.headingLgLine },
};

/** `{ fontSize, lineHeight }` for a body-text level. */
export function textStyle(size: TextSize): CSSProperties {
  return TEXT_SCALE[size];
}

/** `{ fontSize, lineHeight }` for a heading level. */
export function headingStyle(size: HeadingSize): CSSProperties {
  return HEADING_SCALE[size];
}

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
 * The fallbacks are deliberately **neutral** (system fonts, neutral grays, a
 * generic blue) — NOT NimbleBrain brand. Brand arrives by injection when the
 * app runs inside the NimbleBrain host; standalone/static renders get a sane
 * unbranded default. This keeps the library host-agnostic.
 *
 * Components import the static `tokens` object. Use {@link useTokens} only when
 * a component needs the resolved light/dark `mode` (rare).
 */

import type { CSSProperties } from "react";
import { useTheme } from "../react/index.js";

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
  accentFg: "var(--nb-color-accent-foreground, #ffffff)",

  // ── Border / ring ──
  border: "var(--color-border-primary, #e5e7eb)",
  borderStrong: "var(--color-border-secondary, #d1d5db)",
  ring: "var(--color-ring-primary, #2563eb)",

  // ── Status / brand semantics ──
  danger: "var(--nb-color-danger, #dc2626)",
  success: "var(--nb-color-success, #059669)",
  warning: "var(--nb-color-warning, #f59e0b)",
  warm: "var(--nb-color-warm, #d4620a)",
  warmLight: "var(--nb-color-warm-light, #fef5ee)",
  processing: "var(--nb-color-processing, #7c3aed)",
  processingLight: "var(--nb-color-processing-light, #f3eeff)",
  infoLight: "var(--nb-color-info-light, #eef4ff)",

  // ── Typography ──
  fontSans: "var(--font-sans, system-ui, -apple-system, BlinkMacSystemFont, sans-serif)",
  fontMono: "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)",
  fontHeading: "var(--nb-font-heading, Georgia, 'Times New Roman', serif)",
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

/**
 * The resolved tokens plus the host's current light/dark `mode`. Most
 * components should import the static `tokens` object instead — they style
 * with CSS `var()` and so theme automatically without this hook. Reach for
 * `useTokens()` only when a component must branch on `mode` (e.g. choosing a
 * mode-specific overlay tint that has no token).
 */
export function useTokens(): { tokens: Tokens; mode: "light" | "dark"; isDark: boolean } {
  const theme = useTheme();
  return { tokens, mode: theme.mode, isDark: theme.mode === "dark" };
}

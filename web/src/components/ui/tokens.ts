/**
 * Token maps for the live component previews.
 *
 * The `@nimblebrain/synapse/ui` components carry no brand. Every color, font,
 * and radius is a `var(--token, fallback)` reference that a host fills in at
 * runtime. In the docs we play the host: we inject one of these maps onto the
 * preview container (not `:root`, so each preview is self-contained and the
 * docs chrome is untouched) and the components adopt it with no re-render.
 *
 * This is a Synapse-branded map (the landing's fonts and blue accent), so the
 * previews read as the same product as the rest of the site. Baseline color
 * ramps follow the SDK's neutral defaults (gallery/src/demo-theme.ts).
 */

export type Mode = "light" | "dark";

type TokenMap = Record<string, string>;

const TYPE_SCALE: TokenMap = {
  "--font-weight-normal": "400",
  "--font-weight-medium": "500",
  "--font-weight-semibold": "600",
  "--font-weight-bold": "700",
  "--font-text-xs-size": "0.75rem",
  "--font-text-xs-line-height": "1rem",
  "--font-text-sm-size": "0.875rem",
  "--font-text-sm-line-height": "1.25rem",
  "--font-text-base-size": "1rem",
  "--font-text-base-line-height": "1.5rem",
  "--font-text-lg-size": "1.125rem",
  "--font-text-lg-line-height": "1.75rem",
  "--font-heading-sm-size": "1.25rem",
  "--font-heading-sm-line-height": "1.75rem",
  "--font-heading-md-size": "1.5rem",
  "--font-heading-md-line-height": "2rem",
  "--font-heading-lg-size": "2rem",
  "--font-heading-lg-line-height": "2.5rem",
  "--border-width-regular": "1px",
};

const RADII: TokenMap = {
  "--border-radius-xs": "0.25rem",
  "--border-radius-sm": "0.375rem",
  "--border-radius-md": "0.5rem",
  "--border-radius-lg": "0.75rem",
  "--border-radius-xl": "1rem",
};

// Synapse brand faces, the same self-hosted fonts the docs and landing load.
const FONTS: TokenMap = {
  "--font-sans": "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif",
  "--nb-font-heading": "'Space Grotesk', system-ui, sans-serif",
  "--font-mono": "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
};

const LIGHT: TokenMap = {
  "--color-background-primary": "#ffffff",
  "--color-background-secondary": "#f7f9fb",
  "--color-background-tertiary": "#eef1f5",
  "--color-text-primary": "#0b0f1a",
  "--color-text-secondary": "#5a6675",
  "--color-text-tertiary": "#93a0b0",
  "--color-text-accent": "#1b4fe0",
  "--color-border-primary": "#e5e9f0",
  "--color-border-secondary": "#d1d8e3",
  "--color-ring-primary": "#2563ff",
  "--shadow-hairline": "0 0 0 1px rgba(11,15,26,0.06)",
  "--shadow-sm": "0 1px 2px rgba(11,15,26,0.05)",
  "--shadow-md": "0 4px 6px -1px rgba(11,15,26,0.1)",
  "--shadow-lg": "0 10px 15px -3px rgba(11,15,26,0.1)",
  "--nb-color-accent-foreground": "#ffffff",
  "--nb-color-danger": "#dc2626",
  "--nb-color-success": "#16a34a",
  "--nb-color-warning": "#d97706",
  "--nb-color-processing": "#7c3aed",
  "--nb-color-processing-light": "#f5f3ff",
  "--nb-color-info-light": "#eff6ff",
};

const DARK: TokenMap = {
  "--color-background-primary": "#0c111b",
  "--color-background-secondary": "#111725",
  "--color-background-tertiary": "#161e2e",
  "--color-text-primary": "#edf0f6",
  "--color-text-secondary": "#a2adc0",
  "--color-text-tertiary": "#6b7688",
  "--color-text-accent": "#7aa2ff",
  "--color-border-primary": "#1f2838",
  "--color-border-secondary": "#2b3646",
  "--color-ring-primary": "#2563ff",
  "--shadow-hairline": "0 0 0 1px rgba(255,255,255,0.06)",
  "--shadow-sm": "0 1px 2px rgba(0,0,0,0.3)",
  "--shadow-md": "0 4px 6px -1px rgba(0,0,0,0.4)",
  "--shadow-lg": "0 10px 15px -3px rgba(0,0,0,0.4)",
  "--nb-color-accent-foreground": "#0c111b",
  "--nb-color-danger": "#f87171",
  "--nb-color-success": "#4ade80",
  "--nb-color-warning": "#fbbf24",
  "--nb-color-processing": "#a78bfa",
  "--nb-color-processing-light": "#1e1b2e",
  "--nb-color-info-light": "#0c1a33",
};

export const TOKENS: Record<Mode, TokenMap> = {
  light: { ...TYPE_SCALE, ...RADII, ...FONTS, ...LIGHT },
  dark: { ...TYPE_SCALE, ...RADII, ...FONTS, ...DARK },
};

/**
 * Demo host theme. In production the NimbleBrain host injects these CSS
 * variables into each app iframe; the library's tokens are `var()` references
 * to them. Here the gallery plays the host: it writes the brand token map onto
 * `:root` so the components render in the real NimbleBrain palette, and the
 * light/dark toggle swaps the map — exercising the var-based theming exactly
 * as a host mode-flip would (no component re-render needed).
 *
 * Values mirror the platform's ext-apps projection (the source of truth lives
 * in `nimblebrain/code`; duplicated here only so the gallery is self-contained).
 */

export type Mode = "light" | "dark";

const SHARED: Record<string, string> = {
  "--font-sans": "'Satoshi', system-ui, sans-serif",
  "--font-mono": "'JetBrains Mono Variable', ui-monospace, SFMono-Regular, monospace",
  "--nb-font-heading": "'Erode', Georgia, serif",
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
  "--border-radius-xs": "0.25rem",
  "--border-radius-sm": "0.5rem",
  "--border-radius-md": "0.75rem",
  "--border-radius-lg": "1rem",
  "--border-radius-xl": "1.5rem",
  "--border-width-regular": "1px",
};

const LIGHT: Record<string, string> = {
  ...SHARED,
  "--color-background-primary": "#faf9f7",
  "--color-background-secondary": "#ffffff",
  "--color-background-tertiary": "#f3f2ef",
  "--color-text-primary": "#171717",
  "--color-text-secondary": "#737373",
  "--color-text-tertiary": "#a3a3a3",
  "--color-text-accent": "#0055FF",
  "--color-border-primary": "#e5e5e5",
  "--color-border-secondary": "#e5e5e5",
  "--color-ring-primary": "#0055FF",
  "--shadow-hairline": "0 0 0 1px rgba(0,0,0,0.06)",
  "--shadow-sm": "0 1px 2px rgba(0,0,0,0.05)",
  "--shadow-md": "0 4px 6px -1px rgba(0,0,0,0.1)",
  "--shadow-lg": "0 10px 15px -3px rgba(0,0,0,0.1)",
  "--nb-color-accent-foreground": "#ffffff",
  "--nb-color-danger": "#dc2626",
  "--nb-color-success": "#059669",
  "--nb-color-warning": "#f59e0b",
  "--nb-color-warm": "#d4620a",
  "--nb-color-warm-light": "#fef5ee",
  "--nb-color-processing": "#7c3aed",
  "--nb-color-processing-light": "#f3eeff",
  "--nb-color-info-light": "#eef4ff",
};

const DARK: Record<string, string> = {
  ...SHARED,
  "--color-background-primary": "#0a0a09",
  "--color-background-secondary": "#141413",
  "--color-background-tertiary": "#1c1c1b",
  "--color-text-primary": "#e5e5e5",
  "--color-text-secondary": "#a3a3a3",
  "--color-text-tertiary": "#737373",
  "--color-text-accent": "#3b8eff",
  "--color-border-primary": "#262626",
  "--color-border-secondary": "#262626",
  "--color-ring-primary": "#3b8eff",
  "--shadow-hairline": "0 0 0 1px rgba(255,255,255,0.06)",
  "--shadow-sm": "0 1px 2px rgba(0,0,0,0.3)",
  "--shadow-md": "0 4px 6px -1px rgba(0,0,0,0.4)",
  "--shadow-lg": "0 10px 15px -3px rgba(0,0,0,0.4)",
  "--nb-color-accent-foreground": "#0a0a09",
  "--nb-color-danger": "#f87171",
  "--nb-color-success": "#34d399",
  "--nb-color-warning": "#fbbf24",
  "--nb-color-warm": "#f59542",
  "--nb-color-warm-light": "#2a1a08",
  "--nb-color-processing": "#a78bfa",
  "--nb-color-processing-light": "#1a0f2e",
  "--nb-color-info-light": "#0c1a33",
};

/** Write the brand token map for `mode` onto `:root`, simulating the host. */
export function applyTheme(mode: Mode): void {
  const root = document.documentElement;
  const map = mode === "dark" ? DARK : LIGHT;
  for (const [key, value] of Object.entries(map)) {
    root.style.setProperty(key, value);
  }
  root.style.colorScheme = mode;
}

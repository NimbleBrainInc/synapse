/**
 * Example themes for the gallery. In production a host injects these CSS
 * variables into each app iframe; the library's tokens are `var()` references
 * to them. Here the gallery plays the host: it writes a theme's token map onto
 * `:root`, and the Theme switcher swaps it — exercising the var-based theming
 * exactly as a host would (no re-render).
 *
 * These four are example/demo themes ONLY, to show that the components bake in
 * no brand and adopt whatever the host injects. `default` is a neutral
 * baseline; `almanac`, `flux`, and `bloom` are three distinct identities.
 * Real host themes live in each host's own codebase, not here and not in the
 * library.
 */

export type Mode = "light" | "dark";
export type ThemeKey = "default" | "almanac" | "flux" | "bloom";

type TokenMap = Record<string, string>;

// The type *scale* (sizes/weights) is held constant so the visible difference
// between themes is identity — color, font family, radius, shadow — not metrics.
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

function preset(parts: {
  fonts: TokenMap;
  radii: TokenMap;
  light: TokenMap;
  dark: TokenMap;
}): Record<Mode, TokenMap> {
  const base = { ...TYPE_SCALE, ...parts.fonts, ...parts.radii };
  return { light: { ...base, ...parts.light }, dark: { ...base, ...parts.dark } };
}

const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";

// ── Default — neutral, unopinionated. System sans, slate grays, blue accent. ──
const DEFAULT = preset({
  fonts: {
    "--font-sans": "system-ui, -apple-system, 'Segoe UI', sans-serif",
    "--nb-font-heading": "system-ui, -apple-system, 'Segoe UI', sans-serif",
    "--font-mono": MONO,
  },
  radii: {
    "--border-radius-xs": "0.25rem",
    "--border-radius-sm": "0.375rem",
    "--border-radius-md": "0.5rem",
    "--border-radius-lg": "0.75rem",
    "--border-radius-xl": "1rem",
  },
  light: {
    "--color-background-primary": "#ffffff",
    "--color-background-secondary": "#f9fafb",
    "--color-background-tertiary": "#f3f4f6",
    "--color-text-primary": "#111827",
    "--color-text-secondary": "#6b7280",
    "--color-text-tertiary": "#9ca3af",
    "--color-text-accent": "#2563eb",
    "--color-border-primary": "#e5e7eb",
    "--color-border-secondary": "#d1d5db",
    "--color-ring-primary": "#2563eb",
    "--shadow-hairline": "0 0 0 1px rgba(0,0,0,0.06)",
    "--shadow-sm": "0 1px 2px rgba(0,0,0,0.05)",
    "--shadow-md": "0 4px 6px -1px rgba(0,0,0,0.1)",
    "--shadow-lg": "0 10px 15px -3px rgba(0,0,0,0.1)",
    "--nb-color-accent-foreground": "#ffffff",
    "--nb-color-danger": "#dc2626",
    "--nb-color-success": "#16a34a",
    "--nb-color-warning": "#d97706",
    "--nb-color-processing": "#7c3aed",
    "--nb-color-processing-light": "#f5f3ff",
    "--nb-color-info-light": "#eff6ff",
  },
  dark: {
    "--color-background-primary": "#0a0a0a",
    "--color-background-secondary": "#161616",
    "--color-background-tertiary": "#1f1f1f",
    "--color-text-primary": "#e5e5e5",
    "--color-text-secondary": "#a3a3a3",
    "--color-text-tertiary": "#737373",
    "--color-text-accent": "#60a5fa",
    "--color-border-primary": "#262626",
    "--color-border-secondary": "#404040",
    "--color-ring-primary": "#60a5fa",
    "--shadow-hairline": "0 0 0 1px rgba(255,255,255,0.06)",
    "--shadow-sm": "0 1px 2px rgba(0,0,0,0.3)",
    "--shadow-md": "0 4px 6px -1px rgba(0,0,0,0.4)",
    "--shadow-lg": "0 10px 15px -3px rgba(0,0,0,0.4)",
    "--nb-color-accent-foreground": "#0a0a0a",
    "--nb-color-danger": "#f87171",
    "--nb-color-success": "#4ade80",
    "--nb-color-warning": "#fbbf24",
    "--nb-color-processing": "#a78bfa",
    "--nb-color-processing-light": "#1e1b2e",
    "--nb-color-info-light": "#0c1a33",
  },
});

// ── Almanac — editorial/literary. Zodiak + Sentient, cream & ink, oxblood. ──
// Near-square corners and flat, inky shadows: it should feel like print.
const ALMANAC = preset({
  fonts: {
    "--font-sans": "'Sentient', Georgia, 'Times New Roman', serif",
    "--nb-font-heading": "'Zodiak', Georgia, serif",
    "--font-mono": MONO,
  },
  radii: {
    "--border-radius-xs": "0.0625rem",
    "--border-radius-sm": "0.125rem",
    "--border-radius-md": "0.1875rem",
    "--border-radius-lg": "0.25rem",
    "--border-radius-xl": "0.375rem",
  },
  light: {
    "--color-background-primary": "#f7f2e8",
    "--color-background-secondary": "#fffdf7",
    "--color-background-tertiary": "#efe7d6",
    "--color-text-primary": "#211b14",
    "--color-text-secondary": "#6c5d4a",
    "--color-text-tertiary": "#a3917a",
    "--color-text-accent": "#8a2b32",
    "--color-border-primary": "#e0d6c2",
    "--color-border-secondary": "#cdbfa6",
    "--color-ring-primary": "#8a2b32",
    "--shadow-hairline": "0 0 0 1px rgba(33,27,20,0.08)",
    "--shadow-sm": "0 1px 1px rgba(33,27,20,0.05)",
    "--shadow-md": "0 2px 4px rgba(33,27,20,0.07)",
    "--shadow-lg": "0 6px 14px rgba(33,27,20,0.09)",
    "--nb-color-accent-foreground": "#fdf8ee",
    "--nb-color-danger": "#a72a25",
    "--nb-color-success": "#5a6e30",
    "--nb-color-warning": "#9a6312",
    "--nb-color-processing": "#6a4a6f",
    "--nb-color-processing-light": "#efe6ef",
    "--nb-color-info-light": "#ece3d2",
  },
  dark: {
    "--color-background-primary": "#17120c",
    "--color-background-secondary": "#211a12",
    "--color-background-tertiary": "#2c2318",
    "--color-text-primary": "#ece2cf",
    "--color-text-secondary": "#b3a288",
    "--color-text-tertiary": "#80715b",
    "--color-text-accent": "#d98890",
    "--color-border-primary": "#352a1d",
    "--color-border-secondary": "#4a3c2a",
    "--color-ring-primary": "#d98890",
    "--shadow-hairline": "0 0 0 1px rgba(0,0,0,0.4)",
    "--shadow-sm": "0 1px 2px rgba(0,0,0,0.35)",
    "--shadow-md": "0 3px 8px rgba(0,0,0,0.45)",
    "--shadow-lg": "0 8px 20px rgba(0,0,0,0.5)",
    "--nb-color-accent-foreground": "#17120c",
    "--nb-color-danger": "#e08a84",
    "--nb-color-success": "#a3b072",
    "--nb-color-warning": "#d3a85e",
    "--nb-color-processing": "#b596b8",
    "--nb-color-processing-light": "#241a26",
    "--nb-color-info-light": "#221a10",
  },
});

// ── Flux — technical/terminal. Clash Display + Cabinet Grotesk, neon green. ──
// Razor-sharp corners; shadows glow rather than fall. Dark is the hero.
const FLUX = preset({
  fonts: {
    "--font-sans": "'Cabinet Grotesk', system-ui, sans-serif",
    "--nb-font-heading": "'Clash Display', system-ui, sans-serif",
    "--font-mono": MONO,
  },
  radii: {
    "--border-radius-xs": "0rem",
    "--border-radius-sm": "0.0625rem",
    "--border-radius-md": "0.125rem",
    "--border-radius-lg": "0.1875rem",
    "--border-radius-xl": "0.25rem",
  },
  light: {
    "--color-background-primary": "#f3f5f2",
    "--color-background-secondary": "#ffffff",
    "--color-background-tertiary": "#e7eae4",
    "--color-text-primary": "#12150f",
    "--color-text-secondary": "#535a4e",
    "--color-text-tertiary": "#878f80",
    "--color-text-accent": "#0a8f4f",
    "--color-border-primary": "#dde2d8",
    "--color-border-secondary": "#c2cabb",
    "--color-ring-primary": "#0a8f4f",
    "--shadow-hairline": "0 0 0 1px rgba(10,143,79,0.18)",
    "--shadow-sm": "0 1px 2px rgba(18,21,15,0.08)",
    "--shadow-md": "0 0 0 1px rgba(10,143,79,0.12), 0 4px 10px rgba(18,21,15,0.08)",
    "--shadow-lg": "0 0 18px rgba(10,143,79,0.12), 0 10px 22px rgba(18,21,15,0.1)",
    "--nb-color-accent-foreground": "#ffffff",
    "--nb-color-danger": "#c81e3a",
    "--nb-color-success": "#0a8f4f",
    "--nb-color-warning": "#b3690a",
    "--nb-color-processing": "#1d6fb8",
    "--nb-color-processing-light": "#e8f1fb",
    "--nb-color-info-light": "#e9f7ef",
  },
  dark: {
    "--color-background-primary": "#07090a",
    "--color-background-secondary": "#0d1113",
    "--color-background-tertiary": "#14191c",
    "--color-text-primary": "#d6e0db",
    "--color-text-secondary": "#7f8c84",
    "--color-text-tertiary": "#515c55",
    "--color-text-accent": "#39ff97",
    "--color-border-primary": "#1a2420",
    "--color-border-secondary": "#2b3a32",
    "--color-ring-primary": "#39ff97",
    "--shadow-hairline": "0 0 0 1px rgba(57,255,151,0.14)",
    "--shadow-sm": "0 0 8px rgba(57,255,151,0.1)",
    "--shadow-md": "0 0 0 1px rgba(57,255,151,0.16), 0 0 16px rgba(57,255,151,0.12)",
    "--shadow-lg": "0 0 28px rgba(57,255,151,0.18)",
    "--nb-color-accent-foreground": "#07090a",
    "--nb-color-danger": "#ff4d6d",
    "--nb-color-success": "#39ff97",
    "--nb-color-warning": "#ffd23f",
    "--nb-color-processing": "#4cc2ff",
    "--nb-color-processing-light": "#07212e",
    "--nb-color-info-light": "#06231a",
  },
});

// ── Bloom — soft/calm. Chillax + Switzer, lavender pastels, violet accent. ──
// Pill-round corners and soft, violet-tinted diffuse shadows.
const BLOOM = preset({
  fonts: {
    "--font-sans": "'Switzer', system-ui, sans-serif",
    "--nb-font-heading": "'Chillax', system-ui, sans-serif",
    "--font-mono": MONO,
  },
  radii: {
    "--border-radius-xs": "0.375rem",
    "--border-radius-sm": "0.625rem",
    "--border-radius-md": "0.875rem",
    "--border-radius-lg": "1.25rem",
    "--border-radius-xl": "1.75rem",
  },
  light: {
    "--color-background-primary": "#faf8ff",
    "--color-background-secondary": "#ffffff",
    "--color-background-tertiary": "#f3eefb",
    "--color-text-primary": "#2c2540",
    "--color-text-secondary": "#6f6685",
    "--color-text-tertiary": "#a59fb8",
    "--color-text-accent": "#7b61ff",
    "--color-border-primary": "#ece6f7",
    "--color-border-secondary": "#d9cff0",
    "--color-ring-primary": "#7b61ff",
    "--shadow-hairline": "0 0 0 1px rgba(44,37,64,0.06)",
    "--shadow-sm": "0 2px 8px rgba(124,92,255,0.08)",
    "--shadow-md": "0 6px 20px rgba(124,92,255,0.1)",
    "--shadow-lg": "0 14px 34px rgba(124,92,255,0.12)",
    "--nb-color-accent-foreground": "#ffffff",
    "--nb-color-danger": "#e26d7a",
    "--nb-color-success": "#4fae8f",
    "--nb-color-warning": "#e0a64e",
    "--nb-color-processing": "#9b7bff",
    "--nb-color-processing-light": "#f1ecff",
    "--nb-color-info-light": "#eef0ff",
  },
  dark: {
    "--color-background-primary": "#161320",
    "--color-background-secondary": "#1f1b2e",
    "--color-background-tertiary": "#29243a",
    "--color-text-primary": "#ece8f7",
    "--color-text-secondary": "#b0a7c8",
    "--color-text-tertiary": "#7d7494",
    "--color-text-accent": "#a48bff",
    "--color-border-primary": "#2e2840",
    "--color-border-secondary": "#423a5c",
    "--color-ring-primary": "#a48bff",
    "--shadow-hairline": "0 0 0 1px rgba(255,255,255,0.05)",
    "--shadow-sm": "0 2px 10px rgba(0,0,0,0.35)",
    "--shadow-md": "0 6px 22px rgba(0,0,0,0.45)",
    "--shadow-lg": "0 14px 36px rgba(0,0,0,0.5)",
    "--nb-color-accent-foreground": "#161320",
    "--nb-color-danger": "#f0909b",
    "--nb-color-success": "#6fccaf",
    "--nb-color-warning": "#f0c074",
    "--nb-color-processing": "#b9a3ff",
    "--nb-color-processing-light": "#241d38",
    "--nb-color-info-light": "#1a1d33",
  },
});

const THEME_MAPS: Record<ThemeKey, Record<Mode, TokenMap>> = {
  default: DEFAULT,
  almanac: ALMANAC,
  flux: FLUX,
  bloom: BLOOM,
};

export const THEMES: { key: ThemeKey; label: string }[] = [
  { key: "default", label: "Default" },
  { key: "almanac", label: "Almanac" },
  { key: "flux", label: "Flux" },
  { key: "bloom", label: "Bloom" },
];

/** Write a theme's token map for `mode` onto `:root`, simulating the host. */
export function applyTheme(theme: ThemeKey, mode: Mode): void {
  const root = document.documentElement;
  const map = THEME_MAPS[theme][mode];
  for (const [key, value] of Object.entries(map)) {
    root.style.setProperty(key, value);
  }
  root.style.colorScheme = mode;
}

/**
 * The style variables both preview hosts (`synapse preview` and the Vite plugin's
 * page) send an app, keyed by theme.
 *
 * The values are the NimbleBrain host's, as it sends them, so an app looks in
 * preview as it will in that host. Every key is one the spec's style-variable enum
 * names: that enum is a strict record, so one extra key makes a spec client reject
 * the whole `ui/initialize` result and refuse to connect. The accent colour has no
 * spec key; the kit's neutral defaults back it, as they back anything a host leaves
 * out.
 */
export const PREVIEW_THEMES: Record<"light" | "dark", Record<string, string>> = {
  dark: {
    "--color-background-primary": "#141414",
    "--color-background-secondary": "#1c1c1c",
    "--color-background-tertiary": "#262626",
    "--color-text-primary": "#ededed",
    "--color-text-secondary": "#a3a3a3",
    "--color-text-tertiary": "#8f8f8f",
    "--color-border-primary": "#2b2b2b",
    "--color-border-secondary": "#2b2b2b",
    "--color-ring-primary": "#799ff5",
    "--color-text-danger": "#f77970",
    "--color-text-success": "#3fbf85",
    "--color-text-warning": "#e0aa3c",
    "--color-background-info": "#283041",
    "--color-text-inverse": "#000000",
    "--border-radius-sm": "0.5rem",
  },
  light: {
    "--color-background-primary": "#ffffff",
    "--color-background-secondary": "#ffffff",
    "--color-background-tertiary": "#f4f4f5",
    "--color-text-primary": "#09090b",
    "--color-text-secondary": "#5c5c66",
    "--color-text-tertiary": "#6b6b73",
    "--color-border-primary": "#e4e4e7",
    "--color-border-secondary": "#e4e4e7",
    "--color-ring-primary": "#315EDB",
    "--color-text-danger": "#c02a24",
    "--color-text-success": "#0f7a4f",
    "--color-text-warning": "#8a5f0a",
    "--color-background-info": "#eaf0ff",
    "--color-text-inverse": "#ffffff",
    "--border-radius-sm": "0.5rem",
  },
};

/**
 * The harness page's own chrome, drawn from the tokens it sends so the app sits on
 * the ground it will have in the host.
 *
 * `color-scheme: normal` on the frame is the scheme of the app's document before it
 * styles itself. A browser paints a frame opaque when the element's scheme differs
 * from its document's, so without it the page's dark scheme would show the frame
 * white until the app paints.
 */
export const PREVIEW_CHROME_CSS = `
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: var(--color-background-primary); color: var(--color-text-primary); }
    header { background: var(--color-background-secondary); border-bottom: 1px solid var(--color-border-primary); display: flex; align-items: center; }
    header .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--color-text-success); }
    header button { background: var(--color-background-tertiary); border: 1px solid var(--color-border-primary); color: var(--color-text-primary); border-radius: 4px; cursor: pointer; font-size: 12px; }
    iframe { width: 100%; border: none; color-scheme: normal; }`;

/**
 * Script that defines `applyTheme(dark)`: it paints the harness page in that theme
 * and returns the variables to send. Inlined into each preview page.
 */
export const PREVIEW_APPLY_THEME_JS = `
    var THEMES = ${JSON.stringify(PREVIEW_THEMES)};
    function applyTheme(dark) {
      var vars = THEMES[dark ? "dark" : "light"];
      var root = document.documentElement;
      root.style.colorScheme = dark ? "dark" : "light";
      for (var key in vars) root.style.setProperty(key, vars[key]);
      return vars;
    }`;

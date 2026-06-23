import { describe, expect, it } from "vitest";
import { DEFAULT_THEME_VARS } from "../../theme-defaults.js";
import { headingStyle, textStyle, tokens } from "../../ui/tokens.js";

/** Pull the `--var-name` out of a `var(--name, fallback)` reference. */
function referencedVar(value: string): string | null {
  const m = value.match(/^var\(\s*(--[a-zA-Z0-9-]+)\s*,/);
  return m ? m[1] : null;
}

describe("token contract", () => {
  it("exposes tokens as host CSS var() references, not raw brand hex", () => {
    // Every color/font token must be a var() so the host's injected value wins
    // and light/dark resolve in CSS without a re-render.
    for (const value of Object.values(tokens)) {
      expect(value.startsWith("var(--")).toBe(true);
    }
  });

  it("uses NEUTRAL fallbacks, not NimbleBrain brand", () => {
    // The library is host-agnostic: brand arrives by injection. A standalone
    // render must fall back to neutral values, never the brand palette.
    expect(tokens.accent).toBe("var(--color-text-accent, #2563eb)"); // neutral blue, not brand #0055FF
    expect(tokens.fg).toBe("var(--color-text-primary, #111827)");
    expect(tokens.fontSans).toContain("system-ui"); // not 'Satoshi'
    expect(tokens.fontSans).not.toContain("Satoshi");
    expect(tokens.fontHeading).toContain("Georgia"); // serif fallback, not 'Erode'
    expect(tokens.fontHeading).not.toContain("Erode");
  });

  it("maps the type scale to the matching size + line-height vars", () => {
    expect(textStyle("sm")).toEqual({
      fontSize: "var(--font-text-sm-size, 0.875rem)",
      lineHeight: "var(--font-text-sm-line-height, 1.25rem)",
    });
    expect(headingStyle("lg")).toEqual({
      fontSize: "var(--font-heading-lg-size, 2rem)",
      lineHeight: "var(--font-heading-lg-line-height, 2.5rem)",
    });
  });
});

describe("default theme backs the token contract", () => {
  const referenced = Object.values(tokens)
    .map(referencedVar)
    .filter((v): v is string => v !== null);

  // Vars that look identical in light and dark — their static var() fallback is
  // already correct, so they are intentionally NOT in DEFAULT_THEME_VARS. Listed
  // explicitly (not inferred from the name) so the partition below is TOTAL: any
  // referenced var that is neither declared invariant here nor backed in both
  // modes fails the guard, forcing a conscious light/dark decision — even for a
  // future theme-sensitive var whose name doesn't happen to contain "color".
  const THEME_INVARIANT_VARS = new Set<string>([
    "--font-sans",
    "--font-mono",
    "--nb-font-heading",
    "--font-weight-normal",
    "--font-weight-medium",
    "--font-weight-semibold",
    "--font-weight-bold",
    "--font-text-xs-size",
    "--font-text-xs-line-height",
    "--font-text-sm-size",
    "--font-text-sm-line-height",
    "--font-text-base-size",
    "--font-text-base-line-height",
    "--font-text-lg-size",
    "--font-text-lg-line-height",
    "--font-heading-sm-size",
    "--font-heading-sm-line-height",
    "--font-heading-md-size",
    "--font-heading-md-line-height",
    "--font-heading-lg-size",
    "--font-heading-lg-line-height",
    "--border-radius-xs",
    "--border-radius-sm",
    "--border-radius-md",
    "--border-radius-lg",
    "--border-radius-xl",
    "--border-width-regular",
    "--shadow-hairline",
    "--shadow-sm",
    "--shadow-md",
    "--shadow-lg",
  ]);

  // Theme-sensitive = referenced but not declared invariant. These MUST be
  // backed in both modes.
  const themeSensitive = referenced.filter((v) => !THEME_INVARIANT_VARS.has(v));

  it("backs every theme-sensitive var the token contract references in BOTH light and dark", () => {
    // The regression guard. A `var()` fallback is a static literal that fires
    // exactly when the var is unset — the moment there's no theme signal to
    // branch on — so an unbacked theme-sensitive token resolves to its light
    // fallback in dark mode (white-on-white). This fails the instant someone
    // adds such a token whose var nothing backs, instead of shipping it inert.
    expect(themeSensitive.length).toBeGreaterThan(0);
    for (const v of themeSensitive) {
      expect(Object.keys(DEFAULT_THEME_VARS.light), `light missing ${v}`).toContain(v);
      expect(Object.keys(DEFAULT_THEME_VARS.dark), `dark missing ${v}`).toContain(v);
    }
  });

  it("declares no stale invariant vars — every one is actually referenced", () => {
    // Keeps THEME_INVARIANT_VARS honest: an entry no token references is dead
    // and would silently shrink what the guard above covers.
    const referencedSet = new Set(referenced);
    for (const v of THEME_INVARIANT_VARS) {
      expect(referencedSet.has(v), `stale invariant entry ${v}`).toBe(true);
    }
  });

  it("light and dark define the same set of vars", () => {
    expect(Object.keys(DEFAULT_THEME_VARS.light).sort()).toEqual(
      Object.keys(DEFAULT_THEME_VARS.dark).sort(),
    );
  });

  it("ships no dead defaults — every default var is referenced by a token", () => {
    const referencedSet = new Set(referenced);
    for (const v of Object.keys(DEFAULT_THEME_VARS.light)) {
      expect(referencedSet.has(v), `unreferenced default ${v}`).toBe(true);
    }
  });

  it("light defaults equal the token fallbacks (no light-mode regression)", () => {
    // The light layer must reproduce each backed token's baked fallback, so
    // introducing the default layer changes nothing observable in light mode.
    for (const value of Object.values(tokens)) {
      const v = referencedVar(value);
      if (!v || THEME_INVARIANT_VARS.has(v)) continue;
      const fallback = value.slice(value.indexOf(",") + 1, -1).trim();
      expect(DEFAULT_THEME_VARS.light[v]).toBe(fallback);
    }
  });
});

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
    // Headings fall back to the same sans stack as body: one family, with
    // hierarchy from weight and size. A serif heading fallback would reproduce
    // the display-serif signature on any host that injects nothing.
    expect(tokens.fontHeading).toContain("system-ui");
    expect(tokens.fontHeading).not.toContain("Erode");
  });

  it("backs every default with an unbranded value, never a brand hex", () => {
    // The font side got a guard in 0.13.0 when a brand stylesheet import was
    // removed; the colour side got none, which is how #d4620a — the warm accent
    // from a NimbleBrain brand generation — sat across two releases in *both*
    // unbranded-default maps, each under a docblock claiming otherwise.
    //
    // Both are checked here, because both are that claim: DEFAULT_THEME_VARS is
    // the block the SDK injects, and `tokens` holds the `var()` fallback each
    // component resolves against when a host declares nothing. A guard on one
    // leaves the other free to reintroduce exactly what this test exists to
    // catch.
    //
    // An allowlist rather than a denylist: the map is small and hand-authored,
    // so the sanctioned set can be stated outright. A denylist only catches the
    // brand values someone thought to name, which is how the last one got in.
    //
    // ADMISSION RULE, so this stays a guard and does not decay into a list to
    // append to: a hex qualifies when it was not *chosen for a brand*. In
    // practice every hue below is a stock Tailwind ramp step — blue-600,
    // red-600/400, emerald-600/400, amber-500/400, violet-600/400, indigo-400 —
    // and every `*-light` ground is a neutral tint of one of them. The test is
    // not "no brand uses this hue", which nothing could pass: #7c3aed is
    // violet-600 off the shelf and a brand happens to use it too. #d4620a fails
    // because it is bespoke and brand-tuned, picked to be one product's warm
    // accent and nothing else's. If a candidate is not a stock ramp step or a
    // tint of one, it does not belong here — take it to the host instead.
    const SANCTIONED = new Set(
      [
        // Neutral ladder — surfaces, text, borders.
        "#ffffff",
        "#fafafa",
        "#f3f4f6",
        "#111827",
        "#6b7280",
        "#9ca3af",
        "#e5e7eb",
        "#d1d5db",
        "#18181b",
        "#27272a",
        "#2f2f34",
        "#a1a1aa",
        "#71717a",
        "#3f3f46",
        "#52525b",
        // A generic blue, and the generic semantic hues.
        "#2563eb",
        "#818cf8",
        "#dc2626",
        "#f87171",
        "#059669",
        "#34d399",
        "#f59e0b",
        "#fbbf24",
        "#7c3aed",
        "#a78bfa",
        // Tints those hues are laid on.
        "#f3eeff",
        "#2a2440",
        "#eef4ff",
        "#1e2a44",
      ].map((h) => h.toLowerCase()),
    );

    for (const mode of ["light", "dark"] as const) {
      for (const [name, value] of Object.entries(DEFAULT_THEME_VARS[mode])) {
        // Notation first, membership second. Scanning a value for hexes and
        // checking only what turns up leaves every other CSS colour syntax
        // unguarded — `rgb(212, 98, 10)` is byte-for-byte #d4620a and passed
        // this whole file. Requiring a hex literal is what makes the
        // membership check below total.
        expect(value, `${mode} ${name}: expected a hex literal`).toMatch(/^#[0-9a-f]{3,8}$/i);
        for (const hex of value.toLowerCase().match(/#[0-9a-f]{3,8}/g) ?? []) {
          expect(SANCTIONED.has(hex), `${mode} ${name}: ${hex} is not a sanctioned neutral`).toBe(
            true,
          );
        }
      }
    }

    // No anchor here, and the extracting loop is load-bearing for it: these
    // values are `var(--token, <fallback>)` strings, not bare hexes, and the
    // non-colour ones (font stacks, radii, weights) carry no hex at all and
    // simply contribute nothing to check.
    for (const [name, value] of Object.entries(tokens)) {
      for (const hex of value.toLowerCase().match(/#[0-9a-f]{3,8}/g) ?? []) {
        expect(SANCTIONED.has(hex), `tokens.${name}: ${hex} is not a sanctioned neutral`).toBe(
          true,
        );
      }
    }
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

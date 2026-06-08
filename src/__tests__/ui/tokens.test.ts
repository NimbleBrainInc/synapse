import { describe, expect, it } from "vitest";
import { headingStyle, textStyle, tokens } from "../../ui/tokens.js";

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

/**
 * A default has to lose.
 *
 * `applyThemeVariables` has always documented the neutral map as a fallback —
 * "the host's values win for the keys it provides, and any var it omits still
 * resolves to a theme-correct neutral default". It applied that map to
 * `documentElement.style`, the inline attribute, which outranks every author
 * stylesheet. So it only behaved as documented for vars the host delivered
 * through the protocol; for anything the host declared in a stylesheet it
 * injected into the app document, the default won and there was no self-heal.
 *
 * That case is not exotic. `hostContext.styles.variables` is a closed enum, so
 * any host whose design system is larger than the enum has to deliver the
 * remainder as a stylesheet — that is the only channel available to it.
 *
 * These tests pin the property rather than the mechanism: whatever the map grows
 * to, nothing in it may be applied in a way that outranks a declaration.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  applyThemeVariables,
  DEFAULT_THEME_VARS,
  DEFAULTS_LAYER_NAME,
  DEFAULTS_STYLE_ID,
} from "../theme-defaults.js";

/** A key the neutral map backs, used as the subject of "can it be overridden". */
function someDefaultedKey(mode: "light" | "dark"): string {
  const [key] = Object.keys(DEFAULT_THEME_VARS[mode]);
  if (!key) throw new Error("DEFAULT_THEME_VARS is empty — nothing to assert");
  return key;
}

beforeEach(() => {
  document.getElementById(DEFAULTS_STYLE_ID)?.remove();
  document.documentElement.removeAttribute("style");
});

describe("the neutral default theme is a fallback, not an override", () => {
  it("applies no default as an inline property", () => {
    // Inline is the one place a default must never go: it beats a host's or an
    // app's stylesheet, so a var the host declares outside the protocol would
    // be permanently replaced by ours.
    applyThemeVariables("light", null);

    const inlined = Object.keys(DEFAULT_THEME_VARS.light).filter(
      (k) => document.documentElement.style.getPropertyValue(k) !== "",
    );
    expect(inlined).toEqual([]);
  });

  it("puts the defaults in a cascade layer, which any unlayered rule outranks", () => {
    applyThemeVariables("light", null);

    const el = document.getElementById(DEFAULTS_STYLE_ID);
    expect(el, "no default-theme style element was installed").not.toBeNull();
    const css = el?.textContent ?? "";
    expect(css).toContain(`@layer ${DEFAULTS_LAYER_NAME}`);
    expect(css).toContain(someDefaultedKey("light"));
  });

  it("still puts the host's variables inline, so they win", () => {
    const key = someDefaultedKey("light");
    applyThemeVariables("light", { [key]: "#abcdef" });

    expect(document.documentElement.style.getPropertyValue(key)).toBe("#abcdef");
  });

  it("swaps the whole map on a mode flip rather than accumulating", () => {
    applyThemeVariables("light", null);
    const light = document.getElementById(DEFAULTS_STYLE_ID)?.textContent ?? "";
    applyThemeVariables("dark", null);
    const dark = document.getElementById(DEFAULTS_STYLE_ID)?.textContent ?? "";

    expect(dark).not.toBe(light);
    // One element, replaced — not a second block layered over the first.
    expect(document.querySelectorAll(`#${DEFAULTS_STYLE_ID}`).length).toBe(1);
    expect(dark).toContain(`@layer ${DEFAULTS_LAYER_NAME}`);
  });

  it("is idempotent — re-applying the same mode installs one element", () => {
    applyThemeVariables("dark", null);
    applyThemeVariables("dark", null);
    applyThemeVariables("dark", null);

    expect(document.querySelectorAll("style").length).toBe(1);
  });

  it("does not throw when the document has no head", () => {
    // Some minimal test DOMs expose `documentElement` but no `head`.
    const head = document.head;
    Object.defineProperty(document, "head", { value: null, configurable: true });
    try {
      expect(() => applyThemeVariables("light", null)).not.toThrow();
    } finally {
      Object.defineProperty(document, "head", { value: head, configurable: true });
    }
  });
});

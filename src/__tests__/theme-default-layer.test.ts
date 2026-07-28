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
 * These tests assert the MECHANISM — that the defaults land in a layer and that
 * nothing in the map is written inline — not the cascade outcome. happy-dom does
 * not compute cascade layers, so "unlayered beats layered" cannot be observed
 * here; a green suite is not evidence of it. That half is verified by hand in a
 * real browser (Chrome 148, recorded on the PR): with the layer, a host's
 * injected `:root` and an app's own `:root` both win, and an undeclared var still
 * resolves to the neutral default in both modes.
 *
 * The mechanism is nonetheless the right thing to pin, because it is the part a
 * future edit can silently reverse: put one default back inline and the cascade
 * outcome changes everywhere at once.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  applyThemeVariables,
  DEFAULT_THEME_VARS,
  DEFAULTS_LAYER_NAME,
  DEFAULTS_STYLE_ID,
  resetAppliedInlineKeys,
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
  resetAppliedInlineKeys();
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

    expect(document.querySelectorAll(`#${DEFAULTS_STYLE_ID}`).length).toBe(1);
  });
});

describe("a narrowed var set does not leave the previous one pinned inline", () => {
  // An ext-apps `host-context-changed` carries only the fields that changed, so a
  // notification that flips mode while omitting `styles` reaches
  // `applyThemeVariables` as an empty var set. Writing the defaults inline used to
  // mask this by rewriting every defaulted key on every call; a layer cannot,
  // because it can't outrank an inline property.
  it("clears a defaulted key the new set omits, so the layer resolves it", () => {
    applyThemeVariables("light", {
      "--color-background-primary": "#ffffff",
      "--color-text-primary": "#111827",
    });
    expect(document.documentElement.style.getPropertyValue("--color-background-primary")).toBe(
      "#ffffff",
    );

    applyThemeVariables("dark", {});

    // Nothing of the light palette may remain pinned — half-light/half-dark is
    // worse than either, and put `--color-text-secondary` on a retained white
    // background at 2.56:1, under WCAG AA.
    for (const key of Object.keys(DEFAULT_THEME_VARS.dark)) {
      expect(
        document.documentElement.style.getPropertyValue(key),
        `${key} is still pinned inline from the previous theme`,
      ).toBe("");
    }
  });

  it("keeps a key the new set still carries", () => {
    applyThemeVariables("light", { "--color-text-primary": "#111827" });
    applyThemeVariables("dark", { "--color-text-primary": "#fafafa" });

    expect(document.documentElement.style.getPropertyValue("--color-text-primary")).toBe("#fafafa");
  });

  it("clears a key with no neutral default too — tracked by what was written", () => {
    // `--font-sans` has no entry in the neutral map, and ~25 theme-sensitive
    // spec-enum vars (`--color-text-danger`, `--color-background-inverse`, …)
    // don't either. Keying the removal off `DEFAULT_THEME_VARS` would pin exactly
    // those at the previous mode's value, so it is keyed off what was written.
    applyThemeVariables("light", { "--font-sans": "'Brand', sans-serif" });
    applyThemeVariables("dark", {});

    expect(document.documentElement.style.getPropertyValue("--font-sans")).toBe("");
  });

  it("never clears an inline property the app set itself", () => {
    // Tracking our own writes means an app driving `documentElement.style`
    // directly is left alone — the previous key set was the neutral map, which
    // would have removed this.
    document.documentElement.style.setProperty("--color-text-accent", "#ff00ff");
    applyThemeVariables("dark", {});

    expect(document.documentElement.style.getPropertyValue("--color-text-accent")).toBe("#ff00ff");
  });

  it("clears a defaulted key whose new value is not a usable string", () => {
    // Wire data is untyped. A non-string value is not a provided value, so it must
    // reach the clear loop rather than falling between the two: `k in hostVars`
    // would skip the removal while `typeof v === "string"` skips the write, and
    // the previous theme's value would stay pinned inline.
    applyThemeVariables("light", { "--color-text-primary": "#111827" });
    applyThemeVariables("dark", { "--color-text-primary": 42 as unknown as string });

    expect(document.documentElement.style.getPropertyValue("--color-text-primary")).toBe("");
  });
});

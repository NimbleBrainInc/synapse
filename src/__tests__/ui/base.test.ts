import { afterEach, beforeEach, describe, expect, it } from "vitest";
// Importing the side-effect entry runs `injectBaseReset()` once at load — the
// re-exported function is what we exercise per-test.
import { injectBaseReset } from "../../ui/base.js";

const STYLE_ID = "nb-synapse-base";

describe("injectBaseReset", () => {
  beforeEach(() => {
    document.getElementById(STYLE_ID)?.remove();
  });
  afterEach(() => {
    document.getElementById(STYLE_ID)?.remove();
  });

  it("supplies the root-height chain and removes the body margin", () => {
    injectBaseReset();
    const el = document.getElementById(STYLE_ID);
    expect(el).not.toBeNull();
    // The fix is a percentage chain, not a viewport unit — guard against a
    // regression back to vh/dvh, which overflows panes shorter than the viewport.
    expect(el?.textContent).toContain("html, body, #root");
    expect(el?.textContent).toContain("height: 100%");
    expect(el?.textContent).toContain("margin: 0");
    expect(el?.textContent).not.toMatch(/dvh|vh/);
  });

  it("is idempotent — injecting twice yields a single style element", () => {
    injectBaseReset();
    injectBaseReset();
    expect(document.querySelectorAll(`#${STYLE_ID}`)).toHaveLength(1);
  });
});

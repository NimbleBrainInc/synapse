import { afterEach, describe, expect, it } from "vitest";

import { previewHostHtml } from "../../preview/server";
import { PREVIEW_APPLY_THEME_JS, PREVIEW_CHROME_CSS, PREVIEW_THEMES } from "../../preview/themes";
import { vitePreviewHostHtml } from "../../vite/plugin";

/**
 * The theme both preview pages paint themselves in and send the app.
 *
 * The page wears the variables it sends, so an app sits on the ground it will
 * have in the host. Assertions read custom properties and stylesheet text, not
 * computed colours, which happy-dom does not resolve from `var()`.
 */
type ApplyTheme = (dark: boolean) => Record<string, string>;
const applyTheme = new Function(`${PREVIEW_APPLY_THEME_JS}\nreturn applyTheme;`)() as ApplyTheme;

function rootVariables(keys: string[]): Record<string, string> {
  const style = document.documentElement.style;
  return Object.fromEntries(keys.map((key) => [key, style.getPropertyValue(key)]));
}

describe("applyTheme", () => {
  afterEach(() => {
    document.documentElement.removeAttribute("style");
  });

  it("paints the page in the variables it returns, through each toggle", () => {
    for (const dark of [true, false, true]) {
      const sent = applyTheme(dark);
      expect(sent).toEqual(PREVIEW_THEMES[dark ? "dark" : "light"]);
      expect(rootVariables(Object.keys(sent))).toEqual(sent);
      expect(document.documentElement.style.colorScheme).toBe(dark ? "dark" : "light");
    }
  });
});

describe.each([
  ["synapse preview", previewHostHtml(5173, 8001)],
  ["vite preview", vitePreviewHostHtml("hello")],
])("%s page", (_name, html) => {
  it("inlines the shared theme script and chrome", () => {
    expect(html).toContain(PREVIEW_APPLY_THEME_JS);
    expect(html).toContain(PREVIEW_CHROME_CSS);
  });

  it("keeps the frame's scheme its own, so a dark page does not paint it white", () => {
    expect(html).toMatch(/iframe \{[^}]*color-scheme: normal;/);
  });

  it("applies the theme on load and on toggle", () => {
    expect(html.match(/applyTheme\((darkMode|dark|d)\)/g)?.length).toBeGreaterThanOrEqual(2);
  });
});

import type { McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import { describe, expect, it } from "vitest";
import { extractTheme } from "../detection";

describe("extractTheme", () => {
  it("extracts theme from a spec-shaped hostContext", () => {
    const theme = extractTheme({
      theme: "dark",
      styles: {
        variables: { "--color-background-primary": "#111" },
      },
    });

    expect(theme.mode).toBe("dark");
    expect(theme.tokens).toEqual({ "--color-background-primary": "#111" });
  });

  it("falls back to the default theme when hostContext is undefined", () => {
    const theme = extractTheme(undefined);

    expect(theme.mode).toBe("light");
    expect(theme.tokens).toEqual({});
  });

  it("falls back to empty tokens when styles.variables is missing", () => {
    const theme = extractTheme({ theme: "dark" } as McpUiHostContext);

    expect(theme.mode).toBe("dark");
    expect(theme.tokens).toEqual({});
  });

  it("uses default mode when hostContext has no theme key", () => {
    const theme = extractTheme({} as McpUiHostContext);

    expect(theme.mode).toBe("light");
  });

  it("ignores invalid theme mode values", () => {
    const theme = extractTheme({ theme: "sepia" as unknown as "light" });

    expect(theme.mode).toBe("light");
  });
});

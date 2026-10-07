import type { McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import { describe, expect, it } from "vitest";
import { extractTheme, HOST_STYLES_EXTENSION } from "../detection";

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

  it("adds the ai.nimblebrain/styles variables to the spec's", () => {
    const theme = extractTheme({
      theme: "dark",
      styles: { variables: { "--color-background-primary": "#111" } },
      [HOST_STYLES_EXTENSION]: { variables: { "--color-text-accent": "#6a8fe4" } },
    } as McpUiHostContext);

    expect(theme.tokens).toEqual({
      "--color-background-primary": "#111",
      "--color-text-accent": "#6a8fe4",
    });
  });

  it("reads the extension when the context carries no spec variables", () => {
    const theme = extractTheme({
      theme: "light",
      [HOST_STYLES_EXTENSION]: { variables: { "--nb-color-processing": "#6d3ecf" } },
    } as McpUiHostContext);

    expect(theme.tokens).toEqual({ "--nb-color-processing": "#6d3ecf" });
  });

  it("lets the spec's value win on a key both carry", () => {
    const theme = extractTheme({
      styles: { variables: { "--color-text-primary": "#000" } },
      [HOST_STYLES_EXTENSION]: { variables: { "--color-text-primary": "#f00" } },
    } as McpUiHostContext);

    expect(theme.tokens["--color-text-primary"]).toBe("#000");
  });

  it("ignores an extension that is not a { variables } record", () => {
    const theme = extractTheme({
      [HOST_STYLES_EXTENSION]: { variables: ["--x"] },
    } as unknown as McpUiHostContext);

    expect(theme.tokens).toEqual({});
  });
});

import type { McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import type { Theme } from "./types";

const DEFAULT_THEME: Theme = {
  mode: "light",
  tokens: {},
};

export function extractTheme(ctx: Partial<McpUiHostContext> | undefined): Theme {
  if (!ctx) return { ...DEFAULT_THEME };

  // Spec: theme is a string ("light" | "dark")
  const mode = ctx.theme === "light" || ctx.theme === "dark" ? ctx.theme : DEFAULT_THEME.mode;

  // Spec: tokens live under styles.variables
  const variables = ctx.styles?.variables;
  const tokens =
    variables && typeof variables === "object" && !Array.isArray(variables)
      ? (variables as Record<string, string>)
      : {};

  return { mode, tokens };
}

/**
 * The host's `@font-face` CSS, from the spec's `styles.css.fonts`, or
 * `undefined` when this context carries none.
 */
export function extractHostFontCss(ctx: Partial<McpUiHostContext> | undefined): string | undefined {
  const fonts = ctx?.styles?.css?.fonts;
  return typeof fonts === "string" && fonts !== "" ? fonts : undefined;
}

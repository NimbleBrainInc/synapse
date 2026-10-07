import type { McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import type { Theme } from "./types";

const DEFAULT_THEME: Theme = {
  mode: "light",
  tokens: {},
};

/**
 * Host-context key under which a NimbleBrain host sends the theme variables the
 * spec's `styles.variables` enum has no key for and whose value changes with the
 * mode (the accent text and the processing pair), as `{ variables }`.
 *
 * It is a top-level key because the spec's host context keeps unknown top-level
 * keys while `styles` has a fixed shape, and `styles.variables` is a closed
 * enum a strict client rejects the whole context over. The host sends it on the
 * handshake and on every `host-context-changed`, so these variables follow a
 * theme toggle like the spec's.
 */
export const HOST_STYLES_EXTENSION = "ai.nimblebrain/styles";

/** A `{ variables }` record's variables, or `undefined` when it has none. */
function variablesOf(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const variables = (value as { variables?: unknown }).variables;
  return variables && typeof variables === "object" && !Array.isArray(variables)
    ? (variables as Record<string, string>)
    : undefined;
}

/**
 * Every theme variable a host context carries: the spec's `styles.variables`
 * and the `ai.nimblebrain/styles` extension's, or `undefined` when it carries
 * neither. On a key in both, the spec's value wins.
 */
export function extractHostVariables(
  ctx: Partial<McpUiHostContext> | Record<string, unknown> | undefined,
): Record<string, string> | undefined {
  if (!ctx) return undefined;
  const spec = variablesOf((ctx as { styles?: unknown }).styles);
  const ext = variablesOf((ctx as Record<string, unknown>)[HOST_STYLES_EXTENSION]);
  if (!spec && !ext) return undefined;
  return { ...ext, ...spec };
}

export function extractTheme(ctx: Partial<McpUiHostContext> | undefined): Theme {
  if (!ctx) return { ...DEFAULT_THEME };

  // Spec: theme is a string ("light" | "dark")
  const mode = ctx.theme === "light" || ctx.theme === "dark" ? ctx.theme : DEFAULT_THEME.mode;

  // Spec: tokens live under styles.variables; a NimbleBrain host adds the
  // mode-varying ones the spec has no key for under `ai.nimblebrain/styles`.
  return { mode, tokens: extractHostVariables(ctx) ?? {} };
}

/**
 * The host's `@font-face` CSS, from the spec's `styles.css.fonts`, or
 * `undefined` when this context carries none.
 */
export function extractHostFontCss(ctx: Partial<McpUiHostContext> | undefined): string | undefined {
  const fonts = ctx?.styles?.css?.fonts;
  return typeof fonts === "string" && fonts !== "" ? fonts : undefined;
}

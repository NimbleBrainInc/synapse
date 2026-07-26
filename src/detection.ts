import type { McpUiHostContext, McpUiInitializeResult } from "@modelcontextprotocol/ext-apps";
import type { FontFaceDescriptor, HostInfo, SynapseTheme } from "./types";

/**
 * Host-context key carrying `@font-face` descriptors.
 *
 * A NimbleBrain extension (`synapse/` prefix), because the ext-apps spec has no
 * equivalent: `styles.variables` is a flat `Record<McpUiStyleVariableKey, string>`
 * that can name a font family but cannot carry the rule that loads it.
 * `McpUiHostContext` declares `[key: string]: unknown` for forward
 * compatibility, so riding an extra key is spec-legal, and hosts that don't send
 * it degrade to the web-safe token fallbacks.
 */
export const FONT_FACES_CONTEXT_KEY = "synapse/fontFaces";

const DEFAULT_THEME: SynapseTheme = {
  mode: "light",
  primaryColor: "#6366f1",
  tokens: {},
};

/**
 * Detect the host environment from the ext-apps `ui/initialize` response.
 *
 * Reports identity only (host name, protocol version). Theme lives in the
 * unified host-context state and is read via `extractTheme(hostContext)`
 * — no parallel `theme` field on `HostInfo`.
 *
 * Handles missing or malformed fields gracefully — never throws.
 */
export function detectHost(initResponse: unknown): HostInfo {
  const resp = initResponse as Partial<McpUiInitializeResult> | null | undefined;

  const hostName = resp?.hostInfo?.name ?? "unknown";
  const protocolVersion = resp?.protocolVersion ?? "unknown";

  return {
    isNimbleBrain: hostName === "nimblebrain",
    serverName: hostName,
    protocolVersion,
  };
}

export function extractTheme(ctx: Partial<McpUiHostContext> | undefined): SynapseTheme {
  if (!ctx) return { ...DEFAULT_THEME };

  // Spec: theme is a string ("light" | "dark")
  const mode = ctx.theme === "light" || ctx.theme === "dark" ? ctx.theme : DEFAULT_THEME.mode;

  // Spec: tokens live under styles.variables
  const variables = ctx.styles?.variables;
  const tokens =
    variables && typeof variables === "object" && !Array.isArray(variables)
      ? (variables as Record<string, string>)
      : {};

  const fontFaces = extractFontFaces(ctx);

  return {
    mode,
    primaryColor: DEFAULT_THEME.primaryColor,
    tokens,
    ...(fontFaces ? { fontFaces } : {}),
  };
}

/**
 * Read the `synapse/fontFaces` host-context extension.
 *
 * Returns `undefined` when the host sends nothing, and drops individual entries
 * that aren't well-formed rather than rejecting the batch — one malformed face
 * must not cost the app the rest of its typography. Anything that survives is
 * still validated by the browser when the descriptor is constructed.
 */
export function extractFontFaces(
  ctx: Partial<McpUiHostContext> | undefined,
): FontFaceDescriptor[] | undefined {
  const raw = ctx?.[FONT_FACES_CONTEXT_KEY];
  if (!Array.isArray(raw)) return undefined;

  const faces = raw.filter(
    (entry): entry is FontFaceDescriptor =>
      !!entry &&
      typeof entry === "object" &&
      typeof (entry as FontFaceDescriptor).family === "string" &&
      typeof (entry as FontFaceDescriptor).src === "string",
  );

  return faces.length > 0 ? faces : undefined;
}

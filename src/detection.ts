import type { McpUiHostContext, McpUiInitializeResult } from "@modelcontextprotocol/ext-apps";
import { normalizeFontFaces } from "./theme-defaults.js";
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

  // Deliberately no `fontFaces` here. Faces are sticky across a partial context
  // (see `foldFontFaces`), and this function sees only the context in hand — so
  // populating the field would publish a NON-sticky value on the return type and
  // invite `extractTheme(ctx).fontFaces`, which is the unload-on-toggle bug.
  // `resolveTheme` overlays the sticky set; nothing else should.
  return { mode, primaryColor: DEFAULT_THEME.primaryColor, tokens };
}

/**
 * Read the `synapse/fontFaces` host-context extension.
 *
 * `undefined` and `[]` are **distinct answers**, because a host-context-changed
 * carries only the fields that changed:
 *   - `undefined` — the host said nothing about fonts, so keep what's loaded.
 *   - `[]` — the host explicitly sent an empty list, i.e. drop the faces.
 * Collapsing the two would leave a host no way to clear typography it had
 * previously set.
 *
 * Individual malformed entries are dropped rather than rejecting the batch —
 * one bad face must not cost the app the rest of its typography. Anything that
 * survives is still validated by the browser when the descriptor is built.
 */
export function extractFontFaces(
  ctx: Partial<McpUiHostContext> | undefined,
): FontFaceDescriptor[] | undefined {
  return normalizeFontFaces(ctx?.[FONT_FACES_CONTEXT_KEY]);
}

/**
 * THE rule for merging incoming faces over what is already loaded, in one
 * place: **absent — or a batch with nothing usable — means unchanged; an
 * explicit list, including empty, replaces.**
 *
 * Every consumer of the host-context font extension folds through here. The
 * rule leaked one layer at a time when each site spelled it itself, so the
 * spelling now lives once and the call sites just call it.
 */
export function foldFontFaces(
  prev: FontFaceDescriptor[] | undefined,
  ctx: Partial<McpUiHostContext> | undefined,
): FontFaceDescriptor[] | undefined {
  return extractFontFaces(ctx) ?? prev;
}

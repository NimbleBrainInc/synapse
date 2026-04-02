import type { McpUiHostContext, McpUiInitializeResult } from "@modelcontextprotocol/ext-apps";
import type { HostInfo, SynapseTheme } from "./types";

const DEFAULT_THEME: SynapseTheme = {
  mode: "light",
  primaryColor: "#6366f1",
  tokens: {},
};

/**
 * Detect the host environment from the ext-apps `ui/initialize` response.
 *
 * Uses spec field names (hostInfo, hostContext.theme as string, styles.variables).
 * Handles missing or malformed fields gracefully — never throws.
 */
export function detectHost(initResponse: unknown): HostInfo {
  const resp = initResponse as Partial<McpUiInitializeResult> | null | undefined;

  const hostName = resp?.hostInfo?.name ?? "unknown";
  const protocolVersion = resp?.protocolVersion ?? "unknown";
  const ctx = resp?.hostContext as Partial<McpUiHostContext> | undefined;
  const theme = extractTheme(ctx);

  return {
    isNimbleBrain: hostName === "nimblebrain",
    serverName: hostName,
    protocolVersion,
    theme,
  };
}

function extractTheme(ctx: Partial<McpUiHostContext> | undefined): SynapseTheme {
  if (!ctx) return { ...DEFAULT_THEME };

  // Spec: theme is a string ("light" | "dark")
  const mode = ctx.theme === "light" || ctx.theme === "dark" ? ctx.theme : DEFAULT_THEME.mode;

  // Spec: tokens live under styles.variables
  const variables = ctx.styles?.variables;
  const tokens =
    variables && typeof variables === "object" && !Array.isArray(variables)
      ? (variables as Record<string, string>)
      : {};

  return { mode, primaryColor: DEFAULT_THEME.primaryColor, tokens };
}

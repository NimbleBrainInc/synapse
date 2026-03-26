import type { HostInfo, SynapseTheme } from "./types";

const DEFAULT_THEME: SynapseTheme = {
  mode: "light",
  primaryColor: "#6366f1",
  tokens: {},
};

/**
 * Detect the host environment from the ext-apps `ui/initialize` response.
 *
 * Handles missing or malformed fields gracefully — never throws.
 */
export function detectHost(initResponse: unknown): HostInfo {
  const resp = initResponse as Record<string, unknown> | null | undefined;

  const serverInfo = safeObj(resp?.serverInfo);
  const serverName =
    typeof serverInfo?.name === "string" ? serverInfo.name : "unknown";

  const protocolVersion =
    typeof resp?.protocolVersion === "string" ? resp.protocolVersion : "unknown";

  const hostContext = safeObj(resp?.hostContext);
  const theme = extractTheme(hostContext?.theme);

  return {
    isNimbleBrain: serverName === "nimblebrain",
    serverName,
    protocolVersion,
    theme,
  };
}

function extractTheme(raw: unknown): SynapseTheme {
  const obj = safeObj(raw);
  if (!obj) return { ...DEFAULT_THEME };

  const mode =
    obj.mode === "light" || obj.mode === "dark" ? obj.mode : DEFAULT_THEME.mode;

  const primaryColor =
    typeof obj.primaryColor === "string"
      ? obj.primaryColor
      : DEFAULT_THEME.primaryColor;

  const tokens =
    obj.tokens !== null &&
    typeof obj.tokens === "object" &&
    !Array.isArray(obj.tokens)
      ? (obj.tokens as Record<string, string>)
      : {};

  return { mode, primaryColor, tokens };
}

function safeObj(
  value: unknown,
): Record<string, unknown> | undefined {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

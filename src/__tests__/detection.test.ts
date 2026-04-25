import type { McpUiHostContext, McpUiInitializeResult } from "@modelcontextprotocol/ext-apps";
import { describe, expect, it } from "vitest";
import { detectHost, extractTheme } from "../detection";

/** Helper to build a spec-compliant init result. */
function makeResult(overrides?: Partial<McpUiInitializeResult>): McpUiInitializeResult {
  return {
    protocolVersion: "2026-01-26",
    hostInfo: { name: "nimblebrain", version: "1.0.0" },
    hostCapabilities: {},
    hostContext: {} as McpUiHostContext,
    ...overrides,
  };
}

describe("detectHost", () => {
  it("detects NimbleBrain host", () => {
    const result = detectHost(
      makeResult({
        hostInfo: { name: "nimblebrain", version: "2.0.0" },
      }),
    );

    expect(result.isNimbleBrain).toBe(true);
    expect(result.serverName).toBe("nimblebrain");
    expect(result.protocolVersion).toBe("2026-01-26");
  });

  it("detects non-NimbleBrain host (claude)", () => {
    const result = detectHost(
      makeResult({
        hostInfo: { name: "claude", version: "1.0.0" },
      }),
    );

    expect(result.isNimbleBrain).toBe(false);
    expect(result.serverName).toBe("claude");
  });

  it("handles missing hostInfo", () => {
    const result = detectHost({
      protocolVersion: "2026-01-26",
      hostCapabilities: {},
    });

    expect(result.isNimbleBrain).toBe(false);
    expect(result.serverName).toBe("unknown");
  });

  it("handles null input safely", () => {
    const result = detectHost(null);

    expect(result.isNimbleBrain).toBe(false);
    expect(result.serverName).toBe("unknown");
    expect(result.protocolVersion).toBe("unknown");
  });

  it("handles undefined input safely", () => {
    const result = detectHost(undefined);

    expect(result.isNimbleBrain).toBe(false);
    expect(result.serverName).toBe("unknown");
  });
});

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
    expect(theme.primaryColor).toBe("#6366f1");
    expect(theme.tokens).toEqual({});
  });

  it("falls back to empty tokens when styles.variables is missing", () => {
    const theme = extractTheme({ theme: "dark" } as McpUiHostContext);

    expect(theme.mode).toBe("dark");
    expect(theme.primaryColor).toBe("#6366f1");
    expect(theme.tokens).toEqual({});
  });

  it("uses default mode when hostContext has no theme key", () => {
    const theme = extractTheme({} as McpUiHostContext);

    expect(theme.mode).toBe("light");
    expect(theme.primaryColor).toBe("#6366f1");
  });

  it("ignores invalid theme mode values", () => {
    const theme = extractTheme({ theme: "sepia" as unknown as "light" });

    expect(theme.mode).toBe("light");
  });
});

import type { McpUiHostContext, McpUiInitializeResult } from "@modelcontextprotocol/ext-apps";
import { describe, expect, it } from "vitest";
import { detectHost } from "../detection";

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

  it("extracts theme from hostContext (spec format)", () => {
    const result = detectHost(
      makeResult({
        hostContext: {
          theme: "dark",
          styles: {
            variables: { "--color-background-primary": "#111" },
          },
        },
      }),
    );

    expect(result.theme.mode).toBe("dark");
    expect(result.theme.tokens).toEqual({ "--color-background-primary": "#111" });
  });

  it("falls back to default theme when hostContext is empty", () => {
    const result = detectHost(
      makeResult({
        hostInfo: { name: "claude", version: "1.0.0" },
        hostContext: {} as McpUiHostContext,
      }),
    );

    expect(result.theme.mode).toBe("light");
    expect(result.theme.primaryColor).toBe("#6366f1");
    expect(result.theme.tokens).toEqual({});
  });

  it("falls back to empty tokens when styles.variables is missing", () => {
    const result = detectHost(
      makeResult({
        hostContext: {
          theme: "dark",
        } as McpUiHostContext,
      }),
    );

    expect(result.theme.mode).toBe("dark");
    expect(result.theme.primaryColor).toBe("#6366f1");
    expect(result.theme.tokens).toEqual({});
  });

  it("handles null input safely", () => {
    const result = detectHost(null);

    expect(result.isNimbleBrain).toBe(false);
    expect(result.serverName).toBe("unknown");
    expect(result.protocolVersion).toBe("unknown");
    expect(result.theme.mode).toBe("light");
  });

  it("handles undefined input safely", () => {
    const result = detectHost(undefined);

    expect(result.isNimbleBrain).toBe(false);
    expect(result.serverName).toBe("unknown");
  });

  it("handles hostContext with no theme key", () => {
    const result = detectHost(
      makeResult({
        hostContext: {} as McpUiHostContext,
      }),
    );

    expect(result.theme.mode).toBe("light");
    expect(result.theme.primaryColor).toBe("#6366f1");
  });

  it("ignores invalid theme mode values", () => {
    const result = detectHost(
      makeResult({
        hostContext: {
          theme: "sepia" as any,
        } as McpUiHostContext,
      }),
    );

    expect(result.theme.mode).toBe("light");
  });
});

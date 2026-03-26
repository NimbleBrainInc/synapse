import { describe, it, expect } from "vitest";
import { detectHost } from "../detection";

describe("detectHost", () => {
  it("detects NimbleBrain host", () => {
    const result = detectHost({
      protocolVersion: "1.0",
      serverInfo: { name: "nimblebrain", version: "2.0.0" },
      capabilities: {},
    });

    expect(result.isNimbleBrain).toBe(true);
    expect(result.serverName).toBe("nimblebrain");
    expect(result.protocolVersion).toBe("1.0");
  });

  it("detects non-NimbleBrain host (claude)", () => {
    const result = detectHost({
      protocolVersion: "1.0",
      serverInfo: { name: "claude", version: "1.0.0" },
      capabilities: {},
    });

    expect(result.isNimbleBrain).toBe(false);
    expect(result.serverName).toBe("claude");
  });

  it("handles missing serverInfo", () => {
    const result = detectHost({
      protocolVersion: "1.0",
      capabilities: {},
    });

    expect(result.isNimbleBrain).toBe(false);
    expect(result.serverName).toBe("unknown");
  });

  it("extracts theme from hostContext", () => {
    const result = detectHost({
      protocolVersion: "1.0",
      serverInfo: { name: "nimblebrain", version: "1.0.0" },
      capabilities: {},
      hostContext: {
        theme: {
          mode: "dark",
          primaryColor: "#ff0000",
          tokens: { "--bg": "#111" },
        },
      },
    });

    expect(result.theme.mode).toBe("dark");
    expect(result.theme.primaryColor).toBe("#ff0000");
    expect(result.theme.tokens).toEqual({ "--bg": "#111" });
  });

  it("falls back to default theme when theme is missing", () => {
    const result = detectHost({
      protocolVersion: "1.0",
      serverInfo: { name: "claude", version: "1.0.0" },
      capabilities: {},
    });

    expect(result.theme.mode).toBe("light");
    expect(result.theme.primaryColor).toBe("#6366f1");
    expect(result.theme.tokens).toEqual({});
  });

  it("falls back to defaults for partial theme", () => {
    const result = detectHost({
      protocolVersion: "1.0",
      serverInfo: { name: "nimblebrain", version: "1.0.0" },
      capabilities: {},
      hostContext: {
        theme: { mode: "dark" },
      },
    });

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
    expect(result.theme.primaryColor).toBe("#6366f1");
    expect(result.theme.tokens).toEqual({});
  });

  it("handles undefined input safely", () => {
    const result = detectHost(undefined);

    expect(result.isNimbleBrain).toBe(false);
    expect(result.serverName).toBe("unknown");
    expect(result.protocolVersion).toBe("unknown");
    expect(result.theme.mode).toBe("light");
  });

  it("handles hostContext with no theme key", () => {
    const result = detectHost({
      protocolVersion: "1.0",
      serverInfo: { name: "nimblebrain", version: "1.0.0" },
      capabilities: {},
      hostContext: {},
    });

    expect(result.theme.mode).toBe("light");
    expect(result.theme.primaryColor).toBe("#6366f1");
  });

  it("ignores invalid theme mode values", () => {
    const result = detectHost({
      protocolVersion: "1.0",
      serverInfo: { name: "test", version: "1.0.0" },
      capabilities: {},
      hostContext: {
        theme: { mode: "sepia" },
      },
    });

    expect(result.theme.mode).toBe("light");
  });
});

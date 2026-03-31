import { describe, expect, it } from "vitest";
import { resolveEventMethod } from "../event-map.js";

describe("resolveEventMethod", () => {
  it("maps tool-result to full MCP method", () => {
    expect(resolveEventMethod("tool-result")).toBe("ui/notifications/tool-result");
  });

  it("maps tool-input to full MCP method", () => {
    expect(resolveEventMethod("tool-input")).toBe("ui/notifications/tool-input");
  });

  it("maps tool-input-partial to full MCP method", () => {
    expect(resolveEventMethod("tool-input-partial")).toBe("ui/notifications/tool-input-partial");
  });

  it("maps tool-cancelled to full MCP method", () => {
    expect(resolveEventMethod("tool-cancelled")).toBe("ui/notifications/tool-cancelled");
  });

  it("maps theme-changed to host-context-changed", () => {
    expect(resolveEventMethod("theme-changed")).toBe("ui/notifications/host-context-changed");
  });

  it("maps teardown to ui/resource-teardown", () => {
    expect(resolveEventMethod("teardown")).toBe("ui/resource-teardown");
  });

  it("passes through unmapped method names as-is", () => {
    expect(resolveEventMethod("custom/foo")).toBe("custom/foo");
  });

  it("passes through fully-qualified MCP method names", () => {
    expect(resolveEventMethod("synapse/data-changed")).toBe("synapse/data-changed");
  });
});

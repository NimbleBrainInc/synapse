import { describe, expect, it } from "vitest";
import { RESOURCE_LIST_CHANGED_METHOD, resolveEventMethod } from "../event-map.js";

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

  // `connect()` intercepts these two before it consults the map, so a mapping
  // here would be a second table claiming the same names — and the one nothing
  // reads is the one that goes wrong quietly. Passing through unchanged is the
  // evidence that only one table owns them.
  it.each([
    "theme-changed",
    "host-context-changed",
  ])("does not claim %s — connect() routes it", (name) => {
    expect(resolveEventMethod(name)).toBe(name);
  });

  it("maps teardown to ui/resource-teardown", () => {
    expect(resolveEventMethod("teardown")).toBe("ui/resource-teardown");
  });

  it("passes through unmapped method names as-is", () => {
    expect(resolveEventMethod("custom/foo")).toBe("custom/foo");
  });

  it("passes through fully-qualified MCP method names", () => {
    expect(resolveEventMethod("notifications/resources/list_changed")).toBe(
      "notifications/resources/list_changed",
    );
  });
});

describe("RESOURCE_LIST_CHANGED_METHOD", () => {
  it("is the core MCP notification a host forwards to a server's views", () => {
    expect(RESOURCE_LIST_CHANGED_METHOD).toBe("notifications/resources/list_changed");
  });
});

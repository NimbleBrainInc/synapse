import { describe, expect, it } from "vitest";
import { detectHostKind } from "../host/detect.js";

describe("detectHostKind", () => {
  it("detects mcp-apps when framed (parent !== self)", () => {
    const win: { parent?: unknown; self?: unknown } = {};
    win.self = win;
    win.parent = { name: "host-frame" }; // distinct object → nested browsing context
    expect(detectHostKind(win)).toBe("mcp-apps");
  });

  it("treats a cross-origin parent access that throws as framed", () => {
    const win = {
      get parent(): unknown {
        throw new Error("cross-origin");
      },
    };
    expect(detectHostKind(win)).toBe("mcp-apps");
  });

  it("detects generic (inline) at the top level (parent === self)", () => {
    const win: { parent?: unknown } = {};
    win.parent = win; // top-level document
    expect(detectHostKind(win)).toBe("generic");
  });

  it("does not key on window.openai, which ChatGPT injects into every frame", () => {
    const framed: { openai?: unknown; parent?: unknown } = { openai: {} };
    framed.parent = { other: true };
    expect(detectHostKind(framed)).toBe("mcp-apps");

    const topLevel: { openai?: unknown; parent?: unknown } = { openai: {} };
    topLevel.parent = topLevel;
    expect(detectHostKind(topLevel)).toBe("generic");
  });
});

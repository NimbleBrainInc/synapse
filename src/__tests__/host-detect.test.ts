import { describe, expect, it } from "vitest";
import { detectHostKind } from "../host/detect.js";

describe("detectHostKind", () => {
  it("detects chatgpt when window.openai is present", () => {
    expect(detectHostKind({ openai: {}, parent: {} })).toBe("chatgpt");
  });

  it("detects claude (mcp-ui) when framed (parent !== self)", () => {
    const win: { openai?: unknown; parent?: unknown; self?: unknown } = {};
    win.self = win;
    win.parent = { name: "host-frame" }; // distinct object → nested browsing context
    expect(detectHostKind(win)).toBe("claude");
  });

  it("treats a cross-origin parent access that throws as framed (claude)", () => {
    const win = {
      openai: undefined,
      get parent(): unknown {
        throw new Error("cross-origin");
      },
    };
    expect(detectHostKind(win)).toBe("claude");
  });

  it("detects generic (inline) at the top level (parent === self)", () => {
    const win: { openai?: unknown; parent?: unknown } = {};
    win.parent = win; // top-level document
    expect(detectHostKind(win)).toBe("generic");
  });

  it("prefers chatgpt even when also framed", () => {
    const win: { openai?: unknown; parent?: unknown } = { openai: {} };
    win.parent = { other: true };
    expect(detectHostKind(win)).toBe("chatgpt");
  });
});

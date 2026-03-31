import { describe, expect, it } from "vitest";
import { parseToolResultParams } from "../content-parser.js";

describe("parseToolResultParams", () => {
  it("uses structuredContent as content when present", () => {
    const params = {
      structuredContent: { type: "chart", data: [1, 2, 3] },
      content: [{ type: "text", text: "fallback" }],
    };
    const result = parseToolResultParams(params);

    expect(result.content).toEqual({ type: "chart", data: [1, 2, 3] });
    expect(result.structuredContent).toEqual({ type: "chart", data: [1, 2, 3] });
    expect(result.raw).toBe(params);
  });

  it("joins text content blocks and JSON-parses the result", () => {
    const params = {
      content: [
        { type: "text", text: '{"id":' },
        { type: "text", text: '"abc"}' },
      ],
    };
    const result = parseToolResultParams(params);

    expect(result.content).toEqual({ id: "abc" });
    expect(result.structuredContent).toBeNull();
  });

  it("returns raw joined string when text blocks contain invalid JSON", () => {
    const params = {
      content: [{ type: "text", text: "not valid json" }],
    };
    const result = parseToolResultParams(params);

    expect(result.content).toBe("not valid json");
    expect(result.structuredContent).toBeNull();
  });

  it("JSON-parses string content", () => {
    const params = { content: '{"key":"value"}' };
    const result = parseToolResultParams(params);

    expect(result.content).toEqual({ key: "value" });
    expect(result.structuredContent).toBeNull();
  });

  it("returns raw string when string content is invalid JSON", () => {
    const params = { content: "just a string" };
    const result = parseToolResultParams(params);

    expect(result.content).toBe("just a string");
    expect(result.structuredContent).toBeNull();
  });

  it("always includes original params in raw field", () => {
    const params = { content: "hello", extra: 42 };
    const result = parseToolResultParams(params);

    expect(result.raw).toBe(params);
    expect(result.raw).toEqual({ content: "hello", extra: 42 });
  });

  it("returns null content for undefined params", () => {
    const result = parseToolResultParams(undefined);

    expect(result.content).toBeNull();
    expect(result.structuredContent).toBeNull();
    expect(result.raw).toEqual({});
  });

  it("returns the empty array as content when content is an empty array", () => {
    const params = { content: [] as unknown[] };
    const result = parseToolResultParams(params);

    expect(result.content).toEqual([]);
    expect(result.structuredContent).toBeNull();
  });

  it("joins only text blocks from mixed content arrays", () => {
    const params = {
      content: [
        { type: "text", text: "hello " },
        { type: "image", data: "base64..." },
        { type: "text", text: "world" },
      ],
    };
    const result = parseToolResultParams(params);

    expect(result.content).toBe("hello world");
    expect(result.structuredContent).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { parseToolResult } from "../result-parser.js";

describe("parseToolResult", () => {
  it("normalizes a raw JSON object", () => {
    const raw = { id: "tsk_01abc", title: "foo" };
    const result = parseToolResult(raw);

    expect(result).toEqual({
      data: { id: "tsk_01abc", title: "foo" },
      isError: false,
    });
  });

  it("parses MCP CallToolResult with a single text block", () => {
    const raw = {
      content: [{ type: "text", text: '{"id":"tsk_01abc","title":"foo"}' }],
    };
    const result = parseToolResult(raw);

    expect(result.data).toEqual({ id: "tsk_01abc", title: "foo" });
    expect(result.isError).toBe(false);
    expect(result.content).toEqual(raw.content);
  });

  it("parses only the first text block when multiple exist", () => {
    const raw = {
      content: [
        { type: "text", text: '{"first":true}' },
        { type: "text", text: '{"second":true}' },
      ],
    };
    const result = parseToolResult(raw);

    expect(result.data).toEqual({ first: true });
    expect(result.isError).toBe(false);
    expect(result.content).toEqual(raw.content);
  });

  it("preserves the content array when no text blocks exist", () => {
    const imageBlock = { type: "image", data: "base64..." };
    const raw = { content: [imageBlock] };
    const result = parseToolResult(raw);

    expect(result.data).toEqual([imageBlock]);
    expect(result.isError).toBe(false);
    expect(result.content).toEqual(raw.content);
  });

  it("propagates the isError flag", () => {
    const raw = {
      isError: true,
      content: [{ type: "text", text: "Not found" }],
    };
    const result = parseToolResult(raw);

    expect(result.data).toBe("Not found");
    expect(result.isError).toBe(true);
    expect(result.content).toEqual(raw.content);
  });

  it("returns null data for null input", () => {
    expect(parseToolResult(null)).toEqual({ data: null, isError: false });
  });

  it("returns null data for undefined input", () => {
    expect(parseToolResult(undefined)).toEqual({ data: null, isError: false });
  });

  it("returns raw text when JSON parsing fails", () => {
    const raw = {
      content: [{ type: "text", text: "this is not json" }],
    };
    const result = parseToolResult(raw);

    expect(result.data).toBe("this is not json");
    expect(result.isError).toBe(false);
    expect(result.content).toEqual(raw.content);
  });

  it("returns null data for an empty content array", () => {
    const raw = { content: [] as unknown[] };
    const result = parseToolResult(raw);

    expect(result.data).toBeNull();
    expect(result.isError).toBe(false);
    expect(result.content).toEqual([]);
  });

  it("preserves image content blocks alongside text for UI access", () => {
    const raw = {
      content: [
        { type: "text", text: "Preview rendered (2 pages)" },
        {
          type: "image",
          data: "iVBOR...",
          mimeType: "image/png",
          annotations: { audience: ["user"] },
        },
        {
          type: "image",
          data: "iVBOR2..",
          mimeType: "image/png",
          annotations: { audience: ["user"] },
        },
      ],
    };
    const result = parseToolResult(raw);

    expect(result.data).toBe("Preview rendered (2 pages)");
    expect(result.isError).toBe(false);
    expect(result.content).toHaveLength(3);
    expect(result.content![1]).toEqual(raw.content[1]);
    expect(result.content![2]).toEqual(raw.content[2]);
  });
});

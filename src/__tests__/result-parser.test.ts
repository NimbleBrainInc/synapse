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

    expect(result).toEqual({
      data: { id: "tsk_01abc", title: "foo" },
      isError: false,
    });
  });

  it("parses only the first text block when multiple exist", () => {
    const raw = {
      content: [
        { type: "text", text: '{"first":true}' },
        { type: "text", text: '{"second":true}' },
      ],
    };
    const result = parseToolResult(raw);

    expect(result).toEqual({
      data: { first: true },
      isError: false,
    });
  });

  it("preserves the content array when no text blocks exist", () => {
    const imageBlock = { type: "image", data: "base64..." };
    const raw = { content: [imageBlock] };
    const result = parseToolResult(raw);

    expect(result).toEqual({
      data: [imageBlock],
      isError: false,
    });
  });

  it("propagates the isError flag", () => {
    const raw = {
      isError: true,
      content: [{ type: "text", text: "Not found" }],
    };
    const result = parseToolResult(raw);

    expect(result).toEqual({
      data: "Not found",
      isError: true,
    });
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

    expect(result).toEqual({
      data: "this is not json",
      isError: false,
    });
  });

  it("returns null data for an empty content array", () => {
    const raw = { content: [] };
    const result = parseToolResult(raw);

    expect(result).toEqual({
      data: null,
      isError: false,
    });
  });
});

import type { ToolCallResult } from "./types.js";

/**
 * Normalize a `CallToolResult` into a consistent `ToolCallResult`.
 *
 * A host answers `tools/call` with the tool's `CallToolResult`, and a completed
 * task inlines one. A missing `content` reads as empty, as the MCP SDK's own
 * schema defaults it. Null or undefined returns `{ data: null, isError: false }`.
 *
 * `_meta` on a `CallToolResult` is preserved on the parsed output as a
 * whole-object passthrough, so any namespaced `_meta` key propagates for free.
 */
export function parseToolResult(raw: unknown): ToolCallResult {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    return { data: null, isError: false };
  }
  const result = raw as Partial<McpCallToolResult>;
  return parseCallToolResult({
    ...result,
    content: Array.isArray(result.content) ? result.content : [],
  });
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface McpTextBlock {
  type: "text";
  text: string;
}

interface McpCallToolResult {
  content: unknown[];
  isError?: boolean;
  _meta?: { [key: string]: unknown };
}

function isTextBlock(block: unknown): block is McpTextBlock {
  if (block === null || typeof block !== "object" || Array.isArray(block)) {
    return false;
  }
  const obj = block as Record<string, unknown>;
  return obj.type === "text" && typeof obj.text === "string";
}

/**
 * Extract `_meta` as a shallow-copied object if present and object-shaped.
 *
 * Key-preserving by design: every `_meta` entry propagates without
 * selective copying, so future spec additions flow through without code
 * changes. Returns `undefined` when the input has no meaningful `_meta`.
 */
function extractMeta(result: McpCallToolResult): { [key: string]: unknown } | undefined {
  const meta = result._meta;
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return undefined;
  // Shallow spread so mutations on either side don't leak.
  return { ...meta };
}

function parseCallToolResult(result: McpCallToolResult): ToolCallResult {
  const isError = result.isError === true;
  const content = result.content;
  const meta = extractMeta(result);

  if (content.length === 0) {
    return { data: null, isError, content, ...(meta && { _meta: meta }) };
  }

  const firstText = content.find(isTextBlock);

  if (!firstText) {
    // No text blocks — return the full content array so callers can inspect it.
    return { data: content, isError, content, ...(meta && { _meta: meta }) };
  }

  // Try to parse JSON from the text block.
  try {
    return { data: JSON.parse(firstText.text), isError, content, ...(meta && { _meta: meta }) };
  } catch {
    // Invalid JSON — return the raw string.
    return { data: firstText.text, isError, content, ...(meta && { _meta: meta }) };
  }
}

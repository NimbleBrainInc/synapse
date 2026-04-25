import type { ToolCallResult } from "./types.js";

/**
 * Normalize a raw tool call response into a consistent `ToolCallResult`.
 *
 * Handles three shapes:
 * 1. MCP `CallToolResult` — has a `content` array with typed blocks.
 * 2. Raw JSON object (NimbleBrain bridge) — used as-is.
 * 3. Null / undefined — returns `{ data: null, isError: false }`.
 *
 * `_meta` on a `CallToolResult` is preserved on the parsed output as a
 * whole-object passthrough — notably `io.modelcontextprotocol/related-task`
 * (`{ taskId }`) for MCP 2025-11-25 task-augmented results, but any other
 * namespaced `_meta` keys propagate for free.
 */
export function parseToolResult(raw: unknown): ToolCallResult {
  if (raw == null) {
    return { data: null, isError: false };
  }

  if (isCallToolResult(raw)) {
    return parseCallToolResult(raw);
  }

  // Raw JSON object — pass through.
  return { data: raw, isError: false };
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

function isCallToolResult(value: unknown): value is McpCallToolResult {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  return Array.isArray((value as Record<string, unknown>).content);
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
  // Shallow spread so mutations on either side don't leak. Preserves the
  // full key set including `io.modelcontextprotocol/related-task`.
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

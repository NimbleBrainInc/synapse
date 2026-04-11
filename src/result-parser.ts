import type { ToolCallResult } from "./types.js";

/**
 * Normalize a raw tool call response into a consistent `ToolCallResult`.
 *
 * Handles three shapes:
 * 1. MCP `CallToolResult` — has a `content` array with typed blocks.
 * 2. Raw JSON object (NimbleBrain bridge) — used as-is.
 * 3. Null / undefined — returns `{ data: null, isError: false }`.
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

function parseCallToolResult(result: McpCallToolResult): ToolCallResult {
  const isError = result.isError === true;
  const content = result.content;

  if (content.length === 0) {
    return { data: null, isError, content };
  }

  const firstText = content.find(isTextBlock);

  if (!firstText) {
    // No text blocks — return the full content array so callers can inspect it.
    return { data: content, isError, content };
  }

  // Try to parse JSON from the text block.
  try {
    return { data: JSON.parse(firstText.text), isError, content };
  } catch {
    // Invalid JSON — return the raw string.
    return { data: firstText.text, isError, content };
  }
}

import type { ToolResultData } from "./types.js";

export type { ToolResultData };

/**
 * Parse inbound `ui/notifications/tool-result` notification params into
 * a consistent `ToolResultData` shape.
 *
 * Implements the 5-step parsing algorithm from the RFC:
 *  1. If `params.structuredContent` exists → use it as content.
 *  2. Else if `params.content` is an array of `{type:"text", text}` blocks →
 *     join the text values and try JSON.parse.
 *  3. Else if `params.content` is a string → try JSON.parse.
 *  4. If JSON.parse fails in steps 2 or 3 → deliver the raw string.
 *  5. Return `{ content, structuredContent, raw }`.
 */
export function parseToolResultParams(params: Record<string, unknown> | undefined): ToolResultData {
  const raw = params ?? {};
  const structuredContent = raw.structuredContent ?? null;

  // Step 1: If structuredContent exists, use it as content
  if (structuredContent != null) {
    return { content: structuredContent, structuredContent, raw };
  }

  const rawContent = raw.content;

  // Step 2: If content is array of {type:"text", text} blocks, join texts and try JSON.parse
  if (Array.isArray(rawContent)) {
    const texts = rawContent
      .filter(
        (block: unknown) =>
          block != null &&
          typeof block === "object" &&
          (block as Record<string, unknown>).type === "text" &&
          typeof (block as Record<string, unknown>).text === "string",
      )
      .map((block: unknown) => (block as Record<string, unknown>).text as string);

    if (texts.length > 0) {
      const joined = texts.join("");
      try {
        return { content: JSON.parse(joined), structuredContent: null, raw };
      } catch {
        return { content: joined, structuredContent: null, raw };
      }
    }

    // No text blocks — return raw content array
    return { content: rawContent, structuredContent: null, raw };
  }

  // Step 3: If content is string, try JSON.parse
  if (typeof rawContent === "string") {
    try {
      return { content: JSON.parse(rawContent), structuredContent: null, raw };
    } catch {
      return { content: rawContent, structuredContent: null, raw };
    }
  }

  // Fallback: return content as-is (could be null, object, etc.)
  return { content: rawContent ?? null, structuredContent: null, raw };
}

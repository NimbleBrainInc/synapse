/**
 * Read data baked into the HTML as `<script type="application/json" id=…>`.
 *
 * This is how the mcp-ui embedded-resource path and SSR/standalone deliver the
 * pushed tool output with no round-trip: the server helper escapes the payload
 * and substitutes it into the element (see the Python `SynapseUI.render_html`).
 * A data-free template leaves the marker comment in place, which fails
 * `JSON.parse` and reads back as `null` — exactly the "no data yet" state.
 */
export function readInlineData<T = unknown>(
  doc: Document | undefined,
  elementId: string,
): T | null {
  if (!doc) return null;
  const el = doc.getElementById(elementId);
  const text = el?.textContent;
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    return (parsed ?? null) as T | null;
  } catch {
    // Unreplaced marker or malformed blob — treat as no data.
    return null;
  }
}

/**
 * Pull the app payload out of an arbitrary render-data envelope. Hosts wrap the
 * tool output differently (`renderData`, `toolOutput`, `structuredContent`, or
 * the bare object), so unwrap the known envelope keys, else pass the object
 * through. Kept framework-generic — no app-specific keys.
 */
export function unwrapRenderData<T = unknown>(payload: unknown): T | null {
  if (payload == null || typeof payload !== "object") return null;
  const rec = payload as Record<string, unknown>;
  const nested = rec.renderData;
  const source =
    nested != null && typeof nested === "object" ? (nested as Record<string, unknown>) : rec;
  if (source.toolOutput != null) return source.toolOutput as T;
  if (source.structuredContent != null) return source.structuredContent as T;
  // No bare `data` envelope key — too ambiguous with an app's own `data` field.
  return source as T;
}

/**
 * Read data baked into the HTML as `<script type="application/json" id=…>`.
 *
 * This is how a server delivers tool output with no round-trip, for first paint
 * and for a standalone render: the server helper escapes the payload
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

/**
 * Inject a stylesheet into the document exactly once, keyed by `id`. Used for
 * the few things inline styles can't express — `@keyframes` and `:hover`/
 * `:focus` pseudo-states. SSR-safe (no-ops without `document`) and idempotent.
 */
export function ensureStyle(id: string, css: string): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(id)) return;
  const style = document.createElement("style");
  style.id = id;
  style.textContent = css;
  document.head.appendChild(style);
}

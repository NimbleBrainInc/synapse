/**
 * Loads the NimbleBrain brand fonts into the current document. Import for the
 * side effect:
 *
 * ```ts
 * import "@nimblebrain/synapse/ui/fonts";
 * ```
 *
 * The token contract names these fonts (`--font-sans: Satoshi`,
 * `--nb-font-heading: Erode`), but a font *name* only renders if the font
 * *files* are loaded in the iframe document — each app iframe is its own
 * document and does not inherit the host's `@font-face`s. This module injects
 * the Fontshare stylesheet so the named fonts resolve instead of silently
 * falling back.
 *
 * JetBrains Mono (`--font-mono`) is not injected here — apps that render code
 * should add `@fontsource-variable/jetbrains-mono` to their own bundle.
 *
 * CSP note: the host iframe must allow `https://api.fontshare.com` in its
 * `style-src`/`font-src` for this to take effect. If blocked, fonts fall back
 * to the neutral system stack in the token contract.
 */

const FONTSHARE_HREF =
  "https://api.fontshare.com/v2/css?f[]=satoshi@400,500,700&f[]=erode@400,500&display=swap";
const LINK_ID = "nb-synapse-fonts";

/**
 * Inject the Fontshare brand-font stylesheet once. Idempotent and SSR-safe
 * (no-ops when `document` is unavailable). Called automatically on import;
 * exported for explicit invocation.
 */
export function injectFonts(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(LINK_ID)) return;
  const link = document.createElement("link");
  link.id = LINK_ID;
  link.rel = "stylesheet";
  link.href = FONTSHARE_HREF;
  document.head.appendChild(link);
}

injectFonts();

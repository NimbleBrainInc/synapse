/**
 * The root-height chain every full-pane Synapse app needs, as a plain function
 * (no side effect on import — so a component can call it on render without the
 * mere act of importing injecting anything). The side-effect entry point is
 * `../base.ts` (`@nimblebrain/synapse/ui/base`).
 *
 * `AppFrame` sizes the app shell with `height: 100%`, which only resolves if its
 * ancestor chain (`#root` → `body` → `html`) has a definite height. Each app
 * iframe is its own bare document, so without this chain the shell collapses to
 * content height — full width, short height — inside the host pane.
 *
 * Percentages resolve against the actual pane box, which is correct whether the
 * app is sandboxed in an iframe or mounted into a host panel. A viewport unit
 * (`vh`/`dvh`) would instead assume the pane equals the viewport — wrong on
 * hosts that allocate a pane shorter than the viewport (it overflows with a
 * second scrollbar). The `#root` rule targets the conventional mount id and
 * harmlessly matches nothing if an app mounts elsewhere; `html, body` still
 * apply. `body { margin: 0 }` removes the UA default so the pane has no gap.
 */

import { ensureStyle } from "./inject-style.js";

const STYLE_ID = "nb-synapse-base";
const RULES = "html, body, #root { height: 100%; } body { margin: 0; }";

/**
 * Inject the root-height + body-margin reset once. Idempotent (keyed by a
 * single style id) and SSR-safe (no-ops when `document` is unavailable, via
 * `ensureStyle`).
 */
export function injectBaseReset(): void {
  ensureStyle(STYLE_ID, RULES);
}

/**
 * Establishes the root-height chain a full-pane Synapse app needs. Import for
 * the side effect:
 *
 * ```ts
 * import "@nimblebrain/synapse/ui/base";
 * ```
 *
 * This injects `html, body, #root { height: 100% }` (so a `height: 100%` app
 * shell resolves against the iframe's allocated pane) and `body { margin: 0 }`
 * (so the pane has no UA-margin gap). See `./internal/base-reset.ts` for why a
 * percentage chain — not a viewport unit — is the correct mechanism.
 *
 * `AppFrame` already calls `injectBaseReset()` on render, so apps built on it
 * get the chain automatically. Import this module explicitly to establish the
 * chain *before* React mounts — avoiding a first-paint layout jump — or for an
 * app that renders a full-pane root without `AppFrame`.
 */

import { injectBaseReset } from "./internal/base-reset.js";

injectBaseReset();

export { injectBaseReset };

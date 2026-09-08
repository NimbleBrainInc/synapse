/**
 * The plumbing the SDK's own composable helpers reach through — the file
 * picker, `action`, `downloadFile`, `callToolAsTask`.
 *
 * It lives in a module-private `WeakMap` rather than on the `App` object,
 * because those two options are not equivalent. A `_internals` member is still
 * a member: it type-checks, autocompletes, survives `Object.keys`, and hands
 * every consumer a transport the SDK does not model a use for. Underscore and
 * an `@internal` tag are a request, not a boundary, and a request is what the
 * removed `Synapse._request` was — which is exactly how a bridge script ended
 * up hand-rolling its own `tools/call`.
 *
 * So the public type is the protocol surface and nothing else, and the seam is
 * genuinely closed: a caller who needs something the SDK does not expose gets a
 * named method for it, or the SDK is missing a feature.
 */
import type { App, AppInternals } from "./types.js";

const INTERNALS = new WeakMap<App, AppInternals>();

/** Called once by `connect()` for each app it builds. */
export function registerInternals(app: App, internals: AppInternals): void {
  INTERNALS.set(app, internals);
}

/**
 * The plumbing behind an app. Throws if `app` did not come from this copy of
 * the SDK — which is what a duplicated install looks like, and is worth failing
 * loudly for rather than as an undefined-property read three frames later.
 */
export function internalsFor(app: App): AppInternals {
  const internals = INTERNALS.get(app);
  if (!internals) {
    throw new Error(
      "This App did not come from this copy of @nimblebrain/synapse. " +
        "Two copies of the package are installed (check for a duplicate in your " +
        "lockfile, or a bundler resolving the ESM and CJS builds separately).",
    );
  }
  return internals;
}

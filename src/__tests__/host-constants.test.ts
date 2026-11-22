/**
 * Synapse's `ai.nimblebrain/*` identifiers and limits, held equal to the
 * NimbleBrain host's.
 *
 * `host-constants/nimblebrain-host.constants.json` is a snapshot of what the
 * host serves: the extensions it declares, the bounds it drops or refuses a
 * message over, and the values it sends an app. Synapse keeps its own copy of
 * each (a client cannot import a host), so a change on one side alone fails
 * silently in an app: an extension the host renamed is never sent, and a trail
 * one entry longer than the host accepts is dropped whole. Each test names the
 * Synapse constant and the snapshot value it must equal.
 *
 * The snapshot is the document the host publishes at `HOST_CONSTANTS_URL` in
 * `scripts/host-constants.mjs`; `npm run host-constants:refresh` replaces it
 * with the published one, and `npm run host-constants:check` fails when the two
 * differ. Refresh it, run this file, and change Synapse's constants until it
 * passes.
 *
 * Not covered, because Synapse holds no value to compare: the notice title and
 * description lengths, the notice burst limit and the trail `id` length are
 * enforced by the host alone and appear here only in doc comments; the
 * notice levels are a type (`NoticeLevel`), which a runtime test cannot read;
 * and the rate-limited error (`errors.rateLimited` with
 * `errors.retryAfterDataField`) reaches an app as a JSON-RPC error that
 * Synapse passes through without reading.
 */
import { describe, expect, it } from "vitest";
import { HOST_STYLES_EXTENSION } from "../detection.js";
import { isSuspensionError, REQUEST_TIMEOUT_CODE } from "../errors.js";
import { NAVIGATE_METHOD, NIMBLEBRAIN_EXTENSIONS } from "../event-map.js";
import { DEFAULT_MAX_FILE_SIZE, MAX_LABEL_LENGTH, MAX_TRAIL_ENTRIES } from "../extensions.js";
import {
  DEFAULT_THEME_VARS,
  GUTTER_DEFAULT,
  GUTTER_NARROW_BREAKPOINT,
  GUTTER_NARROW_DEFAULT,
} from "../theme-defaults.js";
import host from "./host-constants/nimblebrain-host.constants.json";

describe("NimbleBrain host constants", () => {
  it("reads a snapshot in the shape it knows", () => {
    expect(host.version).toBe(1);
  });

  it("lists exactly the extensions the host declares", () => {
    const ours = Object.values(NIMBLEBRAIN_EXTENSIONS).map((e) => e.method);
    expect([...ours].sort()).toEqual([...host.extensions.declared].sort());
  });

  it("gates each extension on the identifier the host declares it under", () => {
    for (const { method, capability } of Object.values(NIMBLEBRAIN_EXTENSIONS)) {
      expect(capability).toBe(method);
      expect(host.extensions.declared).toContain(capability);
    }
  });

  it("listens for the method the host navigates an app with", () => {
    expect(host.extensions.hostToApp).toEqual([NAVIGATE_METHOD]);
  });

  it("reads the host-context key the host sends its mode-varying variables under", () => {
    expect(host.extensions.hostContext).toEqual([HOST_STYLES_EXTENSION]);
  });

  it("holds a trail to the host's bounds", () => {
    expect(MAX_TRAIL_ENTRIES).toBe(host.limits.location.maxTrailEntries);
    expect(MAX_LABEL_LENGTH).toBe(host.limits.location.maxLabelLength);
    // `setLocation` sends "…" for an empty label, which is only right while the
    // host's minimum is one character.
    expect(host.limits.location.minLabelLength).toBe(1);
  });

  it("defaults a picked file's size cap to the host's", () => {
    expect(DEFAULT_MAX_FILE_SIZE).toBe(host.limits.files.defaultMaxFileSize);
  });

  it("recognises the error the host answers a suspended request with", () => {
    expect(REQUEST_TIMEOUT_CODE).toBe(host.errors.requestTimeout);
    const error = {
      code: host.errors.requestTimeout,
      data: { [host.errors.suspensionDataField]: 90_000 },
    };
    expect(isSuspensionError(error)).toBe(true);
  });

  it("falls back to the gutter the host sends", () => {
    expect(GUTTER_DEFAULT).toBe(host.theme.gutter.wide);
    expect(GUTTER_NARROW_DEFAULT).toBe(host.theme.gutter.narrow);
    expect(GUTTER_NARROW_BREAKPOINT).toBe(host.theme.gutter.narrowBreakpointPx);
  });

  it("has a default for every variable the host sends on the styles extension", () => {
    for (const mode of ["light", "dark"] as const) {
      for (const variable of host.theme.modeExtensionVariables) {
        expect(DEFAULT_THEME_VARS[mode], `${variable} in ${mode}`).toHaveProperty([variable]);
      }
    }
  });
});

/**
 * Font-face survival across a host-context change, on BOTH connection paths.
 *
 * The ext-apps spec types `ui/notifications/host-context-changed` params as a
 * "Partial context update containing only changed fields", so a host toggling
 * dark mode may send `{ theme: "dark" }` and nothing else. An absent
 * `synapse/fontFaces` therefore means "unchanged" — never "drop them".
 *
 * Getting this wrong is far more visible for typography than for colour: the
 * app's whole typeface reverts to the fallback stack mid-session.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connect } from "../connect.js";
import { createSynapse } from "../core.js";
import { FONT_FACES_CONTEXT_KEY } from "../detection.js";
import { resetAppliedFontFaces } from "../theme-defaults.js";
import type { Synapse } from "../types.js";

let postMessageSpy: ReturnType<typeof vi.fn>;
let loaded: Set<FakeFontFace>;

class FakeFontFace {
  constructor(
    public family: string,
    public source: string,
    public descriptors: Record<string, unknown> = {},
  ) {}
}

function installFontStub(): Set<FakeFontFace> {
  const added = new Set<FakeFontFace>();
  vi.stubGlobal("FontFace", FakeFontFace);
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: {
      add: (f: FakeFontFace) => added.add(f),
      delete: (f: FakeFontFace) => added.delete(f),
    },
  });
  return added;
}

const BRAND_FACES = [{ family: "Brand", src: "url('/brand.woff2')" }];

function makeInitResult() {
  return {
    protocolVersion: "2026-01-26",
    hostInfo: { name: "nimblebrain", version: "1.0.0" },
    hostCapabilities: {},
    hostContext: {
      theme: "light",
      styles: { variables: {} },
      [FONT_FACES_CONTEXT_KEY]: BRAND_FACES,
    },
  };
}

function completeHandshake() {
  const initCall = postMessageSpy.mock.calls.find(
    (c: unknown[]) =>
      c[0] &&
      typeof c[0] === "object" &&
      (c[0] as Record<string, unknown>).method === "ui/initialize",
  );
  if (!initCall) throw new Error("No ui/initialize call found");
  const id = (initCall[0] as Record<string, unknown>).id as string;
  window.dispatchEvent(
    new MessageEvent("message", {
      data: { jsonrpc: "2.0", id, result: makeInitResult() },
    }),
  );
}

function dispatchNotification(method: string, params?: Record<string, unknown>) {
  window.dispatchEvent(
    new MessageEvent("message", {
      data: { jsonrpc: "2.0", method, ...(params !== undefined && { params }) },
    }),
  );
}

const families = () => [...loaded].map((f) => f.family);

beforeEach(() => {
  resetAppliedFontFaces();
  vi.unstubAllGlobals();
  loaded = installFontStub();
  postMessageSpy = vi.fn();
  window.parent.postMessage = postMessageSpy;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createSynapse — host fonts survive a partial context change", () => {
  let synapse: Synapse;

  it("keeps faces when host-context-changed omits the key", async () => {
    synapse = createSynapse({ name: "t", version: "1.0.0" });
    completeHandshake();
    await synapse.ready;
    expect(families()).toEqual(["Brand"]);

    // A dark-mode toggle carrying only the changed field.
    dispatchNotification("ui/notifications/host-context-changed", { theme: "dark" });

    expect(families()).toEqual(["Brand"]);
  });

  it("replaces faces when the host sends a new set", async () => {
    synapse = createSynapse({ name: "t", version: "1.0.0" });
    completeHandshake();
    await synapse.ready;

    dispatchNotification("ui/notifications/host-context-changed", {
      theme: "dark",
      [FONT_FACES_CONTEXT_KEY]: [{ family: "Other", src: "url('/other.woff2')" }],
    });

    expect(families()).toEqual(["Other"]);
  });

  it("clears faces when the host sends an explicit empty list", async () => {
    synapse = createSynapse({ name: "t", version: "1.0.0" });
    completeHandshake();
    await synapse.ready;

    dispatchNotification("ui/notifications/host-context-changed", {
      [FONT_FACES_CONTEXT_KEY]: [],
    });

    expect(families()).toEqual([]);
  });
});

describe("connect — host fonts survive a partial context change", () => {
  it("keeps faces when host-context-changed omits the key", async () => {
    const app = connect({ name: "t", version: "1.0.0" });
    await vi.waitFor(() => {
      if (!postMessageSpy.mock.calls.length) throw new Error("no init yet");
    });
    completeHandshake();
    await app;
    expect(families()).toEqual(["Brand"]);

    dispatchNotification("ui/notifications/host-context-changed", { theme: "dark" });

    expect(families()).toEqual(["Brand"]);
  });

  it("clears faces when the host sends an explicit empty list", async () => {
    const app = connect({ name: "t", version: "1.0.0" });
    await vi.waitFor(() => {
      if (!postMessageSpy.mock.calls.length) throw new Error("no init yet");
    });
    completeHandshake();
    await app;

    dispatchNotification("ui/notifications/host-context-changed", {
      [FONT_FACES_CONTEXT_KEY]: [],
    });

    expect(families()).toEqual([]);
  });
});

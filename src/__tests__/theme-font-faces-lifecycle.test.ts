/**
 * Font-face survival across a host-context change.
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
import { FONT_FACES_CONTEXT_KEY } from "../detection.js";
import { applyTheme, resetAppliedFontFaces } from "../theme-defaults.js";
import type { App } from "../types.js";

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

/** Open a connection and answer its handshake. */
async function connectAndHandshake(): Promise<App> {
  const pending = connect({ name: "t", version: "1.0.0" });
  await vi.waitFor(() => {
    if (!postMessageSpy.mock.calls.length) throw new Error("no init yet");
  });
  completeHandshake();
  return pending;
}

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

describe("host fonts survive a partial context change", () => {
  it("keeps faces when host-context-changed omits the key", async () => {
    await connectAndHandshake();
    expect(families()).toEqual(["Brand"]);

    // A dark-mode toggle carrying only the changed field.
    dispatchNotification("ui/notifications/host-context-changed", { theme: "dark" });

    expect(families()).toEqual(["Brand"]);
  });

  it("replaces faces when the host sends a new set", async () => {
    await connectAndHandshake();

    dispatchNotification("ui/notifications/host-context-changed", {
      theme: "dark",
      [FONT_FACES_CONTEXT_KEY]: [{ family: "Other", src: "url('/other.woff2')" }],
    });

    expect(families()).toEqual(["Other"]);
  });

  it("clears faces when the host sends an explicit empty list", async () => {
    await connectAndHandshake();

    dispatchNotification("ui/notifications/host-context-changed", {
      [FONT_FACES_CONTEXT_KEY]: [],
    });

    expect(families()).toEqual([]);
  });
});

describe("theme subscribers agree with what is loaded", () => {
  it("the theme-changed payload carries the sticky faces, matching app.theme", async () => {
    const app = await connectAndHandshake();

    const seen: (string[] | undefined)[] = [];
    app.on("theme-changed", (t) => seen.push(t.fontFaces?.map((f) => f.family)));

    dispatchNotification("ui/notifications/host-context-changed", { theme: "dark" });

    // The two public accessors must not disagree: both report the loaded set.
    expect(seen).toEqual([["Brand"]]);
    expect(app.theme.fontFaces?.map((f) => f.family)).toEqual(["Brand"]);
  });

  it("notifies subscribers on a fonts-only change", async () => {
    const app = await connectAndHandshake();

    const seen: (string[] | undefined)[] = [];
    app.on("theme-changed", (t) => seen.push(t.fontFaces?.map((f) => f.family)));

    // Same mode, same tokens — only the typeface moves. The equality filter
    // must not swallow it, or every useTheme() consumer reports stale faces.
    dispatchNotification("ui/notifications/host-context-changed", {
      theme: "light",
      styles: { variables: {} },
      [FONT_FACES_CONTEXT_KEY]: [{ family: "Other", src: "url('/other.woff2')" }],
    });

    expect(seen).toEqual([["Other"]]);
    expect(families()).toEqual(["Other"]);
  });

  it("a theme re-applied without fontFaces leaves loaded faces alone", async () => {
    await connectAndHandshake();
    expect(families()).toEqual(["Brand"]);

    // A vars-only re-apply must never strip the host's typeface.
    applyTheme("dark", { "--color-text-primary": "#fff" });

    expect(families()).toEqual(["Brand"]);
  });
});

describe("an all-malformed batch never unloads the typeface", () => {
  it("keeps loaded faces when every incoming entry is the wrong shape", async () => {
    const app = await connectAndHandshake();
    expect(families()).toEqual(["Brand"]);

    dispatchNotification("ui/notifications/host-context-changed", {
      theme: "dark",
      [FONT_FACES_CONTEXT_KEY]: [{ fontFamily: "Brand", source: "url('/brand.woff2')" }],
    });

    expect(families()).toEqual(["Brand"]);
    expect(app.theme.fontFaces?.map((f) => f.family)).toEqual(["Brand"]);
  });
});

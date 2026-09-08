/**
 * `<AppProvider>` must not unload the host's typeface.
 *
 * The provider mounts an app that applies the host's theme on the handshake
 * and again on every `host-context-changed`. If the theme it re-applies omits
 * the faces — or if a vars-only re-apply is read as "clear" — the app silently
 * loses its typeface on an unrelated dark-mode toggle.
 *
 * This is the end-to-end version of the guarantees pinned in
 * `theme-font-faces-lifecycle.test.ts`: the payload carries the sticky faces
 * AND the sink treats absence as unchanged.
 */

import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FONT_FACES_CONTEXT_KEY } from "../../detection.js";
import { AppProvider } from "../../react/app-provider.js";
import { resetAppliedFontFaces } from "../../theme-defaults.js";

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

function respondToInitialize() {
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
      data: {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2026-01-26",
          hostInfo: { name: "nimblebrain", version: "1.0.0" },
          hostCapabilities: {},
          hostContext: {
            theme: "light",
            styles: { variables: {} },
            [FONT_FACES_CONTEXT_KEY]: [{ family: "Brand", src: "url('/brand.woff2')" }],
          },
        },
      },
    }),
  );
}

function dispatchHostContext(params: Record<string, unknown>) {
  window.dispatchEvent(
    new MessageEvent("message", {
      data: { jsonrpc: "2.0", method: "ui/notifications/host-context-changed", params },
    }),
  );
}

const wrapper = ({ children }: { children: ReactNode }) => (
  <AppProvider name="t" version="1.0.0">
    {children}
  </AppProvider>
);

const families = () => [...loaded].map((f) => f.family);

/** Let the transport promise settle and React flush its effects. */
async function settle() {
  await vi.waitFor(() => {
    if (families().length === 0) throw new Error("faces not applied yet");
  });
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

describe("AppProvider + host fonts", () => {
  it("keeps the host typeface across a dark-mode toggle", async () => {
    render(<div />, { wrapper });
    respondToInitialize();
    await settle();
    expect(families()).toEqual(["Brand"]);

    dispatchHostContext({ theme: "dark" });

    // The theme re-applies a tick later; it must not clobber the faces.
    await new Promise((r) => setTimeout(r, 0));
    expect(families()).toEqual(["Brand"]);
  });

  it("still honours an explicit face swap from the host", async () => {
    render(<div />, { wrapper });
    respondToInitialize();
    await settle();

    dispatchHostContext({
      theme: "dark",
      [FONT_FACES_CONTEXT_KEY]: [{ family: "Other", src: "url('/other.woff2')" }],
    });

    await new Promise((r) => setTimeout(r, 0));
    expect(families()).toEqual(["Other"]);
  });
});

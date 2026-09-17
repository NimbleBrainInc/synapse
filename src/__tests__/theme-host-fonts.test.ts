/**
 * Host typography through `connect()`: the spec's `styles.css.fonts`.
 *
 * A token names a font family; only an `@font-face` rule loads it. The host
 * sends the rules as CSS text, and `connect()` loads them with the spec's own
 * `applyHostFonts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connect } from "../connect.js";
import type { App } from "../types.js";
import { FULL_HOST_CAPABILITIES } from "./helpers/host-capabilities.js";

const STYLE_ID = "__mcp-host-fonts";
const FONT_CSS = "@font-face { font-family: 'Brand'; src: url('/brand.woff2'); }";

let postMessageSpy: ReturnType<typeof vi.fn>;
let app: App | undefined;

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

function post(data: Record<string, unknown>): void {
  window.dispatchEvent(new MessageEvent("message", { data, source: window.parent }));
}

async function connectWith(hostContext: Record<string, unknown>): Promise<App> {
  const promise = connect({ name: "test-app", version: "1.0.0" });
  await flush();
  const init = postMessageSpy.mock.calls
    .map((c: unknown[]) => c[0] as Record<string, unknown>)
    .find((m) => m?.method === "ui/initialize");
  if (!init) throw new Error("No ui/initialize call found");
  post({
    jsonrpc: "2.0",
    id: init.id,
    result: {
      protocolVersion: "2026-01-26",
      hostInfo: { name: "test-host", version: "1.0.0" },
      hostCapabilities: FULL_HOST_CAPABILITIES,
      hostContext,
    },
  });
  const connected = await promise;
  await flush();
  return connected;
}

beforeEach(() => {
  postMessageSpy = vi.fn();
  window.parent.postMessage = postMessageSpy;
  document.getElementById(STYLE_ID)?.remove();
});

afterEach(() => {
  app?.destroy();
  app = undefined;
  document.getElementById(STYLE_ID)?.remove();
});

describe("host fonts via styles.css.fonts", () => {
  it("loads the host's font CSS from the handshake", async () => {
    app = await connectWith({ theme: "light", styles: { css: { fonts: FONT_CSS } } });
    expect(document.getElementById(STYLE_ID)?.textContent).toBe(FONT_CSS);
  });

  it("loads font CSS that first arrives in a host-context change", async () => {
    app = await connectWith({ theme: "light" });
    expect(document.getElementById(STYLE_ID)).toBeNull();

    post({
      jsonrpc: "2.0",
      method: "ui/notifications/host-context-changed",
      params: { styles: { css: { fonts: FONT_CSS } } },
    });
    await flush();

    expect(document.getElementById(STYLE_ID)?.textContent).toBe(FONT_CSS);
  });

  it("keeps the font CSS when a later change carries styles without css", async () => {
    app = await connectWith({ theme: "light", styles: { css: { fonts: FONT_CSS } } });

    post({
      jsonrpc: "2.0",
      method: "ui/notifications/host-context-changed",
      params: {
        theme: "dark",
        styles: { variables: { "--color-background-primary": "#000" } },
      },
    });
    await flush();

    expect(document.getElementById(STYLE_ID)?.textContent).toBe(FONT_CSS);
  });

  it("injects nothing when the host sends no fonts", async () => {
    app = await connectWith({ theme: "light" });
    expect(document.getElementById(STYLE_ID)).toBeNull();
  });
});

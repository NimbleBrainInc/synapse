import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectUI } from "../host/connect.js";
import type { SynapseUIClient } from "../host/types.js";

describe("connectUI — inline / standalone adapter", () => {
  let synapse: SynapseUIClient;

  beforeEach(() => {
    document.documentElement.removeAttribute("data-theme");
    document.body.innerHTML = "";
    (window as unknown as { openai?: unknown }).openai = undefined;
  });

  afterEach(() => {
    synapse?.destroy();
    document.body.innerHTML = "";
  });

  it("auto-detects generic at the top level (no host bridge)", () => {
    synapse = connectUI();
    expect(synapse.host()).toBe("generic");
  });

  it("reads baked-in data from the inline <script>", () => {
    document.body.innerHTML = `<script type="application/json" id="synapse-ui-data">${JSON.stringify(
      { domain: "static.com" },
    )}</script>`;
    synapse = connectUI({ host: "generic" });
    expect(synapse.data<{ domain: string }>()).toEqual({ domain: "static.com" });
  });

  it("honors a custom dataElementId", () => {
    document.body.innerHTML = `<script type="application/json" id="my-data">${JSON.stringify({
      n: 1,
    })}</script>`;
    synapse = connectUI({ host: "generic", dataElementId: "my-data" });
    expect(synapse.data<{ n: number }>()).toEqual({ n: 1 });
  });

  it("applies a theme to the DOM (defaults from prefers-color-scheme)", () => {
    synapse = connectUI({ host: "generic" });
    expect(["light", "dark"]).toContain(synapse.theme().mode);
    expect(document.documentElement.getAttribute("data-theme")).toBe(synapse.theme().mode);
  });

  it("openLink falls back to window.open", () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    synapse = connectUI({ host: "generic" });
    synapse.openLink("https://example.com");
    expect(openSpy).toHaveBeenCalledWith("https://example.com", "_blank", "noopener,noreferrer");
    openSpy.mockRestore();
  });

  it("reports no pull / no sendPrompt, but openLink works", () => {
    synapse = connectUI({ host: "generic" });
    expect(synapse.capabilities()).toEqual({ pull: false, sendPrompt: false, openLink: true });
  });

  it("sendPrompt and resize are safe no-ops", () => {
    synapse = connectUI({ host: "generic" });
    expect(() => {
      synapse.sendPrompt("hi");
      synapse.resize(100);
      synapse.resize();
    }).not.toThrow();
  });

  it("callTool rejects with HostUnsupportedError", async () => {
    synapse = connectUI({ host: "generic" });
    await expect(synapse.callTool("x")).rejects.toThrow(/not supported/);
  });
});

describe("applyHostTheme on a partial document", () => {
  // `applyHostTheme` sets `data-theme` before delegating to `applyTheme`, so it
  // is the first DOM write on the `connectUI` path — one line ahead of the
  // stylesheet install that the same class of document already cannot support.
  const REAL_DOCUMENT = globalThis.document;

  afterEach(() => {
    (globalThis as { document?: unknown }).document = REAL_DOCUMENT;
  });

  it("still applies the theme when documentElement has no setAttribute", async () => {
    const written: Record<string, string> = {};
    (globalThis as { document?: unknown }).document = {
      documentElement: { style: { setProperty: (k: string, v: string) => (written[k] = v) } },
      addEventListener: () => {},
      removeEventListener: () => {},
    };
    const { applyHostTheme } = await import("../host/theme.js");

    expect(() =>
      applyHostTheme({ mode: "dark", tokens: { "--color-text-primary": "#fafafa" } }),
    ).not.toThrow();
    // The attribute is the part that cannot be delivered; the tokens still must be.
    expect(written["--color-text-primary"]).toBe("#fafafa");
  });
});

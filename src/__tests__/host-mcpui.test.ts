import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectUI } from "../host/connect.js";
import { MCPUI_READY, MCPUI_RENDER_DATA, type SynapseUIClient } from "../host/types.js";

/**
 * Simulated Claude / mcp-ui host: `window.parent.postMessage` is spied to capture
 * outbound child→host messages (ready / size / link / prompt), and inbound
 * host→child pushes are dispatched as `message` events.
 */
let postMessageSpy: ReturnType<typeof vi.fn>;

function outboundOfType(type: string): Array<Record<string, unknown>> {
  return postMessageSpy.mock.calls
    .map((c) => c[0] as Record<string, unknown>)
    .filter((m) => m && m.type === type);
}

function pushRenderData(payload: Record<string, unknown>): void {
  window.dispatchEvent(new MessageEvent("message", { data: { type: MCPUI_RENDER_DATA, payload } }));
}

function setBodyHeight(px: number): void {
  Object.defineProperty(document.body, "scrollHeight", { value: px, configurable: true });
}

describe("connectUI — mcp-ui adapter", () => {
  let synapse: SynapseUIClient;

  beforeEach(() => {
    postMessageSpy = vi.fn();
    window.parent.postMessage = postMessageSpy as typeof window.parent.postMessage;
    document.documentElement.removeAttribute("data-theme");
    setBodyHeight(0);
  });

  afterEach(() => {
    synapse?.destroy();
  });

  it("resolves to the claude host and sends the ready handshake on start", () => {
    synapse = connectUI({ host: "claude", autoResize: false });
    expect(synapse.host()).toBe("claude");
    expect(outboundOfType(MCPUI_READY).length).toBe(1);
  });

  it("reads baked-in data from the inline <script> synchronously", () => {
    document.body.innerHTML = `<script type="application/json" id="synapse-ui-data">${JSON.stringify(
      { domain: "baked.com" },
    )}</script>`;
    synapse = connectUI({ host: "claude", autoResize: false });
    expect(synapse.data<{ domain: string }>()).toEqual({ domain: "baked.com" });
    document.body.innerHTML = "";
  });

  it("treats an unreplaced marker as no data", () => {
    document.body.innerHTML = `<script type="application/json" id="synapse-ui-data">/*__SYNAPSE_DATA__*/</script>`;
    synapse = connectUI({ host: "claude", autoResize: false });
    expect(synapse.data()).toBeNull();
    document.body.innerHTML = "";
  });

  it("delivers pushed data via ui-lifecycle-iframe-render-data", () => {
    synapse = connectUI({ host: "claude", autoResize: false });
    const onData = vi.fn();
    synapse.onData(onData);

    pushRenderData({ renderData: { domain: "pushed.com" } });

    expect(onData).toHaveBeenCalledWith({ domain: "pushed.com" });
    expect(synapse.data<{ domain: string }>()).toEqual({ domain: "pushed.com" });
  });

  it("unwraps a toolOutput envelope in render data", () => {
    synapse = connectUI({ host: "claude", autoResize: false });
    const onData = vi.fn();
    synapse.onData(onData);
    pushRenderData({ toolOutput: { domain: "wrapped.com" } });
    expect(onData).toHaveBeenCalledWith({ domain: "wrapped.com" });
  });

  it("accepts a generic ext-apps tool-result push as a data source", () => {
    synapse = connectUI({ host: "claude", autoResize: false });
    const onData = vi.fn();
    synapse.onData(onData);
    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          jsonrpc: "2.0",
          method: "ui/notifications/tool-result",
          params: { result: { structuredContent: { domain: "extapps.com" } } },
        },
      }),
    );
    expect(onData).toHaveBeenCalledWith({ domain: "extapps.com" });
  });

  it("applies theme from render data (dark) and notifies subscribers", () => {
    synapse = connectUI({ host: "claude", autoResize: false });
    const onTheme = vi.fn();
    synapse.onTheme(onTheme);

    pushRenderData({ theme: "dark", renderData: { domain: "x.com" } });

    expect(onTheme).toHaveBeenCalledWith({ mode: "dark", tokens: {} });
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("resize(height) posts a ui-size-change with the given height", () => {
    synapse = connectUI({ host: "claude", autoResize: false });
    postMessageSpy.mockClear();
    synapse.resize(512);
    const sizes = outboundOfType("ui-size-change");
    expect(sizes.at(-1)).toEqual({ type: "ui-size-change", payload: { height: 512 } });
  });

  it("resize() with no arg measures document.body.scrollHeight", () => {
    synapse = connectUI({ host: "claude", autoResize: false });
    setBodyHeight(742);
    postMessageSpy.mockClear();
    synapse.resize();
    const sizes = outboundOfType("ui-size-change");
    expect(sizes.at(-1)).toEqual({ type: "ui-size-change", payload: { height: 742 } });
  });

  it("sendPrompt posts a prompt message to the host", () => {
    synapse = connectUI({ host: "claude", autoResize: false });
    postMessageSpy.mockClear();
    synapse.sendPrompt("Dig deeper on x.com");
    expect(postMessageSpy).toHaveBeenCalledWith(
      { type: "prompt", payload: { prompt: "Dig deeper on x.com" } },
      "*",
    );
  });

  it("openLink posts a link message to the host", () => {
    synapse = connectUI({ host: "claude", autoResize: false });
    postMessageSpy.mockClear();
    synapse.openLink("https://example.com");
    expect(postMessageSpy).toHaveBeenCalledWith(
      { type: "link", payload: { url: "https://example.com" } },
      "*",
    );
  });

  it("callTool rejects with HostUnsupportedError (no pull)", async () => {
    synapse = connectUI({ host: "claude", autoResize: false });
    expect(synapse.capabilities().pull).toBe(false);
    await expect(synapse.callTool("refresh")).rejects.toThrow(/not supported/);
  });

  it("stops delivering data after destroy()", () => {
    synapse = connectUI({ host: "claude", autoResize: false });
    const onData = vi.fn();
    synapse.onData(onData);
    synapse.destroy();
    pushRenderData({ renderData: { domain: "late.com" } });
    expect(onData).not.toHaveBeenCalled();
  });
});

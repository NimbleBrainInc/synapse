import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectUI } from "../host/connect.js";
import {
  MCPAPP_HOST_CONTEXT_CHANGED,
  MCPAPP_INITIALIZE,
  MCPAPP_INITIALIZED,
  MCPAPP_SIZE_CHANGED,
  MCPAPP_TOOL_RESULT,
  MCPUI_READY,
  type SynapseUIClient,
} from "../host/types.js";

/**
 * Simulated MCP Apps (SEP-1865) host: `window.parent.postMessage` is spied to
 * capture the View's outbound JSON-RPC (initialize / initialized / size-changed /
 * actions), and host→View frames are dispatched as `message` events.
 */
let postMessageSpy: ReturnType<typeof vi.fn>;

const flush = () => new Promise((r) => setTimeout(r, 0));

function outbound(): Array<Record<string, unknown>> {
  return postMessageSpy.mock.calls.map((c) => c[0] as Record<string, unknown>);
}
function ofMethod(method: string): Array<Record<string, unknown>> {
  return outbound().filter((m) => m?.method === method);
}
function ofType(type: string): Array<Record<string, unknown>> {
  return outbound().filter((m) => m?.type === type);
}
function respond(id: unknown, result: unknown): void {
  window.dispatchEvent(new MessageEvent("message", { data: { jsonrpc: "2.0", id, result } }));
}
function notify(method: string, params: unknown): void {
  window.dispatchEvent(new MessageEvent("message", { data: { jsonrpc: "2.0", method, params } }));
}
function setBodyHeight(px: number): void {
  Object.defineProperty(document.body, "scrollHeight", { value: px, configurable: true });
}

describe("connectUI — MCP Apps standard adapter", () => {
  let synapse: SynapseUIClient;

  beforeEach(() => {
    postMessageSpy = vi.fn();
    window.parent.postMessage = postMessageSpy as typeof window.parent.postMessage;
    document.documentElement.removeAttribute("data-theme");
    setBodyHeight(0);
  });

  afterEach(() => {
    synapse?.destroy();
    document.body.innerHTML = "";
  });

  it("resolves to claude and posts ui/initialize (+ legacy ready) on start", () => {
    synapse = connectUI({ host: "claude", autoResize: false, name: "report", version: "1.0.0" });
    expect(synapse.host()).toBe("claude");

    const init = ofMethod(MCPAPP_INITIALIZE);
    expect(init.length).toBe(1);
    const params = init[0].params as Record<string, unknown>;
    expect(params.protocolVersion).toBe("2026-01-26");
    expect(params.appInfo).toEqual({ name: "report", version: "1.0.0" });
    // Legacy handshake goes out too, so a pre-standard mcp-ui host still renders.
    expect(ofType(MCPUI_READY).length).toBe(1);
  });

  it("sends initialized + a size after the init result, and applies host context", async () => {
    synapse = connectUI({ host: "claude", autoResize: false });
    const onTheme = vi.fn();
    synapse.onTheme(onTheme);

    const init = ofMethod(MCPAPP_INITIALIZE)[0];
    respond(init.id, {
      hostContext: { theme: "dark", styles: { variables: { "--color-accent": "#f0f" } } },
    });
    await flush();

    // The "I'm ready" signal, then a size so the host un-hides the frame.
    expect(ofMethod(MCPAPP_INITIALIZED).length).toBe(1);
    expect(ofMethod(MCPAPP_SIZE_CHANGED).length).toBeGreaterThanOrEqual(1);

    // Theme mode + host style tokens both flow through.
    expect(onTheme).toHaveBeenCalledWith({ mode: "dark", tokens: { "--color-accent": "#f0f" } });
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(synapse.theme().tokens).toEqual({ "--color-accent": "#f0f" });
  });

  it("delivers data via ui/notifications/tool-result (params IS the CallToolResult)", () => {
    synapse = connectUI({ host: "claude", autoResize: false });
    const onData = vi.fn();
    synapse.onData(onData);

    // Spec shape: no `params.result` wrapper — structuredContent sits on params.
    notify(MCPAPP_TOOL_RESULT, {
      content: [{ type: "text", text: "ok" }],
      structuredContent: { domain: "stripe.com" },
    });

    expect(onData).toHaveBeenCalledWith({ domain: "stripe.com" });
    expect(synapse.data<{ domain: string }>()).toEqual({ domain: "stripe.com" });
  });

  it("updates theme via ui/notifications/host-context-changed", () => {
    synapse = connectUI({ host: "claude", autoResize: false });
    const onTheme = vi.fn();
    synapse.onTheme(onTheme);

    notify(MCPAPP_HOST_CONTEXT_CHANGED, { theme: "dark" });

    expect(onTheme).toHaveBeenCalledWith({ mode: "dark", tokens: {} });
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("reads baked-in data synchronously for first paint", () => {
    document.body.innerHTML = `<script type="application/json" id="synapse-ui-data">${JSON.stringify(
      { domain: "baked.com" },
    )}</script>`;
    synapse = connectUI({ host: "claude", autoResize: false });
    expect(synapse.data<{ domain: string }>()).toEqual({ domain: "baked.com" });
  });

  it("accepts legacy mcp-ui render-data as a fallback data source", () => {
    synapse = connectUI({ host: "claude", autoResize: false });
    const onData = vi.fn();
    synapse.onData(onData);
    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "ui-lifecycle-iframe-render-data",
          payload: { renderData: { domain: "legacy.com" } },
        },
      }),
    );
    expect(onData).toHaveBeenCalledWith({ domain: "legacy.com" });
  });

  it("callTool sends tools/call and resolves with the host response (pull supported)", async () => {
    synapse = connectUI({ host: "claude", autoResize: false });
    expect(synapse.capabilities().pull).toBe(true);

    const p = synapse.callTool("analyze_domain", { domain: "x.com" });
    const call = outbound().find((m) => m?.method === "tools/call");
    expect(call?.params).toEqual({ name: "analyze_domain", arguments: { domain: "x.com" } });

    respond(call?.id, { structuredContent: { domain: "x.com" } });
    await expect(p).resolves.toEqual({ structuredContent: { domain: "x.com" } });
  });

  it("resize posts a standard size-changed and a legacy mirror", () => {
    synapse = connectUI({ host: "claude", autoResize: false });
    postMessageSpy.mockClear();
    synapse.resize(512);
    expect(ofMethod(MCPAPP_SIZE_CHANGED).at(-1)?.params).toEqual({ height: 512 });
    expect(ofType("ui-size-change").at(-1)).toEqual({
      type: "ui-size-change",
      payload: { height: 512 },
    });
  });

  it("openLink posts a ui/open-link request and a legacy mirror", () => {
    synapse = connectUI({ host: "claude", autoResize: false });
    postMessageSpy.mockClear();
    synapse.openLink("https://example.com");
    expect(ofMethod("ui/open-link").at(-1)?.params).toEqual({ url: "https://example.com" });
    expect(ofType("link").at(-1)).toEqual({
      type: "link",
      payload: { url: "https://example.com" },
    });
  });

  it("sendPrompt posts a ui/message request and a legacy mirror", () => {
    synapse = connectUI({ host: "claude", autoResize: false });
    postMessageSpy.mockClear();
    synapse.sendPrompt("Dig deeper");
    expect(ofMethod("ui/message").at(-1)?.params).toEqual({
      role: "user",
      content: [{ type: "text", text: "Dig deeper" }],
    });
    expect(ofType("prompt").at(-1)).toEqual({ type: "prompt", payload: { prompt: "Dig deeper" } });
  });

  it("acknowledges a host teardown request", () => {
    synapse = connectUI({ host: "claude", autoResize: false });
    postMessageSpy.mockClear();
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { jsonrpc: "2.0", id: 99, method: "ui/resource-teardown", params: {} },
      }),
    );
    expect(outbound().find((m) => m?.id === 99)).toEqual({ jsonrpc: "2.0", id: 99, result: {} });
  });

  it("stops delivering data after destroy()", () => {
    synapse = connectUI({ host: "claude", autoResize: false });
    const onData = vi.fn();
    synapse.onData(onData);
    synapse.destroy();
    notify(MCPAPP_TOOL_RESULT, { structuredContent: { domain: "late.com" } });
    expect(onData).not.toHaveBeenCalled();
  });

  // -- legacy render-data invariants (the shim's data path) -----------------

  function pushLegacyRenderData(payload: Record<string, unknown>): void {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "ui-lifecycle-iframe-render-data", payload },
      }),
    );
  }

  it("a theme-only legacy render-data push applies theme without clobbering data", () => {
    synapse = connectUI({ host: "claude", autoResize: false });
    synapse.onData(vi.fn());
    pushLegacyRenderData({ renderData: { domain: "pushed.com" } });
    expect(synapse.data<{ domain: string }>()).toEqual({ domain: "pushed.com" });

    // A theme-only push carries no data — it must not wipe the populated widget.
    pushLegacyRenderData({ theme: "dark" });
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(synapse.data<{ domain: string }>()).toEqual({ domain: "pushed.com" });
  });

  it("strips the host theme from flat legacy render-data (no leak into app data)", () => {
    synapse = connectUI({ host: "claude", autoResize: false });
    const onData = vi.fn();
    synapse.onData(onData);
    pushLegacyRenderData({ theme: "dark", domain: "flat.com" });
    expect(onData).toHaveBeenCalledWith({ domain: "flat.com" });
    expect(synapse.data<Record<string, unknown>>()).toEqual({ domain: "flat.com" });
  });

  it("suppresses legacy action mirrors once the standard handshake confirms", async () => {
    synapse = connectUI({ host: "claude", autoResize: false });
    respond(ofMethod(MCPAPP_INITIALIZE)[0].id, { hostContext: {} });
    await flush();

    postMessageSpy.mockClear();
    synapse.openLink("https://example.com");
    // The standard request still goes; the legacy mirror is now suppressed, so a
    // host that spoke both dialects can't open the link twice.
    expect(ofMethod("ui/open-link").length).toBe(1);
    expect(ofType("link").length).toBe(0);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectUI } from "../host/connect.js";
import {
  MCPAPP_HOST_CONTEXT_CHANGED,
  MCPAPP_INITIALIZE,
  MCPAPP_INITIALIZED,
  MCPAPP_SIZE_CHANGED,
  MCPAPP_TOOL_RESULT,
  type SynapseUIClient,
  ToolCallError,
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
function respond(id: unknown, result: unknown): void {
  window.dispatchEvent(
    new MessageEvent("message", { source: window.parent, data: { jsonrpc: "2.0", id, result } }),
  );
}
function notify(method: string, params: unknown): void {
  window.dispatchEvent(
    new MessageEvent("message", {
      source: window.parent,
      data: { jsonrpc: "2.0", method, params },
    }),
  );
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

  it("resolves to mcp-apps and posts ui/initialize, and nothing else, on start", () => {
    synapse = connectUI({ host: "mcp-apps", autoResize: false, name: "report", version: "1.0.0" });
    expect(synapse.host()).toBe("mcp-apps");

    const init = ofMethod(MCPAPP_INITIALIZE);
    expect(init.length).toBe(1);
    const params = init[0].params as Record<string, unknown>;
    expect(params.protocolVersion).toBe("2026-01-26");
    expect(params.appInfo).toEqual({ name: "report", version: "1.0.0" });
    expect(outbound()).toEqual([init[0]]);
  });

  it("sends initialized + a size after the init result, and applies host context", async () => {
    synapse = connectUI({ host: "mcp-apps", autoResize: false });
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
    synapse = connectUI({ host: "mcp-apps", autoResize: false });
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
    synapse = connectUI({ host: "mcp-apps", autoResize: false });
    const onTheme = vi.fn();
    synapse.onTheme(onTheme);

    notify(MCPAPP_HOST_CONTEXT_CHANGED, { theme: "dark" });

    expect(onTheme).toHaveBeenCalledWith({ mode: "dark", tokens: {} });
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("carries host font faces through to the resolved theme", () => {
    // The cross-host client must be able to receive host typography, not just
    // colour: a token names a family, only a face loads it. This is the one
    // adapter that can carry them — ChatGPT supplies a mode string alone.
    synapse = connectUI({ host: "mcp-apps", autoResize: false });
    const onTheme = vi.fn();
    synapse.onTheme(onTheme);

    notify(MCPAPP_HOST_CONTEXT_CHANGED, {
      theme: "dark",
      "synapse/fontFaces": [{ family: "Brand", src: "url('/brand.woff2')" }],
    });

    expect(synapse.theme().fontFaces).toEqual([{ family: "Brand", src: "url('/brand.woff2')" }]);
    expect(onTheme).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "dark",
        fontFaces: [{ family: "Brand", src: "url('/brand.woff2')" }],
      }),
    );
  });

  it("keeps host font faces when a later context change omits them", () => {
    synapse = connectUI({ host: "mcp-apps", autoResize: false });
    notify(MCPAPP_HOST_CONTEXT_CHANGED, {
      theme: "dark",
      "synapse/fontFaces": [{ family: "Brand", src: "url('/brand.woff2')" }],
    });

    notify(MCPAPP_HOST_CONTEXT_CHANGED, { theme: "light" });

    expect(synapse.theme().fontFaces).toEqual([{ family: "Brand", src: "url('/brand.woff2')" }]);
  });

  it("reads baked-in data synchronously for first paint", () => {
    document.body.innerHTML = `<script type="application/json" id="synapse-ui-data">${JSON.stringify(
      { domain: "baked.com" },
    )}</script>`;
    synapse = connectUI({ host: "mcp-apps", autoResize: false });
    expect(synapse.data<{ domain: string }>()).toEqual({ domain: "baked.com" });
  });

  it("callTool sends tools/call and resolves with the host response (pull supported)", async () => {
    synapse = connectUI({ host: "mcp-apps", autoResize: false });
    expect(synapse.capabilities().pull).toBe(true);

    const p = synapse.callTool("analyze_domain", { domain: "x.com" });
    const call = outbound().find((m) => m?.method === "tools/call");
    expect(call?.params).toEqual({ name: "analyze_domain", arguments: { domain: "x.com" } });

    respond(call?.id, { structuredContent: { domain: "x.com" } });
    await expect(p).resolves.toEqual({ structuredContent: { domain: "x.com" } });
  });

  it("callTool rejects with ToolCallError when the result reports isError", async () => {
    synapse = connectUI({ host: "mcp-apps", autoResize: false });

    const p = synapse.callTool("hidden_tool");
    const call = outbound().find((m) => m?.method === "tools/call");
    // The shape ChatGPT answers with when the app may not call the tool: a
    // result, not a JSON-RPC error.
    const refused = {
      content: [{ type: "text", text: "Tool is not visible to app" }],
      isError: true,
      _meta: { "openai/http_status": 403 },
    };
    respond(call?.id, refused);

    const error = await p.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ToolCallError);
    expect((error as ToolCallError).message).toBe("Tool is not visible to app");
    expect((error as ToolCallError).result).toEqual(refused);
  });

  it("callTool names the tool when an error result carries no text", async () => {
    synapse = connectUI({ host: "mcp-apps", autoResize: false });

    const p = synapse.callTool("broken");
    const call = outbound().find((m) => m?.method === "tools/call");
    respond(call?.id, { content: [], isError: true });

    await expect(p).rejects.toThrow('tool "broken" returned an error');
  });

  it("resize before the handshake posts nothing", () => {
    // `ui/initialize` is the app's first word on this bridge, so a
    // `size-changed` cannot precede the host's answer — a strict host drops it
    // and leaves the frame hidden. The handshake reports a size when it lands.
    synapse = connectUI({ host: "mcp-apps", autoResize: false });
    postMessageSpy.mockClear();
    synapse.resize(512);
    expect(outbound()).toEqual([]);
  });

  it("resize after the handshake posts size-changed", async () => {
    synapse = connectUI({ host: "mcp-apps", autoResize: false });
    respond(ofMethod(MCPAPP_INITIALIZE)[0].id, {});
    await flush();

    postMessageSpy.mockClear();
    synapse.resize(512);
    expect(outbound()).toEqual([
      { jsonrpc: "2.0", method: MCPAPP_SIZE_CHANGED, params: { height: 512 } },
    ]);
  });

  it("openLink posts a ui/open-link request, and nothing else", () => {
    synapse = connectUI({ host: "mcp-apps", autoResize: false });
    postMessageSpy.mockClear();
    synapse.openLink("https://example.com");
    expect(ofMethod("ui/open-link").at(-1)?.params).toEqual({ url: "https://example.com" });
    expect(outbound().length).toBe(1);
  });

  it("sendPrompt posts a ui/message request, and nothing else", () => {
    synapse = connectUI({ host: "mcp-apps", autoResize: false });
    postMessageSpy.mockClear();
    synapse.sendPrompt("Dig deeper");
    expect(ofMethod("ui/message").at(-1)?.params).toEqual({
      role: "user",
      content: [{ type: "text", text: "Dig deeper" }],
    });
    expect(outbound().length).toBe(1);
  });

  it("acknowledges a host teardown request", () => {
    synapse = connectUI({ host: "mcp-apps", autoResize: false });
    postMessageSpy.mockClear();
    window.dispatchEvent(
      new MessageEvent("message", {
        source: window.parent,
        data: { jsonrpc: "2.0", id: 99, method: "ui/resource-teardown", params: {} },
      }),
    );
    expect(outbound().find((m) => m?.id === 99)).toEqual({ jsonrpc: "2.0", id: 99, result: {} });
  });

  it("stops delivering data after destroy()", () => {
    synapse = connectUI({ host: "mcp-apps", autoResize: false });
    const onData = vi.fn();
    synapse.onData(onData);
    synapse.destroy();
    notify(MCPAPP_TOOL_RESULT, { structuredContent: { domain: "late.com" } });
    expect(onData).not.toHaveBeenCalled();
  });

  it("ignores frames that are not JSON-RPC", () => {
    synapse = connectUI({ host: "mcp-apps", autoResize: false });
    const onData = vi.fn();
    synapse.onData(onData);
    window.dispatchEvent(
      new MessageEvent("message", {
        source: window.parent,
        data: { type: "ui-lifecycle-iframe-render-data", payload: { domain: "x.com" } },
      }),
    );
    expect(onData).not.toHaveBeenCalled();
    expect(synapse.data()).toBeNull();
  });
});

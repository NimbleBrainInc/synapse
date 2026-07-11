import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectUI } from "../host/connect.js";
import type { SynapseUIClient } from "../host/types.js";

/**
 * Simulated ChatGPT (OpenAI Apps SDK) host: a fake `window.openai` plus the
 * `openai:set_globals` broadcast the host uses to push updated globals.
 */
interface FakeOpenAi {
  toolOutput?: unknown;
  theme?: string;
  callTool: ReturnType<typeof vi.fn>;
  sendFollowUpMessage: ReturnType<typeof vi.fn>;
  openExternal: ReturnType<typeof vi.fn>;
}

function installFakeOpenAi(initial: Partial<FakeOpenAi>): FakeOpenAi {
  const openai: FakeOpenAi = {
    callTool: vi.fn().mockResolvedValue({ ok: true }),
    sendFollowUpMessage: vi.fn(),
    openExternal: vi.fn(),
    ...initial,
  };
  (window as unknown as { openai: FakeOpenAi }).openai = openai;
  return openai;
}

function pushGlobals(globals: Record<string, unknown>): void {
  window.dispatchEvent(new CustomEvent("openai:set_globals", { detail: { globals } }));
}

describe("connectUI — ChatGPT adapter", () => {
  let synapse: SynapseUIClient;

  beforeEach(() => {
    document.documentElement.removeAttribute("data-theme");
  });

  afterEach(() => {
    synapse?.destroy();
    (window as unknown as { openai?: unknown }).openai = undefined;
  });

  it("auto-detects the chatgpt host", () => {
    installFakeOpenAi({ toolOutput: { domain: "stripe.com" } });
    synapse = connectUI();
    expect(synapse.host()).toBe("chatgpt");
  });

  it("reads pushed data from window.openai.toolOutput synchronously", () => {
    installFakeOpenAi({ toolOutput: { domain: "stripe.com" } });
    synapse = connectUI();
    expect(synapse.data<{ domain: string }>()).toEqual({ domain: "stripe.com" });
  });

  it("delivers updates via openai:set_globals", () => {
    installFakeOpenAi({ toolOutput: { domain: "a.com" } });
    synapse = connectUI();
    const onData = vi.fn();
    synapse.onData(onData);

    pushGlobals({ toolOutput: { domain: "b.com" } });

    expect(onData).toHaveBeenCalledWith({ domain: "b.com" });
    expect(synapse.data<{ domain: string }>()).toEqual({ domain: "b.com" });
  });

  it("applies the initial theme to the DOM (light)", () => {
    installFakeOpenAi({ toolOutput: {}, theme: "light" });
    synapse = connectUI();
    expect(synapse.theme().mode).toBe("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("tracks theme changes via set_globals (light → dark)", () => {
    installFakeOpenAi({ toolOutput: {}, theme: "light" });
    synapse = connectUI();
    const onTheme = vi.fn();
    synapse.onTheme(onTheme);

    pushGlobals({ theme: "dark" });

    expect(onTheme).toHaveBeenCalledWith({ mode: "dark", tokens: {} });
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("sendPrompt calls window.openai.sendFollowUpMessage", () => {
    const openai = installFakeOpenAi({ toolOutput: {} });
    synapse = connectUI();
    synapse.sendPrompt("Dig deeper on stripe.com");
    expect(openai.sendFollowUpMessage).toHaveBeenCalledWith({ prompt: "Dig deeper on stripe.com" });
  });

  it("openLink calls window.openai.openExternal", () => {
    const openai = installFakeOpenAi({ toolOutput: {} });
    synapse = connectUI();
    synapse.openLink("https://example.com");
    expect(openai.openExternal).toHaveBeenCalledWith({ href: "https://example.com" });
  });

  it("callTool routes through window.openai.callTool (pull supported)", async () => {
    const openai = installFakeOpenAi({ toolOutput: {} });
    synapse = connectUI();
    expect(synapse.capabilities().pull).toBe(true);
    const out = await synapse.callTool("refresh", { domain: "x.com" });
    expect(openai.callTool).toHaveBeenCalledWith("refresh", { domain: "x.com" });
    expect(out).toEqual({ ok: true });
  });

  it("advertises sendPrompt + openLink + pull capabilities", () => {
    installFakeOpenAi({ toolOutput: {} });
    synapse = connectUI();
    expect(synapse.capabilities()).toEqual({ pull: true, sendPrompt: true, openLink: true });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectUI } from "../host/connect.js";
import type { SynapseUIClient } from "../host/types.js";

/**
 * Simulated-host harness. Renders a small, data-driven report — the same shape a
 * real Synapse component (Bassethound's dossier) uses: read `synapse.data()`,
 * subscribe to `onData`/`onTheme`, wire a link and a follow-up — then drives it
 * under a fake ChatGPT bridge and a fake mcp-ui bridge, in light and dark. This
 * is the cross-host proof: identical component code, both bridges, no host leak.
 */

interface Report {
  domain: string;
  company?: { name?: string };
}

/** A representative report renderer (mirrors the Bassethound bridge usage). */
function mountReport(synapse: SynapseUIClient): void {
  const app = document.getElementById("app");
  if (!app) throw new Error("no #app");

  function render(data: Report | null): void {
    app.textContent = "";
    if (!data || !data.domain) {
      app.appendChild(el("div", { class: "empty", text: "On the scent…" }));
      synapse.resize();
      return;
    }
    const head = el("h1", { class: "domain", text: data.domain });
    app.appendChild(head);
    if (data.company?.name)
      app.appendChild(el("div", { class: "company", text: data.company.name }));

    // A host-routed external link.
    const link = el("a", { class: "site", href: `https://${data.domain}`, text: data.domain });
    link.addEventListener("click", (e) => {
      if (synapse.capabilities().openLink && synapse.host() !== "generic") {
        e.preventDefault();
        synapse.openLink(`https://${data.domain}`);
      }
    });
    app.appendChild(link);

    // A follow-up affordance.
    const dig = el("button", { class: "dig", text: "Dig deeper" });
    dig.addEventListener("click", () => synapse.sendPrompt(`Dig deeper on ${data.domain}`));
    app.appendChild(dig);

    synapse.resize();
  }

  synapse.onData<Report>(render);
  render(synapse.data<Report>());
}

function el(tag: string, attrs: Record<string, string>): HTMLElement {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else node.setAttribute(k, v);
  }
  return node;
}

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  document.body.innerHTML = `<div id="app"></div>`;
  document.documentElement.removeAttribute("data-theme");
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  (window as unknown as { openai?: unknown }).openai = undefined;
  consoleErrorSpy.mockRestore();
  document.body.innerHTML = "";
});

// ---------------------------------------------------------------------------

describe("harness — ChatGPT bridge", () => {
  interface FakeOpenAi {
    toolOutput?: unknown;
    theme?: string;
    sendFollowUpMessage: ReturnType<typeof vi.fn>;
    openExternal: ReturnType<typeof vi.fn>;
  }

  function installOpenAi(toolOutput: unknown, theme: "light" | "dark"): FakeOpenAi {
    const openai: FakeOpenAi = {
      toolOutput,
      theme,
      sendFollowUpMessage: vi.fn(),
      openExternal: vi.fn(),
    };
    (window as unknown as { openai: FakeOpenAi }).openai = openai;
    return openai;
  }

  for (const mode of ["light", "dark"] as const) {
    it(`renders the report and themes correctly (${mode})`, () => {
      installOpenAi({ domain: "stripe.com", company: { name: "Stripe" } }, mode);
      const synapse = connectUI();
      mountReport(synapse);

      expect(document.querySelector(".domain")?.textContent).toBe("stripe.com");
      expect(document.querySelector(".company")?.textContent).toBe("Stripe");
      expect(document.documentElement.getAttribute("data-theme")).toBe(mode);
      expect(consoleErrorSpy).not.toHaveBeenCalled();
      synapse.destroy();
    });
  }

  it("re-renders on a pushed data update and follow-up reaches the host", () => {
    const openai = installOpenAi({ domain: "a.com" }, "light");
    const synapse = connectUI();
    mountReport(synapse);
    expect(document.querySelector(".domain")?.textContent).toBe("a.com");

    window.dispatchEvent(
      new CustomEvent("openai:set_globals", {
        detail: { globals: { toolOutput: { domain: "b.com" } } },
      }),
    );
    expect(document.querySelector(".domain")?.textContent).toBe("b.com");

    (document.querySelector(".dig") as HTMLButtonElement).click();
    expect(openai.sendFollowUpMessage).toHaveBeenCalledWith({ prompt: "Dig deeper on b.com" });

    (document.querySelector(".site") as HTMLAnchorElement).click();
    expect(openai.openExternal).toHaveBeenCalledWith({ href: "https://b.com" });
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    synapse.destroy();
  });
});

// ---------------------------------------------------------------------------

describe("harness — mcp-ui bridge", () => {
  let postMessageSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    postMessageSpy = vi.fn();
    window.parent.postMessage = postMessageSpy as typeof window.parent.postMessage;
  });

  function bake(data: unknown): void {
    const app = document.getElementById("app");
    const script = document.createElement("script");
    script.type = "application/json";
    script.id = "synapse-ui-data";
    script.textContent = JSON.stringify(data);
    app?.parentElement?.insertBefore(script, app);
  }

  function messagesOfType(type: string): Array<Record<string, unknown>> {
    return postMessageSpy.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .filter((m) => m && m.type === type);
  }

  for (const mode of ["light", "dark"] as const) {
    it(`renders the report from baked-in data and themes on render-data (${mode})`, () => {
      bake({ domain: "claude.ai", company: { name: "Anthropic" } });
      const synapse = connectUI({ host: "claude", autoResize: false });
      mountReport(synapse);

      // Baked-in data renders immediately.
      expect(document.querySelector(".domain")?.textContent).toBe("claude.ai");
      expect(document.querySelector(".company")?.textContent).toBe("Anthropic");

      // Host pushes a theme via render-data.
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "ui-lifecycle-iframe-render-data", payload: { theme: mode } },
        }),
      );
      expect(document.documentElement.getAttribute("data-theme")).toBe(mode);

      // A size report reached the host after render.
      expect(messagesOfType("ui-size-change").length).toBeGreaterThan(0);
      // Ready handshake was sent.
      expect(messagesOfType("ui-lifecycle-iframe-ready").length).toBe(1);
      expect(consoleErrorSpy).not.toHaveBeenCalled();
      synapse.destroy();
    });
  }

  it("routes link + follow-up through mcp-ui postMessage", () => {
    bake({ domain: "x.com" });
    const synapse = connectUI({ host: "claude", autoResize: false });
    mountReport(synapse);

    (document.querySelector(".site") as HTMLAnchorElement).click();
    expect(postMessageSpy).toHaveBeenCalledWith(
      { type: "link", payload: { url: "https://x.com" } },
      "*",
    );

    (document.querySelector(".dig") as HTMLButtonElement).click();
    expect(postMessageSpy).toHaveBeenCalledWith(
      { type: "prompt", payload: { prompt: "Dig deeper on x.com" } },
      "*",
    );
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    synapse.destroy();
  });
});

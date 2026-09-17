import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectUI } from "../host/connect.js";
import type { SynapseUIClient } from "../host/types.js";

/**
 * Simulated-host harness. Renders a small, data-driven report — the same shape a
 * real Synapse component (Bassethound's dossier) uses: read `synapse.data()`,
 * subscribe to `onData`/`onTheme`, wire a link and a follow-up — then drives it
 * under a fake MCP Apps host, in light and dark. Every host that frames a
 * component speaks that one bridge, so this is the cross-host proof.
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
  consoleErrorSpy.mockRestore();
  document.body.innerHTML = "";
});

// ---------------------------------------------------------------------------

describe("harness — MCP Apps bridge", () => {
  let postMessageSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    postMessageSpy = vi.fn();
    window.parent.postMessage = postMessageSpy as typeof window.parent.postMessage;
  });

  function outbound(method: string): Array<Record<string, unknown>> {
    return postMessageSpy.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .filter((m) => m && m.method === method);
  }

  function fromHost(data: Record<string, unknown>): void {
    window.dispatchEvent(
      new MessageEvent("message", { source: window.parent, data: { jsonrpc: "2.0", ...data } }),
    );
  }

  function bake(data: unknown): void {
    const app = document.getElementById("app");
    const script = document.createElement("script");
    script.type = "application/json";
    script.id = "synapse-ui-data";
    script.textContent = JSON.stringify(data);
    app?.parentElement?.insertBefore(script, app);
  }

  const flush = () => new Promise((r) => setTimeout(r, 0));

  for (const mode of ["light", "dark"] as const) {
    it(`renders pushed data and themes from the handshake (${mode})`, async () => {
      const synapse = connectUI({ host: "mcp-apps", autoResize: false });
      mountReport(synapse);
      expect(document.querySelector(".empty")).not.toBeNull();

      fromHost({ id: outbound("ui/initialize")[0].id, result: { hostContext: { theme: mode } } });
      await flush();
      expect(document.documentElement.getAttribute("data-theme")).toBe(mode);
      expect(outbound("ui/notifications/initialized").length).toBe(1);

      fromHost({
        method: "ui/notifications/tool-result",
        params: { structuredContent: { domain: "stripe.com", company: { name: "Stripe" } } },
      });
      expect(document.querySelector(".domain")?.textContent).toBe("stripe.com");
      expect(document.querySelector(".company")?.textContent).toBe("Stripe");
      // A size report reached the host after render.
      expect(outbound("ui/notifications/size-changed").length).toBeGreaterThan(0);
      expect(consoleErrorSpy).not.toHaveBeenCalled();
      synapse.destroy();
    });
  }

  it("renders baked-in data before the handshake", () => {
    bake({ domain: "baked.com" });
    const synapse = connectUI({ host: "mcp-apps", autoResize: false });
    mountReport(synapse);
    expect(document.querySelector(".domain")?.textContent).toBe("baked.com");
    synapse.destroy();
  });

  it("routes link + follow-up through ui/open-link and ui/message", () => {
    bake({ domain: "x.com" });
    const synapse = connectUI({ host: "mcp-apps", autoResize: false });
    mountReport(synapse);

    (document.querySelector(".site") as HTMLAnchorElement).click();
    expect(outbound("ui/open-link").at(-1)?.params).toEqual({ url: "https://x.com" });

    (document.querySelector(".dig") as HTMLButtonElement).click();
    expect(outbound("ui/message").at(-1)?.params).toEqual({
      role: "user",
      content: [{ type: "text", text: "Dig deeper on x.com" }],
    });
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    synapse.destroy();
  });
});

/**
 * The cross-host UI client as an app — the **vendored IIFE**, not the source.
 *
 * This page deliberately imports nothing. It reads `window.SynapseUI`, which the
 * page's first `<script>` defines from
 * `python/nimblebrain_synapse/_assets/synapse-ui.iife.js` — the artifact the
 * Python package actually ships and a self-contained `ui://` component actually
 * inlines. Bundling the TypeScript instead would test a build no server serves.
 */

interface SynapseUIClient {
  data<T>(): T;
  onData<T>(cb: (data: T) => void): () => void;
  theme(): { mode: string; tokens: Record<string, string> };
  onTheme(cb: (t: { mode: string }) => void): () => void;
  callTool<O>(name: string, args?: Record<string, unknown>): Promise<O>;
  sendPrompt(text: string): void;
  openLink(url: string): void;
  resize(height?: number): void;
  capabilities(): Record<string, boolean>;
  host(): string;
}

const results: Record<string, unknown> = {};
(window as unknown as { __results: unknown }).__results = results;

async function step(key: string, fn: () => Promise<unknown> | unknown): Promise<void> {
  try {
    results[key] = { ok: true, value: await fn() };
  } catch (e) {
    results[key] = { ok: false, error: String(e) };
  }
}

document.body.innerHTML = '<div style="height:120px">conformance</div>';

const host = window as unknown as {
  SynapseUI?: { connect(options: Record<string, unknown>): SynapseUIClient };
};

if (!host.SynapseUI) {
  results.connect = { ok: false, error: "window.SynapseUI is undefined — vendored IIFE missing" };
  results.finished = true;
} else {
  // No `host` override: the client must detect a framed context and pick the
  // MCP Apps adapter on its own. Forcing the adapter would skip the detection
  // this suite exists to check.
  const synapse = host.SynapseUI.connect({ name: "conformance-ui", version: "1.0.0" });
  results.connect = { ok: true };
  results.host = synapse.host();
  results.capabilities = synapse.capabilities();

  synapse.onData((data: unknown) => {
    results.data = data;
  });
  synapse.onTheme((theme) => {
    results.themeChanged = theme.mode;
  });

  // The handshake is asynchronous; give it a turn before pulling.
  await new Promise((resolve) => setTimeout(resolve, 400));
  results.themeAfterHandshake = synapse.theme().mode;

  await step("callTool", () => synapse.callTool("echo", { a: 1 }));
  await step("openLink", () => synapse.openLink("https://example.com"));
  await step("sendPrompt", () => synapse.sendPrompt("hi"));
  await step("resize", () => synapse.resize(321));

  results.finished = true;
}

// This page imports nothing on purpose (it reads the vendored global), so an
// empty export is what makes it a module and allows the top-level awaits above.
export {};

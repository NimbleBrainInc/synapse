import { selectAdapter } from "./detect.js";
import { applyHostTheme } from "./theme.js";
import {
  type ConnectUIOptions,
  isToolError,
  type SynapseUIClient,
  ToolCallError,
} from "./types.js";

/**
 * Connect a Synapse-authored component to whatever host it renders in — any MCP
 * Apps host, or a plain/standalone page — behind one push-first API. Detects
 * whether it is framed, selects an adapter, and applies the
 * host theme to the DOM before returning.
 *
 * Synchronous: `data()` is populated from baked-in data (where present) on
 * return, and pushed updates arrive via `onData`. Bind the result to `synapse`:
 *
 * ```ts
 * const synapse = connectUI({ name: "my-widget", version: "1.0.0" });
 * synapse.onData(render);        // future pushes/updates
 * render(synapse.data());        // current value (null → empty state)
 * ```
 */
export function connectUI(options: ConnectUIOptions = {}): SynapseUIClient {
  const win = options.window ?? (globalThis as unknown as Window & typeof globalThis);
  const adapter = selectAdapter(win, options);

  // The client owns theme application: adapters resolve mode/tokens; this puts
  // them on the DOM (data-theme + CSS vars) so apps never wire theme by hand.
  applyHostTheme(adapter.getTheme());
  const unsubTheme = adapter.onTheme(applyHostTheme);

  adapter.start();

  let destroyed = false;

  return {
    data: <T>() => adapter.getData<T>(),
    onData: <T>(cb: (data: T) => void) => adapter.onData<T>(cb),
    theme: () => adapter.getTheme(),
    onTheme: (cb) => adapter.onTheme(cb),
    // Decided here rather than per adapter: every host reports a failed or
    // refused call inside the result, because that is how MCP defines one.
    async callTool<O>(name: string, args?: Record<string, unknown>): Promise<O> {
      const result = await adapter.callTool<O>(name, args);
      if (isToolError(result)) throw new ToolCallError(name, result);
      return result;
    },
    sendPrompt: (text: string) => adapter.sendPrompt(text),
    openLink: (url: string) => adapter.openLink(url),
    resize: (height?: number) => adapter.resize(height),
    capabilities: () => adapter.capabilities(),
    host: () => adapter.host,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      unsubTheme();
      adapter.destroy();
    },
  };
}

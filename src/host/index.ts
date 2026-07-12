/**
 * `@nimblebrain/synapse/host` — the cross-host UI client.
 *
 * A framework-agnostic, push-first surface for rendering one Synapse component
 * across ChatGPT (OpenAI Apps SDK), Claude (MCP Apps standard), and standalone. No
 * dependency on `@modelcontextprotocol/*`, so a non-React component can inline
 * the IIFE build (`window.SynapseUI`) without pulling Zod or the ext-apps schemas.
 */
export { createChatGPTAdapter } from "./adapters/chatgpt.js";
export { createInlineAdapter } from "./adapters/inline.js";
export { createMcpAppsAdapter } from "./adapters/mcpapps.js";
export { connectUI } from "./connect.js";
export { adapterForKind, detectHostKind, selectAdapter } from "./detect.js";
export { applyHostTheme, coerceMode, preferredMode } from "./theme.js";
export {
  type ConnectUIOptions,
  type HostAdapter,
  type HostCapabilities,
  type HostKind,
  HostUnsupportedError,
  SYNAPSE_DATA_ELEMENT_ID,
  type SynapseUIClient,
  type SynapseUITheme,
} from "./types.js";

/**
 * `@nimblebrain/synapse/host` — the cross-host UI client.
 *
 * A framework-agnostic, push-first surface for rendering one Synapse component
 * in any MCP Apps host (ChatGPT, Claude, NimbleBrain) and standalone. No
 * dependency on `@modelcontextprotocol/*`, so a non-React component can inline
 * the IIFE build (`window.SynapseUI`) without pulling Zod or the ext-apps schemas.
 *
 * It also exports the gutter's defaults, with no dependency on React, so a host may
 * import them to match the kit's breakpoint and values.
 */
export {
  GUTTER_DEFAULT,
  GUTTER_NARROW_BREAKPOINT,
  GUTTER_NARROW_DEFAULT,
} from "../theme-defaults.js";
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
  ToolCallError,
} from "./types.js";

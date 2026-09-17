import type { McpUiHostCapabilities } from "@modelcontextprotocol/ext-apps";
import { NIMBLEBRAIN_EXTENSIONS } from "../../event-map.js";

/**
 * Every NimbleBrain extension, declared the way a host declares them.
 */
export const NIMBLEBRAIN_EXTENSION_CAPABILITIES: Record<string, object> = Object.fromEntries(
  Object.values(NIMBLEBRAIN_EXTENSIONS).map(({ capability }) => [capability, {}]),
);

/**
 * A host that declares every capability `connect()` gates on, except tasks.
 * Tests of what an app does with a capability start here. Tests of what it
 * does without one declare less; tasks tests declare tasks themselves.
 */
export const FULL_HOST_CAPABILITIES: McpUiHostCapabilities = {
  openLinks: {},
  downloadFile: {},
  serverTools: {},
  serverResources: { listChanged: true },
  updateModelContext: { text: {}, structuredContent: {} },
  message: { text: {} },
  experimental: { ...NIMBLEBRAIN_EXTENSION_CAPABILITIES },
};

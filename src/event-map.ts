import {
  HOST_CONTEXT_CHANGED_METHOD,
  RESOURCE_TEARDOWN_METHOD,
  TOOL_CANCELLED_METHOD,
  TOOL_INPUT_METHOD,
  TOOL_INPUT_PARTIAL_METHOD,
  TOOL_RESULT_METHOD,
} from "@modelcontextprotocol/ext-apps";
import type {
  CallToolRequest,
  ListResourcesRequest,
  ReadResourceRequest,
  ResourceListChangedNotification,
} from "@modelcontextprotocol/sdk/types.js";

/**
 * A server's own `tools/call`. Core MCP, so the same reasoning as the resource
 * methods below: no constant to import, and typing the literal with the SDK's
 * own `method` field still breaks the build if it is renamed.
 */
export const TOOLS_CALL_METHOD: CallToolRequest["method"] = "tools/call";

/**
 * A server's own resource methods. Core MCP rather than ext-apps, so there are
 * no constants to import; typing each literal with the SDK's own `method` field
 * still breaks the build if one is renamed.
 *
 * `serverResources` in a host's `hostCapabilities` is the promise to carry all
 * three: the object itself says the host proxies resource reads, and its
 * `listChanged` says the host forwards the notification to that server's views.
 * A host announcing it owes an answer to every method here.
 */
export const RESOURCE_LIST_CHANGED_METHOD: ResourceListChangedNotification["method"] =
  "notifications/resources/list_changed";
export const READ_RESOURCE_METHOD: ReadResourceRequest["method"] = "resources/read";
export const LIST_RESOURCES_METHOD: ListResourcesRequest["method"] = "resources/list";

/**
 * NimbleBrain extension methods. No spec equivalent, so no constant to import
 * — but naming them once here means no source file spells the wire string
 * twice, and the `synapse/` prefix keeps them visibly outside the spec.
 * Hosts that don't implement them simply never send them.
 */
export const ACTION_METHOD = "synapse/action";
export const REQUEST_FILE_METHOD = "synapse/request-file";
export const KEYDOWN_METHOD = "synapse/keydown";

/**
 * Maps short event names used in App.on() to full MCP method names.
 * Uses canonical constants from @modelcontextprotocol/ext-apps to stay
 * in sync with the spec — if the spec changes a method name, this breaks
 * at compile time, not silently at runtime.
 *
 * `theme-changed` and `host-context-changed` are deliberately absent:
 * `connect()` routes both itself, because each is a typed *view* over the same
 * notification rather than its raw params. Listing them here would be a second
 * table nothing consults — the kind of copy that goes wrong quietly because
 * nothing reads it to notice.
 */
const EVENT_MAP: Record<string, string> = {
  "tool-result": TOOL_RESULT_METHOD,
  "tool-input": TOOL_INPUT_METHOD,
  "tool-input-partial": TOOL_INPUT_PARTIAL_METHOD,
  "tool-cancelled": TOOL_CANCELLED_METHOD,
  teardown: RESOURCE_TEARDOWN_METHOD,
};

/**
 * Resolve a short event name to a full MCP method name.
 * Returns the mapped method if found, otherwise passes through as-is.
 */
export function resolveEventMethod(name: string): string {
  return EVENT_MAP[name] ?? name;
}

/** The wire method behind the `theme-changed` / `host-context-changed` events. */
export { HOST_CONTEXT_CHANGED_METHOD };

import {
  HOST_CONTEXT_CHANGED_METHOD,
  RESOURCE_TEARDOWN_METHOD,
  TOOL_CANCELLED_METHOD,
  TOOL_INPUT_METHOD,
  TOOL_INPUT_PARTIAL_METHOD,
  TOOL_RESULT_METHOD,
} from "@modelcontextprotocol/ext-apps";

/**
 * NimbleBrain extension methods. No spec equivalent, so no constant to import
 * — but naming them once here means no source file spells the wire string
 * twice, and the `synapse/` prefix keeps them visibly outside the spec.
 * Hosts that don't implement them simply never send them.
 */
export const DATA_CHANGED_METHOD = "synapse/data-changed";
export const ACTION_METHOD = "synapse/action";
export const REQUEST_FILE_METHOD = "synapse/request-file";
export const DOWNLOAD_FILE_METHOD = "synapse/download-file";

/**
 * Maps short event names used in App.on() to full MCP method names.
 * Uses canonical constants from @modelcontextprotocol/ext-apps to stay
 * in sync with the spec — if the spec changes a method name, this breaks
 * at compile time, not silently at runtime.
 *
 * `theme-changed`, `host-context-changed`, `data-changed` and `action` are
 * deliberately absent: `connect()` routes each of those itself, because each is
 * a typed *view* over a notification rather than the notification's raw params
 * (and the first two are two views over the same one). Listing them here would
 * be a second table nothing consults — the kind of copy that goes wrong quietly
 * because nothing reads it to notice.
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

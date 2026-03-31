/**
 * Maps short event names used in App.on() to full MCP method names.
 */
const EVENT_MAP: Record<string, string> = {
  "tool-result": "ui/notifications/tool-result",
  "tool-input": "ui/notifications/tool-input",
  "tool-input-partial": "ui/notifications/tool-input-partial",
  "tool-cancelled": "ui/notifications/tool-cancelled",
  "theme-changed": "ui/notifications/host-context-changed",
  teardown: "ui/resource-teardown",
};

/**
 * Resolve a short event name to a full MCP method name.
 * Returns the mapped method if found, otherwise passes through as-is.
 */
export function resolveEventMethod(name: string): string {
  return EVENT_MAP[name] ?? name;
}

import type { Task } from "@modelcontextprotocol/client";

/**
 * Thrown when an app asks for something the host did not declare in
 * `ui/initialize`.
 *
 * The request is never sent. A host that does not implement a request may never
 * answer it, and this SDK's requests carry no deadline, so sending anyway would
 * leave the caller waiting forever rather than failing.
 *
 * `capability` names what was missing, as the host would have declared it: a
 * `hostCapabilities` field (`serverTools`, `downloadFile`) or an extension
 * identifier (`ai.nimblebrain/request-file`, `io.modelcontextprotocol/tasks`).
 */
export class HostCapabilityError extends Error {
  readonly capability: string;

  constructor(feature: string, capability: string) {
    super(`${feature} is not supported in this host: it did not declare ${capability}`);
    this.name = "HostCapabilityError";
    this.capability = capability;
  }
}

/**
 * Thrown by a task handle's `result()` when the task ends without a result:
 * it `failed` (the message and `code` are the host's inlined error), was
 * `cancelled`, or asked for input this SDK cannot provide (`input_required`,
 * after which the handle cancels it).
 *
 * `task` is the task as last reported, so `task.status` says which.
 */
export class TaskError extends Error {
  readonly task: Task;
  readonly code: number | undefined;

  constructor(message: string, task: Task, code?: number) {
    super(message);
    this.name = "TaskError";
    this.task = task;
    this.code = code;
  }
}

/** JSON-RPC error code a host answers a request it timed out with. */
const REQUEST_TIMEOUT_CODE = -32001;

/**
 * Whether `err` is a host's answer to a request the browser interrupted by
 * suspending the page: JSON-RPC error `-32001` with a numeric
 * `data.suspendedMs`, the time the page was suspended.
 *
 * It tells client sleep from server slowness. A `-32001` without
 * `suspendedMs` is a request the server took too long to answer, and says
 * nothing about whether the tool ran; one with it was cut off by the page
 * sleeping. Either way the tool may have run, so only a call the app knows to be
 * read-only is safe to send again (`callTool`'s `readOnly` option does this).
 *
 * Checked structurally, so it matches the error whichever copy of the MCP
 * client built it.
 */
export function isSuspensionError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const { code, data } = err as { code?: unknown; data?: unknown };
  if (code !== REQUEST_TIMEOUT_CODE || typeof data !== "object" || data === null) return false;
  return typeof (data as { suspendedMs?: unknown }).suspendedMs === "number";
}

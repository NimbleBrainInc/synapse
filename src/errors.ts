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

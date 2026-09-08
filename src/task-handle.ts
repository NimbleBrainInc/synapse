import type {
  CallToolRequest,
  CancelTaskRequest,
  CancelTaskResult,
  CreateTaskResult,
  GetTaskPayloadRequest,
  GetTaskPayloadResult,
  GetTaskRequest,
  GetTaskResult,
  Task,
  TaskStatus,
  TaskStatusNotification,
  TaskStatusNotificationParams,
} from "@modelcontextprotocol/sdk/types.js";

import { parseToolResult } from "./result-parser.js";
import type { SynapseTransport } from "./transport.js";
import type {
  App,
  CallToolAsTaskOptions,
  TaskHandle,
  TaskStatusRouter,
  TaskStatusUpdate,
  ToolCallResult,
} from "./types.js";

export type { TaskStatusRouter, TaskStatusUpdate };

// -----------------------------------------------------------------------------
// Spec method constants
// -----------------------------------------------------------------------------
//
// The MCP SDK publishes task-method strings only inside Zod `z.literal(...)`s,
// not as top-level `*_METHOD` constants. Derive each from its request's
// `method` type so an upstream rename surfaces here as a compile error
// (same pattern as `READ_RESOURCE_METHOD` in core.ts / connect.ts).
//
// When adding a new method here, also mirror it in `src/_shims/ext-apps.ts`
// per the IIFE build instructions in CLAUDE.md — the shim must export the
// same string constants any source file consumes.

export const TOOLS_CALL_METHOD: CallToolRequest["method"] = "tools/call";
export const TASKS_GET_METHOD: GetTaskRequest["method"] = "tasks/get";
export const TASKS_RESULT_METHOD: GetTaskPayloadRequest["method"] = "tasks/result";
export const TASKS_CANCEL_METHOD: CancelTaskRequest["method"] = "tasks/cancel";
export const TASKS_STATUS_NOTIFICATION_METHOD: TaskStatusNotification["method"] =
  "notifications/tasks/status";

// -----------------------------------------------------------------------------
// Status router
// -----------------------------------------------------------------------------

export function createTaskStatusRouter(transport: SynapseTransport): TaskStatusRouter {
  const listeners = new Map<string, Set<(update: TaskStatusUpdate) => void>>();

  // Single transport-level subscription. All per-handle listeners filter
  // in-memory by taskId off this one wire handler.
  const unsub = transport.onMessage(TASKS_STATUS_NOTIFICATION_METHOD, (rawParams) => {
    if (!rawParams) return;
    const params = rawParams as unknown as TaskStatusNotificationParams;
    const taskId = params.taskId;
    if (typeof taskId !== "string") return;

    const set = listeners.get(taskId);
    if (!set || set.size === 0) return;

    // Forward the spec-guaranteed fields verbatim. We deliberately don't
    // fabricate `createdAt`/`lastUpdatedAt`/`ttl` here — the handle merges
    // these from its initial `CreateTaskResult.task` so consumers always
    // see a real Task with no placeholder strings.
    const update: TaskStatusUpdate = {
      taskId: params.taskId,
      status: params.status,
      ...(params.statusMessage !== undefined && { statusMessage: params.statusMessage }),
    };

    for (const cb of set) cb(update);
  });

  return {
    subscribe(taskId, cb) {
      let set = listeners.get(taskId);
      if (!set) {
        set = new Set();
        listeners.set(taskId, set);
      }
      set.add(cb);
      return () => {
        const s = listeners.get(taskId);
        if (!s) return;
        s.delete(cb);
        if (s.size === 0) listeners.delete(taskId);
      };
    },
    dispose() {
      listeners.clear();
      unsub();
    },
  };
}

// -----------------------------------------------------------------------------
// Caller-facing factory
// -----------------------------------------------------------------------------

/**
 * Task-augment a `tools/call` per the MCP 2025-11-25 tasks utility.
 *
 * A composable helper over {@link App} rather than a method on it: the object
 * `connect()` returns carries the ext-apps surface, and tasks ride alongside.
 * The receiver answers a task-augmented call with a `CreateTaskResult`
 * promptly; the actual `CallToolResult` arrives later via `tasks/result`.
 *
 * ```ts
 * const handle = await callToolAsTask(app, "deep_research", { topic });
 * handle.onStatus((t) => setStatus(t.status));
 * const result = await handle.result();
 * ```
 *
 * Throws if the host did not advertise `tasks.requests.tools.call` — per spec
 * a requestor MUST NOT task-augment without matching receiver capability.
 * Fall back to `app.callTool`.
 */
export async function callToolAsTask<TOutput = unknown>(
  app: App,
  toolName: string,
  args?: unknown,
  options?: CallToolAsTaskOptions,
): Promise<TaskHandle<TOutput>> {
  const deps = app._internals;
  const hostTasks = deps.hostTasksCapability;
  if (!hostTasks?.requests?.tools?.call) {
    throw new Error(
      "callToolAsTask: host did not advertise tasks.requests.tools.call in its capabilities. " +
        "Per MCP 2025-11-25 §, requestors MUST NOT task-augment a tools/call without " +
        "matching receiver capability. Fall back to `app.callTool`.",
    );
  }

  // Per spec, `task` is an object even when the caller provides no hints —
  // its presence is the signal to the receiver that augmentation is
  // requested. An empty `{}` is valid.
  const taskParam: { ttl?: number } = {};
  if (options?.ttl !== undefined) taskParam.ttl = options.ttl;

  // `internal` resolution:
  //   - explicit `options.internal === true`  → cross-server, add `server`
  //   - explicit `options.internal === false` → never add `server`
  //   - omitted                                → inherit from app-level
  //                                              `internal` flag (same
  //                                              semantics as `callTool`)
  const crossServer = options?.internal ?? deps.internalApp;

  // Build `tools/call` params. We layer our own shape on the SDK's
  // `CallToolRequest["params"]` via `satisfies` so any rename upstream
  // (`name` → `toolName`, `arguments` → `args`, etc.) trips tsc. The
  // `server` extension is a NimbleBrain bridge convention, not an MCP
  // spec field.
  const callParams = {
    name: toolName,
    arguments: (args as Record<string, unknown> | undefined) ?? {},
    task: taskParam,
    ...(crossServer ? { server: deps.appName } : {}),
  } satisfies CallToolRequest["params"] & { server?: string };

  const raw = await deps.request(
    TOOLS_CALL_METHOD,
    callParams as unknown as Record<string, unknown>,
  );

  // Spec: task-augmented `tools/call` returns a `CreateTaskResult`. If a
  // receiver that advertised the capability returns a bare
  // `CallToolResult` instead, that's a protocol violation — surface it.
  const createResult = raw as CreateTaskResult | null | undefined;
  const initialTask = createResult?.task;
  if (!initialTask || typeof initialTask !== "object" || typeof initialTask.taskId !== "string") {
    throw new Error(
      "callToolAsTask: receiver returned a response without `task` per CreateTaskResult " +
        "(expected shape: `{ task: { taskId, status, ... } }`). Receiver may not honor " +
        "the advertised tasks capability.",
    );
  }

  const taskId = initialTask.taskId;

  // Preserve the Set-semantic dedup contract on `onStatus` (matches
  // `SynapseTransport.onMessage`): registering the same callback twice
  // collapses to one wire subscription, and either returned unsub
  // releases it. Without this, every `onStatus(cb)` would create a
  // fresh wrapper that the router treats as distinct.
  const localCallbacks = new Map<(task: Task) => void, () => void>();

  const handle: TaskHandle<TOutput> = {
    task: initialTask,

    async result(): Promise<ToolCallResult<TOutput>> {
      const params = { taskId } satisfies GetTaskPayloadRequest["params"];
      const rawResult = await deps.request(
        TASKS_RESULT_METHOD,
        params as unknown as Record<string, unknown>,
      );
      // Per spec §: `tasks/result` returns exactly what the non-task
      // response would return. Parse through the shared tool-result
      // parser so `_meta["io.modelcontextprotocol/related-task"]`
      // propagates unchanged (key-preserving spread).
      //
      // Type note: `GetTaskPayloadResult` is a union of result shapes
      // (one per augmentable request type). For `tools/call` tasks,
      // the runtime shape is `CallToolResult`, which `parseToolResult`
      // already handles.
      const typed = rawResult as GetTaskPayloadResult;
      return parseToolResult(typed) as ToolCallResult<TOutput>;
    },

    async refresh(): Promise<Task> {
      const params = { taskId } satisfies GetTaskRequest["params"];
      const raw = await deps.request(
        TASKS_GET_METHOD,
        params as unknown as Record<string, unknown>,
      );
      // Per spec, `tasks/get` returns the task shape FLAT (taskId, status,
      // ttl, createdAt, lastUpdatedAt, ... at the top level) — NOT
      // wrapped in a `{ task }` field (unlike `CreateTaskResult`).
      return projectTask(raw as GetTaskResult);
    },

    async cancel(): Promise<Task> {
      const params = { taskId } satisfies CancelTaskRequest["params"];
      const raw = await deps.request(
        TASKS_CANCEL_METHOD,
        params as unknown as Record<string, unknown>,
      );
      // `CancelTaskResult` is flat like `GetTaskResult`.
      return projectTask(raw as CancelTaskResult);
    },

    onStatus(cb) {
      // Idempotent-in-callback: if the same `cb` is already subscribed,
      // return the existing unsub.
      const existing = localCallbacks.get(cb);
      if (existing) return existing;

      // Merge the notification's spec-guaranteed fields (taskId, status,
      // statusMessage) with the handle's initial `CreateTaskResult.task`
      // so the consumer always sees a full valid `Task`. `lastUpdatedAt`
      // is stamped at SDK-receive time (an approximation of the host's
      // update time — the spec doesn't wire the host's timestamp through
      // the notification, so this is the closest signal we have).
      // `createdAt`, `ttl`, `pollInterval` come from the initial task
      // because they don't change over a task's lifetime.
      const wireUnsub = deps.taskRouter.subscribe(taskId, (update) => {
        const merged: Task = {
          taskId: update.taskId,
          status: update.status,
          ttl: initialTask.ttl,
          createdAt: initialTask.createdAt,
          lastUpdatedAt: new Date().toISOString(),
          ...(initialTask.pollInterval !== undefined && {
            pollInterval: initialTask.pollInterval,
          }),
          ...(update.statusMessage !== undefined && { statusMessage: update.statusMessage }),
        };
        cb(merged);
      });

      const unsub = () => {
        localCallbacks.delete(cb);
        wireUnsub();
      };
      localCallbacks.set(cb, unsub);
      return unsub;
    },
  };

  return handle;
}

// -----------------------------------------------------------------------------
// Internal helpers
// -----------------------------------------------------------------------------

/**
 * Project a `GetTaskResult` / `CancelTaskResult` down to the canonical
 * `Task` shape. Both result types are structurally `Task` with an
 * optional `_meta` field on top; we project explicitly so consumers
 * don't see protocol-level `_meta` leaking onto the task state they
 * get back from `refresh()` / `cancel()`.
 *
 * Asymmetry note: `parseToolResult` (for `tools/call` / `tasks/result`
 * payloads) is key-preserving — `_meta` flows through end-to-end, which
 * matters for `io.modelcontextprotocol/related-task` correlation. Here
 * we drop `_meta` because no downstream consumer reads it on `Task` state
 * today. If a host starts stamping useful keys on `tasks/get`/`tasks/cancel`
 * responses, switch to a key-preserving projection.
 */
function projectTask(raw: GetTaskResult | CancelTaskResult): Task {
  return {
    taskId: raw.taskId,
    status: raw.status,
    ttl: raw.ttl,
    createdAt: raw.createdAt,
    lastUpdatedAt: raw.lastUpdatedAt,
    ...(raw.pollInterval !== undefined && { pollInterval: raw.pollInterval }),
    ...(raw.statusMessage !== undefined && { statusMessage: raw.statusMessage }),
  };
}

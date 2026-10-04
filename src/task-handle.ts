import type {
  CallToolRequest,
  CallToolResult,
  CancelTaskRequest,
  CLIENT_CAPABILITIES_META_KEY as ClientCapabilitiesMetaKey,
  GetTaskRequest,
  Task,
  TaskStatus,
} from "@modelcontextprotocol/client";
import type { McpUiHostCapabilities } from "@modelcontextprotocol/ext-apps";

import { HostCapabilityError, TaskError } from "./errors.js";
import { TOOLS_CALL_METHOD } from "./event-map.js";
import { internalsFor } from "./internals.js";
import { parseToolResult } from "./result-parser.js";
import type {
  App,
  TaskHandle,
  TaskResultOptions,
  TasksCapability,
  ToolCallResult,
} from "./types.js";

// -----------------------------------------------------------------------------
// The MCP tasks extension (`io.modelcontextprotocol/tasks`, protocol 2026-07-28)
// -----------------------------------------------------------------------------

/** The MCP tasks extension identifier. */
export const TASKS_EXTENSION_ID = "io.modelcontextprotocol/tasks";

/**
 * The request `_meta` key a client declares its capabilities under. The SDK
 * exports it as a value from its runtime; it is typed from that export here so
 * a rename fails `tsc` without pulling the SDK runtime into this module.
 */
const CLIENT_CAPABILITIES_META_KEY: typeof ClientCapabilitiesMetaKey =
  "io.modelcontextprotocol/clientCapabilities";

// The SDK publishes task-method strings only inside Zod `z.literal(...)`s. Each
// is typed from its request's `method`, so an upstream rename is a compile
// error (same pattern as the core-MCP constants in event-map.ts).
export const TASKS_GET_METHOD: GetTaskRequest["method"] = "tasks/get";
export const TASKS_CANCEL_METHOD: CancelTaskRequest["method"] = "tasks/cancel";

/**
 * The host's tasks capability, from the `ui/initialize` result.
 *
 * It lives in `hostCapabilities.experimental` under the extension identifier,
 * the one slot a spec client's handshake parse keeps. Presence is the signal:
 * the extension defines no settings, so a host declares `{}`. A top-level
 * `tasks` is not read, and neither is any other key.
 */
export function readHostTasksCapability(
  capabilities: McpUiHostCapabilities | undefined,
): TasksCapability | undefined {
  const entry = capabilities?.experimental?.[TASKS_EXTENSION_ID];
  return entry && typeof entry === "object" && !Array.isArray(entry)
    ? (entry as TasksCapability)
    : undefined;
}

/**
 * A task as the extension puts it on the wire: the answer to a `tools/call`
 * the server chose to run as a task, and the answer to `tasks/get`. A terminal
 * `tasks/get` inlines the outcome: `result` when `completed`, `error` when
 * `failed`.
 *
 * Declared here because the MCP SDK's `Task` types are the 2025-11-25 shape
 * (`ttl`, `pollInterval`, no inlined outcome).
 */
interface WireTask {
  resultType?: string;
  taskId: string;
  status: TaskStatus;
  createdAt: string;
  lastUpdatedAt: string;
  ttlMs?: number | null;
  pollIntervalMs?: number;
  statusMessage?: string;
  result?: CallToolResult;
  error?: { code?: number; message?: string };
}

/** Poll cadence when the task names none, and the floor under one it names. */
const DEFAULT_POLL_INTERVAL_MS = 2_000;
const MIN_POLL_INTERVAL_MS = 250;
/** Consecutive failed `tasks/get` polls after which `result()` rejects. */
const MAX_POLL_FAILURES = 3;

// -----------------------------------------------------------------------------
// Caller-facing factory
// -----------------------------------------------------------------------------

/**
 * Call a tool the server may run as a task, per the MCP tasks extension
 * (`io.modelcontextprotocol/tasks`, protocol 2026-07-28).
 *
 * The call declares the extension in its request `_meta`, and the server
 * decides: it answers outright with the tool's result, or with a task the
 * handle then polls through `tasks/get`. Both come back as a handle, so a
 * caller has one code path; an answered call's handle is already `completed`.
 *
 * ```ts
 * const handle = await callToolAsTask(app, "deep_research", { topic });
 * handle.onStatus((t) => setStatus(t.status));
 * const result = await handle.result();
 * ```
 *
 * Rejects with `HostCapabilityError`, without sending, if the host did not
 * declare the extension. Check `app.supportsTasks` first, and fall back to
 * `app.callTool`.
 */
export async function callToolAsTask<TOutput = unknown>(
  app: App,
  toolName: string,
  args?: unknown,
): Promise<TaskHandle<TOutput>> {
  const deps = internalsFor(app);
  if (!deps.hostTasksCapability) {
    throw new HostCapabilityError("callToolAsTask", TASKS_EXTENSION_ID);
  }

  const callParams = {
    name: toolName,
    arguments: (args as Record<string, unknown> | undefined) ?? {},
    _meta: {
      [CLIENT_CAPABILITIES_META_KEY]: { extensions: { [TASKS_EXTENSION_ID]: {} } },
    },
  } satisfies CallToolRequest["params"];

  const raw = await deps.request(TOOLS_CALL_METHOD, callParams);

  if (!isWireTask(raw)) return answeredHandle<TOutput>(raw);

  const request = deps.request;
  const taskId = raw.taskId;
  const listeners = new Set<(task: Task) => void>();
  let lastSeen = toTask(raw);

  /** Record a task the host reported, and tell subscribers when it moved. */
  function observe(wire: WireTask): Task {
    const task = toTask(wire);
    const moved = task.status !== lastSeen.status || task.statusMessage !== lastSeen.statusMessage;
    lastSeen = task;
    if (moved) {
      for (const cb of [...listeners]) {
        try {
          cb(task);
        } catch {
          // A subscriber's throw must not stop the poll that feeds the others.
        }
      }
    }
    return task;
  }

  async function get(): Promise<WireTask> {
    const wire = await request(TASKS_GET_METHOD, { taskId } satisfies GetTaskRequest["params"]);
    if (!isTaskShaped(wire)) {
      throw new Error(`callToolAsTask: tasks/get for ${taskId} did not answer with a task`);
    }
    observe(wire);
    return wire;
  }

  async function sendCancel(): Promise<void> {
    await request(TASKS_CANCEL_METHOD, { taskId } satisfies CancelTaskRequest["params"]);
  }

  return {
    task: lastSeen,

    async result(options?: TaskResultOptions): Promise<ToolCallResult<TOutput>> {
      const signal = options?.signal;
      let wire: WireTask = raw;
      let fetched = false;
      // A `tasks/get` that omits `pollIntervalMs` keeps the last one named.
      let hinted = raw.pollIntervalMs;
      let failures = 0;
      for (;;) {
        if (typeof wire.pollIntervalMs === "number") hinted = wire.pollIntervalMs;
        signal?.throwIfAborted();
        switch (wire.status) {
          case "completed":
            if (wire.result) return parseToolResult(wire.result) as ToolCallResult<TOutput>;
            if (fetched) {
              throw new Error(`callToolAsTask: task ${taskId} completed without a result`);
            }
            break;
          case "failed":
            throw new TaskError(
              wire.error?.message ?? wire.statusMessage ?? `Task ${taskId} failed`,
              toTask(wire),
              wire.error?.code,
            );
          case "cancelled":
            throw new TaskError(`Task ${taskId} was cancelled`, toTask(wire));
          case "input_required":
            // This SDK cannot answer an input request, so the task can never
            // finish. Cancel it rather than leave it held on the server.
            await sendCancel().catch(() => {});
            throw new TaskError(
              `Task ${taskId} asked for input, which this app cannot provide; it was cancelled`,
              toTask(wire),
            );
          default:
            await wait(pollDelay(hinted), signal);
        }
        if (app.destroyed) throw new Error(`callToolAsTask: app destroyed while ${taskId} ran`);
        try {
          wire = await get();
          fetched = true;
          failures = 0;
        } catch (err) {
          // A poll can fail without the task failing. Only an unknown task
          // (-32602) or a run of failures ends the wait.
          failures += 1;
          if (failures >= MAX_POLL_FAILURES || (err as { code?: unknown })?.code === -32602) {
            throw err;
          }
        }
      }
    },

    async refresh(): Promise<Task> {
      return toTask(await get());
    },

    async cancel(): Promise<Task> {
      await sendCancel();
      return toTask(await get());
    },

    onStatus(cb) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
  };
}

// -----------------------------------------------------------------------------
// Internal helpers
// -----------------------------------------------------------------------------

/**
 * Whether a `tools/call` answer is a task rather than the tool's result.
 *
 * The wire marks a task `resultType: "task"`, but the MCP SDK's 2025-era
 * result codec strips `resultType` before a result reaches this code. So it is
 * honoured when present, and otherwise the shape decides: a task carries a
 * `taskId` and a `status`, and a `CallToolResult` carries `content`.
 */
function isWireTask(raw: unknown): raw is WireTask {
  if (!isTaskShaped(raw)) return false;
  const resultType = (raw as { resultType?: unknown }).resultType;
  if (resultType !== undefined) return resultType === "task";
  return !Array.isArray((raw as { content?: unknown }).content);
}

function isTaskShaped(raw: unknown): raw is WireTask {
  if (!raw || typeof raw !== "object") return false;
  const r = raw as Record<string, unknown>;
  return typeof r.taskId === "string" && typeof r.status === "string";
}

/** The SDK's `Task` view of a wire task: `ttlMs` → `ttl`, `pollIntervalMs` → `pollInterval`. */
function toTask(wire: WireTask): Task {
  return {
    taskId: wire.taskId,
    status: wire.status,
    ttl: typeof wire.ttlMs === "number" ? wire.ttlMs : null,
    createdAt: wire.createdAt,
    lastUpdatedAt: wire.lastUpdatedAt,
    ...(typeof wire.pollIntervalMs === "number" && { pollInterval: wire.pollIntervalMs }),
    ...(wire.statusMessage !== undefined && { statusMessage: wire.statusMessage }),
  };
}

function pollDelay(hinted: number | undefined): number {
  return typeof hinted === "number" && hinted > 0
    ? Math.max(hinted, MIN_POLL_INTERVAL_MS)
    : DEFAULT_POLL_INTERVAL_MS;
}

function wait(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(signal?.reason);
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * The handle for a call the server answered outright: already `completed`,
 * under an id no host issued, so nothing about it goes back on the wire.
 */
function answeredHandle<TOutput>(raw: unknown): TaskHandle<TOutput> {
  const now = new Date().toISOString();
  const task: Task = {
    taskId: `answered-${Math.random().toString(36).slice(2)}`,
    status: "completed",
    ttl: null,
    createdAt: now,
    lastUpdatedAt: now,
  };
  const result = parseToolResult(raw) as ToolCallResult<TOutput>;
  return {
    task,
    result: async () => result,
    refresh: async () => task,
    cancel: async () => task,
    onStatus: () => () => {},
  };
}

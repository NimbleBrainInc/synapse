/**
 * TaskHandle tests — `callToolAsTask(app, …)` against the MCP tasks extension
 * (`io.modelcontextprotocol/tasks`, protocol 2026-07-28). Drives the public API
 * end-to-end through a mocked `postMessage` transport.
 *
 * Method strings come from SDK request types, so a spec rename fails `tsc`.
 * The extension's own wire fields (`resultType`, `ttlMs`, `pollIntervalMs`, the
 * inlined `result`/`error`) are not in the MCP SDK, so they are pinned
 * literally here.
 */

import type {
  CallToolRequest,
  CallToolResult,
  CancelTaskRequest,
  GetTaskRequest,
  Task,
  TaskStatus,
} from "@modelcontextprotocol/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { connect } from "../connect.js";
import { HostCapabilityError, TaskError } from "../errors.js";
import { callToolAsTask } from "../task-handle.js";
import type { App, TasksCapability } from "../types.js";

const TOOLS_CALL_METHOD: CallToolRequest["method"] = "tools/call";
const TASKS_GET_METHOD: GetTaskRequest["method"] = "tasks/get";
const TASKS_CANCEL_METHOD: CancelTaskRequest["method"] = "tasks/cancel";

const WORKING: TaskStatus = "working";
const INPUT_REQUIRED: TaskStatus = "input_required";
const COMPLETED: TaskStatus = "completed";
const FAILED: TaskStatus = "failed";
const CANCELLED: TaskStatus = "cancelled";

// -----------------------------------------------------------------------------
// Test helpers
// -----------------------------------------------------------------------------

let postMessageSpy: ReturnType<typeof vi.fn>;

/** Let the client send, and let a dispatched frame reach its handler. */
async function flush(): Promise<void> {
  // Microtasks only, never a timer: fake timers would otherwise stall it.
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

function makeInitResult(hostTasks: TasksCapability | null = {}) {
  return {
    protocolVersion: "2026-01-26",
    hostInfo: { name: "nimblebrain", version: "1.0.0" },
    hostCapabilities:
      hostTasks === null ? {} : { experimental: { "io.modelcontextprotocol/tasks": hostTasks } },
    hostContext: { theme: "dark", styles: { variables: {} } },
  };
}

function sent(method: string): Record<string, unknown>[] {
  return postMessageSpy.mock.calls
    .map((c) => c[0] as Record<string, unknown>)
    .filter((msg) => msg?.method === method);
}

const answeredIds = new Set<string>();

function nextUnanswered(method: string): Record<string, unknown> {
  const msg = sent(method).find((m) => m.id !== undefined && !answeredIds.has(String(m.id)));
  if (!msg) throw new Error(`No pending ${method} request`);
  answeredIds.add(String(msg.id));
  return msg;
}

/** Answer the oldest unanswered request for `method`. */
async function respond(method: string, result: unknown): Promise<void> {
  await flush();
  const msg = nextUnanswered(method);
  window.dispatchEvent(
    new MessageEvent("message", {
      source: window.parent,
      data: { jsonrpc: "2.0", id: msg.id, result },
    }),
  );
  await flush();
}

/** Answer the oldest unanswered request for `method` with a JSON-RPC error. */
async function respondError(method: string, code: number, message: string): Promise<void> {
  await flush();
  const msg = nextUnanswered(method);
  window.dispatchEvent(
    new MessageEvent("message", {
      source: window.parent,
      data: { jsonrpc: "2.0", id: msg.id, error: { code, message } },
    }),
  );
  await flush();
}

/** A task as the extension puts it on the wire. */
function wireTask(taskId: string, status: TaskStatus, extra: Record<string, unknown> = {}) {
  return {
    resultType: "task",
    taskId,
    status,
    createdAt: "2026-07-28T00:00:00.000Z",
    lastUpdatedAt: "2026-07-28T00:00:00.000Z",
    ...extra,
  };
}

const TOOL_RESULT: CallToolResult = {
  content: [{ type: "text", text: '{"answer":42}' }],
};

let appPromise: Promise<App>;
let app: App;

async function ready(hostTasks: TasksCapability | null = {}): Promise<App> {
  await respond("ui/initialize", makeInitResult(hostTasks));
  app = await appPromise;
  return app;
}

/** Start a call the server runs as a task. */
async function startTask(taskId = "tsk_01", extra: Record<string, unknown> = {}) {
  const pending = callToolAsTask(app, "do_research", { query: "foo" });
  await respond(TOOLS_CALL_METHOD, wireTask(taskId, WORKING, extra));
  return pending;
}

beforeEach(() => {
  postMessageSpy = vi.fn();
  window.parent.postMessage = postMessageSpy;
  answeredIds.clear();
  app = undefined as unknown as App;
  appPromise = connect({ name: "test-app", version: "1.0.0" });
  appPromise.catch(() => {});
});

afterEach(() => {
  app?.destroy();
  vi.useRealTimers();
});

// -----------------------------------------------------------------------------
// Capability
// -----------------------------------------------------------------------------

describe("callToolAsTask — capability", () => {
  it("rejects with HostCapabilityError, without sending, when the host declared no tasks extension", async () => {
    await ready(null);
    expect(app.supportsTasks).toBe(false);

    const err = await callToolAsTask(app, "do_research", {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HostCapabilityError);
    expect((err as HostCapabilityError).capability).toBe("io.modelcontextprotocol/tasks");
    expect(sent(TOOLS_CALL_METHOD)).toHaveLength(0);
  });

  it("an empty declaration is enough", async () => {
    await ready({});
    expect(app.supportsTasks).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// The tools/call
// -----------------------------------------------------------------------------

describe("callToolAsTask — tools/call wire shape", () => {
  it("declares the extension in _meta, and carries no params.task", async () => {
    await ready();
    const pending = callToolAsTask(app, "do_research", { query: "mcp" });
    await flush();

    const [call] = sent(TOOLS_CALL_METHOD);
    const params = call!.params as Record<string, unknown>;
    expect(Object.keys(params).sort()).toEqual(["_meta", "arguments", "name"]);
    expect(params.name).toBe("do_research");
    expect(params.arguments).toEqual({ query: "mcp" });
    expect(params._meta).toEqual({
      "io.modelcontextprotocol/clientCapabilities": {
        extensions: { "io.modelcontextprotocol/tasks": {} },
      },
    });

    await respond(TOOLS_CALL_METHOD, wireTask("tsk_shape", WORKING));
    await pending;
  });

  it("sends arguments: {} when none are given", async () => {
    await ready();
    const pending = callToolAsTask(app, "ping");
    await flush();
    expect((sent(TOOLS_CALL_METHOD)[0]!.params as Record<string, unknown>).arguments).toEqual({});
    await respond(TOOLS_CALL_METHOD, TOOL_RESULT);
    await pending;
  });
});

// -----------------------------------------------------------------------------
// Answered outright
// -----------------------------------------------------------------------------

describe("callToolAsTask — answered outright", () => {
  it("returns a completed handle whose result() resolves at once, with nothing more sent", async () => {
    await ready();
    const pending = callToolAsTask<{ answer: number }>(app, "quick", {});
    await respond(TOOLS_CALL_METHOD, TOOL_RESULT);
    const handle = await pending;

    expect(handle.task.status).toBe(COMPLETED);
    expect(typeof handle.task.taskId).toBe("string");

    const result = await handle.result();
    expect(result.data).toEqual({ answer: 42 });
    expect(result.isError).toBe(false);

    // The synthetic id was never issued by a host, so nothing goes back.
    expect((await handle.refresh()).status).toBe(COMPLETED);
    expect((await handle.cancel()).status).toBe(COMPLETED);
    expect(sent(TASKS_GET_METHOD)).toHaveLength(0);
    expect(sent(TASKS_CANCEL_METHOD)).toHaveLength(0);
  });

  it("an isError result answered outright is still a result, not a rejection", async () => {
    await ready();
    const pending = callToolAsTask(app, "quick", {});
    await respond(TOOLS_CALL_METHOD, {
      content: [{ type: "text", text: "nope" }],
      isError: true,
    } satisfies CallToolResult);
    const handle = await pending;
    const result = await handle.result();
    expect(result.isError).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// Run as a task
// -----------------------------------------------------------------------------

describe("callToolAsTask — run as a task", () => {
  it("maps the wire task onto Task: ttlMs → ttl, pollIntervalMs → pollInterval", async () => {
    await ready();
    const handle = await startTask("tsk_map", {
      ttlMs: 60_000,
      pollIntervalMs: 1_500,
      statusMessage: "queued",
    });
    expect(handle.task).toEqual({
      taskId: "tsk_map",
      status: WORKING,
      ttl: 60_000,
      pollInterval: 1_500,
      statusMessage: "queued",
      createdAt: "2026-07-28T00:00:00.000Z",
      lastUpdatedAt: "2026-07-28T00:00:00.000Z",
    } satisfies Task);
  });

  it("ttl is null when the host names no ttlMs", async () => {
    await ready();
    const handle = await startTask("tsk_nottl");
    expect(handle.task.ttl).toBeNull();
    expect(handle.task).not.toHaveProperty("pollInterval");
  });

  it("result() polls tasks/get at pollInterval and resolves the inlined result", async () => {
    await ready();
    vi.useFakeTimers();
    const handle = await startTask("tsk_poll", { pollIntervalMs: 1_000 });
    const statuses: TaskStatus[] = [];
    handle.onStatus((t) => statuses.push(t.status));

    const resultPromise = handle.result();
    await flush();
    expect(sent(TASKS_GET_METHOD)).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(sent(TASKS_GET_METHOD)).toHaveLength(1);
    expect(sent(TASKS_GET_METHOD)[0]!.params).toEqual({ taskId: "tsk_poll" });
    await respond(TASKS_GET_METHOD, wireTask("tsk_poll", WORKING, { statusMessage: "halfway" }));

    await vi.advanceTimersByTimeAsync(1_000);
    expect(sent(TASKS_GET_METHOD)).toHaveLength(2);
    await respond(TASKS_GET_METHOD, wireTask("tsk_poll", COMPLETED, { result: TOOL_RESULT }));

    const result = await resultPromise;
    expect(result.data).toEqual({ answer: 42 });
    // A statusMessage change is a change; the same status reported again is not.
    expect(statuses).toEqual([WORKING, COMPLETED]);
    expect(sent("tasks/result")).toHaveLength(0);
  });

  it("uses a 2 s default without a pollInterval, and a 250 ms floor under one", async () => {
    await ready();
    vi.useFakeTimers();
    const slow = await startTask("tsk_default");
    void slow.result().catch(() => {});
    await vi.advanceTimersByTimeAsync(1_999);
    expect(sent(TASKS_GET_METHOD)).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(sent(TASKS_GET_METHOD)).toHaveLength(1);
    await respond(TASKS_GET_METHOD, wireTask("tsk_default", COMPLETED, { result: TOOL_RESULT }));

    const fast = await startTask("tsk_floor", { pollIntervalMs: 10 });
    void fast.result().catch(() => {});
    await vi.advanceTimersByTimeAsync(249);
    expect(sent(TASKS_GET_METHOD)).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(sent(TASKS_GET_METHOD)).toHaveLength(2);
    await respond(TASKS_GET_METHOD, wireTask("tsk_floor", COMPLETED, { result: TOOL_RESULT }));
  });

  it("a completed task in the tools/call answer without a result is fetched at once", async () => {
    await ready();
    const pending = callToolAsTask(app, "do_research", {});
    await respond(TOOLS_CALL_METHOD, wireTask("tsk_done", COMPLETED));
    const handle = await pending;

    const resultPromise = handle.result();
    await flush();
    expect(sent(TASKS_GET_METHOD)).toHaveLength(1);
    await respond(TASKS_GET_METHOD, wireTask("tsk_done", COMPLETED, { result: TOOL_RESULT }));
    expect((await resultPromise).data).toEqual({ answer: 42 });
  });

  it("a task answer the SDK stripped resultType from is still read as a task", async () => {
    // The MCP SDK's result codec drops `resultType` before a result reaches
    // the app, so the shape decides: `taskId` and `status`, and no `content`.
    await ready();
    const pending = callToolAsTask(app, "do_research", {});
    const { resultType: _dropped, ...stripped } = wireTask("tsk_stripped", WORKING);
    await respond(TOOLS_CALL_METHOD, stripped);
    const handle = await pending;
    expect(handle.task.taskId).toBe("tsk_stripped");
    expect(handle.task.status).toBe(WORKING);
  });

  it("rejects with TaskError carrying the inlined error when the task fails", async () => {
    await ready();
    vi.useFakeTimers();
    const handle = await startTask("tsk_fail", { pollIntervalMs: 500 });
    const resultPromise = handle.result().catch((e: unknown) => e);

    await vi.advanceTimersByTimeAsync(500);
    await respond(
      TASKS_GET_METHOD,
      wireTask("tsk_fail", FAILED, { error: { code: -32603, message: "upstream exploded" } }),
    );

    const err = await resultPromise;
    expect(err).toBeInstanceOf(TaskError);
    expect((err as TaskError).message).toBe("upstream exploded");
    expect((err as TaskError).code).toBe(-32603);
    expect((err as TaskError).task.status).toBe(FAILED);
  });

  it("rejects with TaskError when the task is cancelled", async () => {
    await ready();
    vi.useFakeTimers();
    const handle = await startTask("tsk_cx", { pollIntervalMs: 500 });
    const resultPromise = handle.result().catch((e: unknown) => e);

    await vi.advanceTimersByTimeAsync(500);
    await respond(TASKS_GET_METHOD, wireTask("tsk_cx", CANCELLED));

    const err = await resultPromise;
    expect(err).toBeInstanceOf(TaskError);
    expect((err as TaskError).task.status).toBe(CANCELLED);
  });

  it("input_required: sends tasks/cancel, then rejects with a TaskError saying why", async () => {
    await ready();
    vi.useFakeTimers();
    const handle = await startTask("tsk_input", { pollIntervalMs: 500 });
    const statuses: TaskStatus[] = [];
    handle.onStatus((t) => statuses.push(t.status));
    const resultPromise = handle.result().catch((e: unknown) => e);

    await vi.advanceTimersByTimeAsync(500);
    await respond(TASKS_GET_METHOD, wireTask("tsk_input", INPUT_REQUIRED));
    expect(sent(TASKS_CANCEL_METHOD)).toHaveLength(1);
    expect(sent(TASKS_CANCEL_METHOD)[0]!.params).toEqual({ taskId: "tsk_input" });
    await respond(TASKS_CANCEL_METHOD, {});

    const err = await resultPromise;
    expect(err).toBeInstanceOf(TaskError);
    expect((err as TaskError).task.status).toBe(INPUT_REQUIRED);
    expect((err as TaskError).message).toMatch(/input/);
    expect(statuses).toEqual([INPUT_REQUIRED]);
  });

  it("input_required still rejects when the cancel itself fails", async () => {
    await ready();
    const pending = callToolAsTask(app, "do_research", {});
    await respond(TOOLS_CALL_METHOD, wireTask("tsk_input2", INPUT_REQUIRED));
    const handle = await pending;
    const resultPromise = handle.result().catch((e: unknown) => e);
    await respondError(TASKS_CANCEL_METHOD, -32602, "already terminal");
    expect(await resultPromise).toBeInstanceOf(TaskError);
  });

  it("rejects at once when tasks/get says the task is unknown (-32602)", async () => {
    await ready();
    vi.useFakeTimers();
    const handle = await startTask("tsk_gone", { pollIntervalMs: 500 });
    const resultPromise = handle.result().catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(500);
    await respondError(TASKS_GET_METHOD, -32602, "unknown task");
    const err = await resultPromise;
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(TaskError);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(sent(TASKS_GET_METHOD)).toHaveLength(1);
  });

  it("keeps polling through a failed tasks/get, and the count resets on success", async () => {
    await ready();
    vi.useFakeTimers();
    const handle = await startTask("tsk_blip", { pollIntervalMs: 500 });
    let settled = false;
    const resultPromise = handle.result().finally(() => {
      settled = true;
    });

    // Two failures, a success, two more failures: never three in a row.
    for (const answer of ["fail", "fail", "ok", "fail", "fail"] as const) {
      await vi.advanceTimersByTimeAsync(500);
      if (answer === "fail") await respondError(TASKS_GET_METHOD, -32603, "blip");
      else await respond(TASKS_GET_METHOD, wireTask("tsk_blip", WORKING));
    }
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(500);
    await respond(TASKS_GET_METHOD, wireTask("tsk_blip", COMPLETED, { result: TOOL_RESULT }));
    expect((await resultPromise).data).toEqual({ answer: 42 });
  });

  it("rejects on the third consecutive failed tasks/get", async () => {
    await ready();
    vi.useFakeTimers();
    const handle = await startTask("tsk_down", { pollIntervalMs: 500 });
    const resultPromise = handle.result().catch((e: unknown) => e);
    for (let i = 0; i < 3; i += 1) {
      await vi.advanceTimersByTimeAsync(500);
      await respondError(TASKS_GET_METHOD, -32603, "down");
    }
    const err = await resultPromise;
    expect((err as Error).message).toMatch(/down/);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(sent(TASKS_GET_METHOD)).toHaveLength(3);
  });

  it("an aborted signal stops polling and rejects with its reason", async () => {
    await ready();
    vi.useFakeTimers();
    const handle = await startTask("tsk_abort", { pollIntervalMs: 500 });
    const controller = new AbortController();
    const resultPromise = handle.result({ signal: controller.signal }).catch((e: unknown) => e);

    controller.abort(new Error("stop"));
    expect(((await resultPromise) as Error).message).toBe("stop");
    await vi.advanceTimersByTimeAsync(5_000);
    expect(sent(TASKS_GET_METHOD)).toHaveLength(0);
    expect(sent(TASKS_CANCEL_METHOD)).toHaveLength(0);
  });
});

// -----------------------------------------------------------------------------
// refresh, cancel, onStatus
// -----------------------------------------------------------------------------

describe("TaskHandle — refresh, cancel, onStatus", () => {
  it("refresh() sends one tasks/get and returns the mapped task", async () => {
    await ready();
    const handle = await startTask("tsk_ref");
    const refreshed = handle.refresh();
    await respond(TASKS_GET_METHOD, wireTask("tsk_ref", WORKING, { ttlMs: 5_000 }));
    expect(await refreshed).toMatchObject({ taskId: "tsk_ref", status: WORKING, ttl: 5_000 });
    expect(sent(TASKS_GET_METHOD)).toHaveLength(1);
  });

  it("cancel() sends tasks/cancel, then one tasks/get, and returns that task", async () => {
    await ready();
    const handle = await startTask("tsk_can");
    const seen: TaskStatus[] = [];
    handle.onStatus((t) => seen.push(t.status));

    const cancelled = handle.cancel();
    await flush();
    expect(sent(TASKS_CANCEL_METHOD)[0]!.params).toEqual({ taskId: "tsk_can" });
    expect(sent(TASKS_GET_METHOD)).toHaveLength(0);
    await respond(TASKS_CANCEL_METHOD, {});
    await respond(TASKS_GET_METHOD, wireTask("tsk_can", CANCELLED));

    expect((await cancelled).status).toBe(CANCELLED);
    expect(seen).toEqual([CANCELLED]);
  });

  it("cancel() resolves to the last task seen when the follow-up tasks/get fails", async () => {
    await ready();
    const handle = await startTask("tsk_can_blip");
    const cancelled = handle.cancel();
    await respond(TASKS_CANCEL_METHOD, {});
    await respondError(TASKS_GET_METHOD, -32603, "blip");
    expect(await cancelled).toMatchObject({ taskId: "tsk_can_blip", status: WORKING });
  });

  it("cancel() rejects with the host's error", async () => {
    await ready();
    const handle = await startTask("tsk_can_err");
    const cancelled = handle.cancel().catch((e: unknown) => e);
    await respondError(TASKS_CANCEL_METHOD, -32602, "already terminal");
    expect(await cancelled).toBeInstanceOf(Error);
    expect(sent(TASKS_GET_METHOD)).toHaveLength(0);
  });

  it("onStatus reports changes observed by refresh(), and its unsubscribe stops them", async () => {
    await ready();
    const handle = await startTask("tsk_sub");
    const cb = vi.fn();
    const unsub = handle.onStatus(cb);

    const first = handle.refresh();
    await respond(TASKS_GET_METHOD, wireTask("tsk_sub", WORKING));
    await first;
    expect(cb).not.toHaveBeenCalled();

    const second = handle.refresh();
    await respond(TASKS_GET_METHOD, wireTask("tsk_sub", WORKING, { statusMessage: "50%" }));
    await second;
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0]![0]).toMatchObject({ status: WORKING, statusMessage: "50%" });

    unsub();
    const third = handle.refresh();
    await respond(TASKS_GET_METHOD, wireTask("tsk_sub", COMPLETED, { result: TOOL_RESULT }));
    await third;
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("the same callback subscribed twice is called once per change", async () => {
    await ready();
    const handle = await startTask("tsk_dup");
    const cb = vi.fn();
    handle.onStatus(cb);
    handle.onStatus(cb);
    const r = handle.refresh();
    await respond(TASKS_GET_METHOD, wireTask("tsk_dup", COMPLETED, { result: TOOL_RESULT }));
    await r;
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("a throwing subscriber does not stop the others", async () => {
    await ready();
    const handle = await startTask("tsk_throw");
    const good = vi.fn();
    handle.onStatus(() => {
      throw new Error("bad subscriber");
    });
    handle.onStatus(good);
    const r = handle.refresh();
    await respond(TASKS_GET_METHOD, wireTask("tsk_throw", CANCELLED));
    await r;
    expect(good).toHaveBeenCalledTimes(1);
  });

  it("a host notification never feeds onStatus: status comes from polling only", async () => {
    await ready();
    const handle = await startTask("tsk_notify");
    const cb = vi.fn();
    handle.onStatus(cb);
    window.dispatchEvent(
      new MessageEvent("message", {
        source: window.parent,
        data: {
          jsonrpc: "2.0",
          method: "notifications/tasks/status",
          params: wireTask("tsk_notify", COMPLETED),
        },
      }),
    );
    await flush();
    expect(cb).not.toHaveBeenCalled();
  });
});

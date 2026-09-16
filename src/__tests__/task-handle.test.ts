/**
 * TaskHandle tests — behaviors of `callToolAsTask(app, …)` and the
 * returned `TaskHandle`. Drives the public API end-to-end through a
 * mocked `postMessage` transport; verifies wire shape, lifecycle,
 * and status notification routing.
 *
 * All method strings and status values come from SDK-imported constants
 * or SDK-typed literals. Per CLAUDE.md hard rule #1, tests should fail
 * at compile time if the spec renames a method or status.
 */

import type {
  CallToolRequest,
  CallToolResult,
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
} from "@modelcontextprotocol/sdk/types.js";
import { RELATED_TASK_META_KEY } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { connect } from "../connect.js";
import { callToolAsTask } from "../task-handle.js";
import type { App, CallToolAsTaskOptions, TaskHandle, TasksCapability } from "../types.js";

// -----------------------------------------------------------------------------
// SDK-type-derived wire constants (fail compile on upstream rename)
// -----------------------------------------------------------------------------

const TOOLS_CALL_METHOD: CallToolRequest["method"] = "tools/call";
const TASKS_GET_METHOD: GetTaskRequest["method"] = "tasks/get";
const TASKS_RESULT_METHOD: GetTaskPayloadRequest["method"] = "tasks/result";
const TASKS_CANCEL_METHOD: CancelTaskRequest["method"] = "tasks/cancel";
const TASKS_STATUS_NOTIFICATION_METHOD: TaskStatusNotification["method"] =
  "notifications/tasks/status";

// Compile-time guard: status strings we reference in assertions are
// members of the spec enum. If the spec ever renames a status, any
// literal below that no longer matches will fail tsc.
const WORKING_STATUS: TaskStatus = "working";
const COMPLETED_STATUS: TaskStatus = "completed";
const FAILED_STATUS: TaskStatus = "failed";
const CANCELLED_STATUS: TaskStatus = "cancelled";

// -----------------------------------------------------------------------------
// Test helpers
// -----------------------------------------------------------------------------

let postMessageSpy: ReturnType<typeof vi.fn>;

/**
 * Let the client send, and let a dispatched frame reach its handler. Both
 * cross a microtask: the spec's client sends and dispatches asynchronously.
 */
async function flush(): Promise<void> {
  // Microtasks only, never a timer: a test driving fake timers would otherwise
  // wait on one that never fires. Everything the client does between a frame
  // arriving and a handler running is a microtask.
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

const HOST_TASKS_CAPABILITY: TasksCapability = {
  cancel: {},
  requests: { tools: { call: {} } },
};

function makeInitResult(overrides?: { hostTasks?: TasksCapability | null }) {
  const hostTasks =
    overrides && "hostTasks" in overrides ? overrides.hostTasks : HOST_TASKS_CAPABILITY;
  const hostCapabilities: Record<string, unknown> = {};
  if (hostTasks != null) {
    hostCapabilities.experimental = { "io.modelcontextprotocol/tasks": hostTasks };
  }
  return {
    protocolVersion: "2026-01-26",
    hostInfo: { name: "nimblebrain", version: "1.0.0" },
    hostCapabilities,
    hostContext: {
      theme: "dark",
      styles: { variables: {} },
    },
  };
}

function findCall(method: string): Record<string, unknown> | undefined {
  const calls = findAllCalls(method);
  // Return the LAST matching call — new requests come in as suffixes,
  // and tests that issue multiple matching calls care about the latest.
  return calls[calls.length - 1];
}

function findAllCalls(method: string): Record<string, unknown>[] {
  return postMessageSpy.mock.calls
    .map((c) => c[0] as Record<string, unknown>)
    .filter((msg) => msg?.method === method);
}

/** Tracks request ids we've already answered so respondToRequest can
 * pick the newest un-answered call, not the first matching call. */
const answeredIds = new Set<string>();

async function respondToRequest(method: string, result: unknown): Promise<void> {
  await flush();
  const calls = findAllCalls(method);
  const msg = [...calls].reverse().find((m) => {
    const id = m.id;
    return id !== undefined && !answeredIds.has(String(id));
  });
  if (!msg || msg.id === undefined) {
    throw new Error(`No pending ${method} request`);
  }
  answeredIds.add(String(msg.id));
  window.dispatchEvent(
    new MessageEvent("message", {
      source: window.parent,
      data: { jsonrpc: "2.0", id: msg.id, result },
    }),
  );
  await flush();
}

async function completeHandshake(initResult = makeInitResult()): void {
  await respondToRequest("ui/initialize", initResult);
}

async function dispatchNotification(
  method: string,
  params?: Record<string, unknown>,
): Promise<void> {
  window.dispatchEvent(
    new MessageEvent("message", {
      source: window.parent,
      data: {
        jsonrpc: "2.0",
        method,
        ...(params !== undefined && { params }),
      },
    }),
  );
  await flush();
}

/** Build a spec-shaped `Task` with the given overrides. */
function makeTask(overrides: Partial<Task> & Pick<Task, "taskId">): Task {
  return {
    status: WORKING_STATUS,
    ttl: 60_000,
    createdAt: "2026-01-01T00:00:00.000Z",
    lastUpdatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeCreateTaskResult(taskId: string, overrides?: Partial<Task>): CreateTaskResult {
  return { task: makeTask({ taskId, ...overrides }) };
}

/** Start a task and drive the handshake + `tools/call` response flow. */
async function startTask(
  app: App,
  toolName = "do_research",
  args: Record<string, unknown> = { query: "foo" },
  taskId = "tsk_01",
  options?: CallToolAsTaskOptions,
): Promise<TaskHandle> {
  const pending = callToolAsTask(app, toolName, args, options);
  await respondToRequest(TOOLS_CALL_METHOD, makeCreateTaskResult(taskId));
  return pending;
}

// -----------------------------------------------------------------------------
// Setup
// -----------------------------------------------------------------------------

let appPromise: Promise<App>;
let app: App;

beforeEach(() => {
  postMessageSpy = vi.fn();
  window.parent.postMessage = postMessageSpy;
  answeredIds.clear();
  app = undefined as unknown as App;
  // `connect()` resolves only once the host answers `ui/initialize`, so every
  // test opens the connection here and completes the handshake itself.
  appPromise = connect({ name: "test-app", version: "1.0.0" });
  appPromise.catch(() => {});
});

afterEach(() => {
  app?.destroy();
});

// -----------------------------------------------------------------------------
// callToolAsTask — wire shape
// -----------------------------------------------------------------------------

describe("callToolAsTask — tools/call wire shape", () => {
  it("sends tools/call with task.ttl when ttl is provided", async () => {
    await completeHandshake();
    app = await appPromise;

    const pending = callToolAsTask(app, "do_research", { query: "mcp" }, { ttl: 300_000 });

    const call = findCall(TOOLS_CALL_METHOD);
    expect(call).toBeDefined();
    const params = call!.params as CallToolRequest["params"];

    expect(params.name).toBe("do_research");
    expect(params.arguments).toEqual({ query: "mcp" });
    expect(params.task).toEqual({ ttl: 300_000 });

    // Respond so the pending promise doesn't dangle across tests.
    await respondToRequest(TOOLS_CALL_METHOD, makeCreateTaskResult("tsk_ttl"));
    await pending;
  });

  it("sends tools/call with task: {} when ttl is omitted (still augmented)", async () => {
    await completeHandshake();
    app = await appPromise;

    const pending = callToolAsTask(app, "do_research", { query: "mcp" });

    const call = findCall(TOOLS_CALL_METHOD);
    const params = call!.params as CallToolRequest["params"];

    // The `task` object is the augmentation signal per spec — its
    // presence (even empty) tells the receiver to return a
    // CreateTaskResult instead of a bare CallToolResult.
    expect(params.task).toBeDefined();
    expect(params.task).toEqual({});

    await respondToRequest(TOOLS_CALL_METHOD, makeCreateTaskResult("tsk_notll"));
    await pending;
  });

  it("names no target server, by any route", async () => {
    // A task-augmented call is an app calling its own server, same as a plain
    // one. `task` is the only addition the spec makes to the params, and there
    // is no way here to name another source.
    await completeHandshake();
    app = await appPromise;

    const pending = callToolAsTask(app, "do_research", { query: "mcp" });

    const call = findCall(TOOLS_CALL_METHOD);
    const params = call!.params as CallToolRequest["params"] & { server?: string };
    expect(Object.keys(params).sort()).toEqual(["arguments", "name", "task"]);
    expect(params._meta).toBeUndefined();
    expect(Object.hasOwn(params, "server")).toBe(false);

    await respondToRequest(TOOLS_CALL_METHOD, makeCreateTaskResult("tsk_external"));
    await pending;
  });

  it("sends empty arguments when none provided", async () => {
    await completeHandshake();
    app = await appPromise;

    const pending = callToolAsTask(app, "ping");

    const call = findCall(TOOLS_CALL_METHOD);
    const params = call!.params as CallToolRequest["params"];
    expect(params.arguments).toEqual({});

    await respondToRequest(TOOLS_CALL_METHOD, makeCreateTaskResult("tsk_ping"));
    await pending;
  });
});

// -----------------------------------------------------------------------------
// callToolAsTask — capability negotiation
// -----------------------------------------------------------------------------

describe("callToolAsTask — capability negotiation", () => {
  it("throws when host did not advertise tasks at all", async () => {
    await completeHandshake(makeInitResult({ hostTasks: null }));
    app = await appPromise;

    await expect(callToolAsTask(app, "do_thing", {})).rejects.toThrow(
      /did not advertise tasks\.requests\.tools\.call/,
    );
    // And nothing should have been sent on the wire.
    expect(findCall(TOOLS_CALL_METHOD)).toBeUndefined();
  });

  it("throws when host advertises tasks but NOT tools/call specifically", async () => {
    await completeHandshake(
      makeInitResult({
        hostTasks: {
          // tasks declared, but tools.call is not — requestor MUST NOT
          // task-augment (MCP 2025-11-25 §).
          cancel: {},
          requests: { tools: {} },
        },
      }),
    );
    app = await appPromise;

    await expect(callToolAsTask(app, "do_thing", {})).rejects.toThrow(
      /tasks\.requests\.tools\.call/,
    );
  });

  it("succeeds when host advertises tasks.requests.tools.call", async () => {
    await completeHandshake();
    app = await appPromise;

    const handle = await startTask(app, "do_thing", {}, "tsk_ok");
    expect(handle.task.taskId).toBe("tsk_ok");
  });
});

// -----------------------------------------------------------------------------
// TaskHandle — initial state
// -----------------------------------------------------------------------------

describe("TaskHandle — initial state from CreateTaskResult", () => {
  it("populates handle.task with the CreateTaskResult.task fields", async () => {
    await completeHandshake();
    app = await appPromise;

    const pending = callToolAsTask(app, "do_thing", {});
    const createResult: CreateTaskResult = {
      task: {
        taskId: "tsk_full",
        status: WORKING_STATUS,
        ttl: 120_000,
        createdAt: "2026-04-22T00:00:00.000Z",
        lastUpdatedAt: "2026-04-22T00:00:00.000Z",
        pollInterval: 2_000,
      },
    };
    await respondToRequest(TOOLS_CALL_METHOD, createResult);
    const handle = await pending;

    expect(handle.task).toEqual(createResult.task);
    expect(handle.task.status).toBe(WORKING_STATUS);
    expect(handle.task.pollInterval).toBe(2_000);
  });

  it("throws when receiver returns a response without task (protocol violation)", async () => {
    await completeHandshake();
    app = await appPromise;

    const pending = callToolAsTask(app, "do_thing", {});
    // Simulate a broken receiver that advertises the capability but
    // returns a bare CallToolResult instead of a CreateTaskResult.
    await respondToRequest(TOOLS_CALL_METHOD, {
      content: [{ type: "text", text: "oops" }],
    });

    await expect(pending).rejects.toThrow(/CreateTaskResult/);
  });
});

// -----------------------------------------------------------------------------
// TaskHandle.result() — blocks via tasks/result
// -----------------------------------------------------------------------------

describe("TaskHandle.result()", () => {
  it("sends tasks/result { taskId } and resolves with parsed CallToolResult", async () => {
    await completeHandshake();
    app = await appPromise;

    const handle = await startTask(app, "do_thing", { q: 1 }, "tsk_a");

    const resultPromise = handle.result();

    const call = findCall(TASKS_RESULT_METHOD);
    expect(call).toBeDefined();
    const params = call!.params as GetTaskPayloadRequest["params"];
    expect(params.taskId).toBe("tsk_a");

    const terminal: CallToolResult = {
      content: [{ type: "text", text: '{"answer":42}' }],
    };
    await respondToRequest(TASKS_RESULT_METHOD, terminal);

    const result = await resultPromise;
    expect(result.isError).toBe(false);
    expect(result.data).toEqual({ answer: 42 });
  });

  it("preserves _meta['io.modelcontextprotocol/related-task'] from the response", async () => {
    await completeHandshake();
    app = await appPromise;

    const handle = await startTask(app, "do_thing", {}, "tsk_meta");

    const resultPromise = handle.result();
    const terminal = {
      content: [{ type: "text", text: '"done"' }],
      _meta: {
        [RELATED_TASK_META_KEY]: { taskId: "tsk_meta" },
        "vendor.namespace/extra": { some: "data" },
      },
    } satisfies GetTaskPayloadResult;
    await respondToRequest(TASKS_RESULT_METHOD, terminal);

    const result = await resultPromise;

    expect(result._meta?.[RELATED_TASK_META_KEY]).toEqual({ taskId: "tsk_meta" });
    // Key-preserving spread: arbitrary namespaced keys must propagate.
    expect(result._meta?.["vendor.namespace/extra"]).toEqual({ some: "data" });
  });

  it("surfaces isError: true from terminal CallToolResult", async () => {
    await completeHandshake();
    app = await appPromise;

    const handle = await startTask(app, "do_thing", {}, "tsk_err");

    const resultPromise = handle.result();
    await respondToRequest(TASKS_RESULT_METHOD, {
      isError: true,
      content: [{ type: "text", text: "bang" }],
    });

    const result = await resultPromise;
    expect(result.isError).toBe(true);
    expect(result.data).toBe("bang");
  });

  it("does not depend on notifications/tasks/status for correctness", async () => {
    await completeHandshake();
    app = await appPromise;

    const handle = await startTask(app, "do_thing", {}, "tsk_noevents");

    // Zero notifications emitted — result() must still resolve purely
    // off the tasks/result response. Spec: status notifications are
    // OPTIONAL; requestors MUST NOT rely on them.
    const resultPromise = handle.result();
    await respondToRequest(TASKS_RESULT_METHOD, {
      content: [{ type: "text", text: '{"ok":true}' }],
    });

    const result = await resultPromise;
    expect(result.data).toEqual({ ok: true });
  });
});

// -----------------------------------------------------------------------------
// TaskHandle.refresh() — non-blocking tasks/get
// -----------------------------------------------------------------------------

describe("TaskHandle.refresh()", () => {
  it("sends tasks/get { taskId } and resolves with the current Task", async () => {
    await completeHandshake();
    app = await appPromise;

    const handle = await startTask(app, "do_thing", {}, "tsk_refresh");

    const refreshPromise = handle.refresh();

    const call = findCall(TASKS_GET_METHOD);
    expect(call).toBeDefined();
    const params = call!.params as GetTaskRequest["params"];
    expect(params.taskId).toBe("tsk_refresh");

    const flatTask: GetTaskResult = {
      taskId: "tsk_refresh",
      status: WORKING_STATUS,
      ttl: 30_000,
      createdAt: "2026-04-22T00:00:00.000Z",
      lastUpdatedAt: "2026-04-22T00:00:10.000Z",
      pollInterval: 1_500,
    };
    await respondToRequest(TASKS_GET_METHOD, flatTask);

    const task = await refreshPromise;
    expect(task.taskId).toBe("tsk_refresh");
    expect(task.status).toBe(WORKING_STATUS);
    expect(task.pollInterval).toBe(1_500);
    expect(task.lastUpdatedAt).toBe("2026-04-22T00:00:10.000Z");
  });
});

// -----------------------------------------------------------------------------
// TaskHandle.cancel() — terminates via tasks/cancel
// -----------------------------------------------------------------------------

describe("TaskHandle.cancel()", () => {
  it("sends tasks/cancel { taskId } and resolves with cancelled Task", async () => {
    await completeHandshake();
    app = await appPromise;

    const handle = await startTask(app, "do_thing", {}, "tsk_cancel");

    const cancelPromise = handle.cancel();

    const call = findCall(TASKS_CANCEL_METHOD);
    expect(call).toBeDefined();
    const params = call!.params as CancelTaskRequest["params"];
    expect(params.taskId).toBe("tsk_cancel");

    const cancelledTask: CancelTaskResult = {
      taskId: "tsk_cancel",
      status: CANCELLED_STATUS,
      ttl: 60_000,
      createdAt: "2026-04-22T00:00:00.000Z",
      lastUpdatedAt: "2026-04-22T00:00:05.000Z",
    };
    await respondToRequest(TASKS_CANCEL_METHOD, cancelledTask);

    const task = await cancelPromise;
    expect(task.status).toBe(CANCELLED_STATUS);
    expect(task.taskId).toBe("tsk_cancel");
  });

  it("propagates -32602 error when cancelling a terminal task", async () => {
    await completeHandshake();
    app = await appPromise;

    const handle = await startTask(app, "do_thing", {}, "tsk_term");

    const cancelPromise = handle.cancel();
    const call = findCall(TASKS_CANCEL_METHOD);
    window.dispatchEvent(
      new MessageEvent("message", {
        source: window.parent,
        data: {
          jsonrpc: "2.0",
          id: (call as Record<string, unknown>).id,
          error: { code: -32602, message: "task already terminal" },
        },
      }),
    );

    await expect(cancelPromise).rejects.toThrow(/task already terminal/);
  });
});

// -----------------------------------------------------------------------------
// TaskHandle.onStatus() — per-taskId routing
// -----------------------------------------------------------------------------

describe("TaskHandle.onStatus()", () => {
  it("receives notifications/tasks/status events for matching taskId", async () => {
    await completeHandshake();
    app = await appPromise;

    const handle = await startTask(app, "do_thing", {}, "tsk_match");
    const cb = vi.fn();
    handle.onStatus(cb);

    await dispatchNotification(TASKS_STATUS_NOTIFICATION_METHOD, {
      taskId: "tsk_match",
      status: COMPLETED_STATUS,
    });

    expect(cb).toHaveBeenCalledTimes(1);
    const task = cb.mock.calls[0][0] as Task;
    expect(task.taskId).toBe("tsk_match");
    expect(task.status).toBe(COMPLETED_STATUS);
  });

  it("does NOT receive events for other taskIds", async () => {
    await completeHandshake();
    app = await appPromise;

    const handle = await startTask(app, "do_thing", {}, "tsk_a");
    const cb = vi.fn();
    handle.onStatus(cb);

    await dispatchNotification(TASKS_STATUS_NOTIFICATION_METHOD, {
      taskId: "tsk_OTHER",
      status: FAILED_STATUS,
    });

    expect(cb).not.toHaveBeenCalled();
  });

  it("returns an unsubscribe that stops further delivery", async () => {
    await completeHandshake();
    app = await appPromise;

    const handle = await startTask(app, "do_thing", {}, "tsk_unsub");
    const cb = vi.fn();
    const unsub = handle.onStatus(cb);

    await dispatchNotification(TASKS_STATUS_NOTIFICATION_METHOD, {
      taskId: "tsk_unsub",
      status: WORKING_STATUS,
    });
    expect(cb).toHaveBeenCalledTimes(1);

    unsub();
    await dispatchNotification(TASKS_STATUS_NOTIFICATION_METHOD, {
      taskId: "tsk_unsub",
      status: COMPLETED_STATUS,
    });

    // No additional callback after unsubscribe.
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("two handles with different taskIds each receive their own notifications", async () => {
    await completeHandshake();
    app = await appPromise;

    const handleA = await startTask(app, "do_a", {}, "tsk_A");
    const handleB = await startTask(app, "do_b", {}, "tsk_B");

    const cbA = vi.fn();
    const cbB = vi.fn();
    handleA.onStatus(cbA);
    handleB.onStatus(cbB);

    await dispatchNotification(TASKS_STATUS_NOTIFICATION_METHOD, {
      taskId: "tsk_A",
      status: WORKING_STATUS,
    });
    await dispatchNotification(TASKS_STATUS_NOTIFICATION_METHOD, {
      taskId: "tsk_B",
      status: COMPLETED_STATUS,
    });
    await dispatchNotification(TASKS_STATUS_NOTIFICATION_METHOD, {
      taskId: "tsk_A",
      status: COMPLETED_STATUS,
    });

    expect(cbA).toHaveBeenCalledTimes(2);
    expect(cbB).toHaveBeenCalledTimes(1);
    // Each handle got only its own taskId.
    for (const call of cbA.mock.calls) expect((call[0] as Task).taskId).toBe("tsk_A");
    for (const call of cbB.mock.calls) expect((call[0] as Task).taskId).toBe("tsk_B");
  });

  it("multiple subscribers on the same handle all fire", async () => {
    await completeHandshake();
    app = await appPromise;

    const handle = await startTask(app, "do_thing", {}, "tsk_multi");
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    handle.onStatus(cb1);
    handle.onStatus(cb2);

    await dispatchNotification(TASKS_STATUS_NOTIFICATION_METHOD, {
      taskId: "tsk_multi",
      status: COMPLETED_STATUS,
    });

    expect(cb1).toHaveBeenCalledTimes(1);
    expect(cb2).toHaveBeenCalledTimes(1);
  });

  it("ignores status notifications with no params or non-string taskId", async () => {
    await completeHandshake();
    app = await appPromise;

    const handle = await startTask(app, "do_thing", {}, "tsk_defensive");
    const cb = vi.fn();
    handle.onStatus(cb);

    // No params at all.
    await dispatchNotification(TASKS_STATUS_NOTIFICATION_METHOD);
    // taskId missing.
    await dispatchNotification(TASKS_STATUS_NOTIFICATION_METHOD, { status: WORKING_STATUS });
    // taskId wrong type.
    await dispatchNotification(TASKS_STATUS_NOTIFICATION_METHOD, {
      taskId: 123,
      status: WORKING_STATUS,
    });

    expect(cb).not.toHaveBeenCalled();
  });
});

// -----------------------------------------------------------------------------
// Transport-level handler dedupes across handles
// -----------------------------------------------------------------------------

describe("transport-level status subscription", () => {
  it("does not register a new wire subscription per handle", async () => {
    // We observe indirectly: create many handles, then destroy() and
    // verify the single shared subscription is cleaned up in one shot.
    // (Internals aren't exposed; behavior is what we assert.)
    await completeHandshake();
    app = await appPromise;

    const handleA = await startTask(app, "do_a", {}, "tsk_x1");
    const handleB = await startTask(app, "do_b", {}, "tsk_x2");
    const handleC = await startTask(app, "do_c", {}, "tsk_x3");

    const cbA = vi.fn();
    const cbB = vi.fn();
    const cbC = vi.fn();
    handleA.onStatus(cbA);
    handleB.onStatus(cbB);
    handleC.onStatus(cbC);

    // After destroy(), ALL subscribers should stop hearing events —
    // regardless of how many were registered — because they share a
    // single transport-level subscription.
    app.destroy();

    await dispatchNotification(TASKS_STATUS_NOTIFICATION_METHOD, {
      taskId: "tsk_x1",
      status: COMPLETED_STATUS,
    });
    await dispatchNotification(TASKS_STATUS_NOTIFICATION_METHOD, {
      taskId: "tsk_x2",
      status: COMPLETED_STATUS,
    });
    await dispatchNotification(TASKS_STATUS_NOTIFICATION_METHOD, {
      taskId: "tsk_x3",
      status: COMPLETED_STATUS,
    });

    expect(cbA).not.toHaveBeenCalled();
    expect(cbB).not.toHaveBeenCalled();
    expect(cbC).not.toHaveBeenCalled();

    // Suppress afterEach destroy() double-call (idempotent anyway).
  });

  it("multiple onStatus calls on the same handle do not multiply delivery", async () => {
    // Regression guard: a broken impl might add a new listener-set
    // per-subscribe and accidentally call each wire subscriber more
    // than once per notification.
    await completeHandshake();
    app = await appPromise;

    const handle = await startTask(app, "do_thing", {}, "tsk_dedup");
    const cb = vi.fn();
    const unsub1 = handle.onStatus(cb);
    const unsub2 = handle.onStatus(cb); // same fn, two registrations

    await dispatchNotification(TASKS_STATUS_NOTIFICATION_METHOD, {
      taskId: "tsk_dedup",
      status: COMPLETED_STATUS,
    });

    // Set-semantics: registering the same callback twice collapses to
    // one (matches the subscribe contract in connect()).
    expect(cb).toHaveBeenCalledTimes(1);

    unsub1();
    unsub2();
  });

  it("sends at most one subscription-worthy tools/call per startTask — sanity", async () => {
    await completeHandshake();
    app = await appPromise;

    await startTask(app, "do_thing", {}, "tsk_once");
    await startTask(app, "do_thing", {}, "tsk_twice");

    // Two task starts, two tools/call messages on the wire. Not three,
    // not one. This guards against double-send regressions.
    expect(findAllCalls(TOOLS_CALL_METHOD)).toHaveLength(2);
  });
});

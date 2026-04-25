/**
 * `useCallToolAsTask` — React lifecycle wrapper around
 * `synapse.callToolAsTask`.
 *
 * Tests exercise the hook's public API through `SynapseProvider` and a
 * mocked `postMessage` transport. Wire constants and status values are
 * sourced from SDK types so a spec rename fails compile here too.
 *
 * Fake timers are used for polling-behavior tests; real timers for
 * cleanup/unmount behavior where `setTimeout(0)` drives microtasks.
 */

import type {
  CallToolRequest,
  CallToolResult,
  CancelTaskRequest,
  CancelTaskResult,
  CreateTaskResult,
  GetTaskPayloadRequest,
  GetTaskRequest,
  GetTaskResult,
  Task,
  TaskStatus,
  TaskStatusNotification,
} from "@modelcontextprotocol/sdk/types.js";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SynapseProvider, useCallToolAsTask } from "../../react/index.js";
import type { TasksCapability } from "../../types.js";

// -----------------------------------------------------------------------------
// SDK-type-derived wire constants
// -----------------------------------------------------------------------------

const TOOLS_CALL_METHOD: CallToolRequest["method"] = "tools/call";
const TASKS_GET_METHOD: GetTaskRequest["method"] = "tasks/get";
const TASKS_RESULT_METHOD: GetTaskPayloadRequest["method"] = "tasks/result";
const TASKS_CANCEL_METHOD: CancelTaskRequest["method"] = "tasks/cancel";
const TASKS_STATUS_NOTIFICATION_METHOD: TaskStatusNotification["method"] =
  "notifications/tasks/status";

const WORKING_STATUS: TaskStatus = "working";
const COMPLETED_STATUS: TaskStatus = "completed";
const FAILED_STATUS: TaskStatus = "failed";
const CANCELLED_STATUS: TaskStatus = "cancelled";

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

let postMessageSpy: ReturnType<typeof vi.fn>;

const HOST_TASKS_CAPABILITY: TasksCapability = {
  cancel: {},
  requests: { tools: { call: {} } },
};

function makeInitResult() {
  return {
    protocolVersion: "2026-01-26",
    hostInfo: { name: "nimblebrain", version: "1.0.0" },
    hostCapabilities: { tasks: HOST_TASKS_CAPABILITY },
    hostContext: {
      theme: "dark",
      styles: { variables: {} },
    },
  };
}

function findAllCalls(method: string): Record<string, unknown>[] {
  return postMessageSpy.mock.calls
    .map((c) => c[0] as Record<string, unknown>)
    .filter((msg) => msg?.method === method);
}

const answeredIds = new Set<string>();

function respondToRequest(method: string, result: unknown): void {
  const calls = findAllCalls(method);
  const msg = [...calls].reverse().find((m) => {
    const id = m.id;
    return typeof id === "string" && !answeredIds.has(id);
  });
  if (!msg || typeof msg.id !== "string") {
    throw new Error(`No pending ${method} request`);
  }
  answeredIds.add(msg.id);
  window.dispatchEvent(
    new MessageEvent("message", {
      data: { jsonrpc: "2.0", id: msg.id, result },
    }),
  );
}

function rejectRequest(method: string, error: { code: number; message: string }): void {
  const calls = findAllCalls(method);
  const msg = [...calls].reverse().find((m) => {
    const id = m.id;
    return typeof id === "string" && !answeredIds.has(id);
  });
  if (!msg || typeof msg.id !== "string") {
    throw new Error(`No pending ${method} request`);
  }
  answeredIds.add(msg.id);
  window.dispatchEvent(
    new MessageEvent("message", {
      data: { jsonrpc: "2.0", id: msg.id, error },
    }),
  );
}

function completeHandshake(): void {
  respondToRequest("ui/initialize", makeInitResult());
}

function dispatchNotification(method: string, params?: Record<string, unknown>): void {
  window.dispatchEvent(
    new MessageEvent("message", {
      data: { jsonrpc: "2.0", method, ...(params !== undefined && { params }) },
    }),
  );
}

function makeCreateTaskResult(taskId: string, overrides?: Partial<Task>): CreateTaskResult {
  return {
    task: {
      taskId,
      status: WORKING_STATUS,
      ttl: 60_000,
      createdAt: "2026-04-22T00:00:00.000Z",
      lastUpdatedAt: "2026-04-22T00:00:00.000Z",
      ...overrides,
    },
  };
}

function createWrapper() {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <SynapseProvider name="test-app" version="1.0.0">
        {children}
      </SynapseProvider>
    );
  };
}

/**
 * Let queued microtasks flush so pending promises (e.g. handshake +
 * `tools/call` response) can settle into hook state. `act` wraps the
 * whole thing so React batches any triggered renders.
 */
async function flushMicrotasks(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

// -----------------------------------------------------------------------------
// Setup
// -----------------------------------------------------------------------------

beforeEach(() => {
  postMessageSpy = vi.fn();
  window.parent.postMessage = postMessageSpy;
  answeredIds.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// -----------------------------------------------------------------------------
// fire() → working state
// -----------------------------------------------------------------------------

describe("useCallToolAsTask — fire()", () => {
  it("returns nulls before fire() is called", () => {
    const { result } = renderHook(() => useCallToolAsTask("do_research"), {
      wrapper: createWrapper(),
    });

    expect(result.current.task).toBeNull();
    expect(result.current.result).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.isWorking).toBe(false);
    expect(result.current.isTerminal).toBe(false);
  });

  it("transitions task from null → working after fire()", async () => {
    const { result } = renderHook(() => useCallToolAsTask("do_research"), {
      wrapper: createWrapper(),
    });

    completeHandshake();
    await flushMicrotasks();

    expect(result.current.task).toBeNull();

    await act(async () => {
      result.current.fire({ query: "foo" });
      // Let the request hit the wire, then respond.
      await Promise.resolve();
      respondToRequest(TOOLS_CALL_METHOD, makeCreateTaskResult("tsk_fire"));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.task).not.toBeNull();
    expect(result.current.task?.taskId).toBe("tsk_fire");
    expect(result.current.task?.status).toBe(WORKING_STATUS);
    expect(result.current.isWorking).toBe(true);
    expect(result.current.isTerminal).toBe(false);
  });
});

// -----------------------------------------------------------------------------
// notifications/tasks/status updates
// -----------------------------------------------------------------------------

describe("useCallToolAsTask — status notifications", () => {
  it("updates task when a notifications/tasks/status arrives", async () => {
    const { result } = renderHook(() => useCallToolAsTask("do_thing"), {
      wrapper: createWrapper(),
    });

    completeHandshake();
    await flushMicrotasks();

    await act(async () => {
      result.current.fire({});
      await Promise.resolve();
      respondToRequest(TOOLS_CALL_METHOD, makeCreateTaskResult("tsk_notif"));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.task?.status).toBe(WORKING_STATUS);

    await act(async () => {
      dispatchNotification(TASKS_STATUS_NOTIFICATION_METHOD, {
        taskId: "tsk_notif",
        status: COMPLETED_STATUS,
      });
    });

    expect(result.current.task?.status).toBe(COMPLETED_STATUS);
    expect(result.current.isTerminal).toBe(true);
    expect(result.current.isWorking).toBe(false);
  });
});

// -----------------------------------------------------------------------------
// Polling fallback
// -----------------------------------------------------------------------------

describe("useCallToolAsTask — polling fallback", () => {
  it("issues tasks/get when no notification arrives within pollInterval × 1.5", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useCallToolAsTask("do_thing"), {
      wrapper: createWrapper(),
    });

    // Drive the handshake. `advanceTimersByTimeAsync(0)` flushes
    // microtasks without jumping any scheduled timers forward — we
    // need to reach `fire()` state without accidentally firing the
    // poll fallback timer that gets scheduled mid-test.
    completeHandshake();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    await act(async () => {
      result.current.fire({});
      await vi.advanceTimersByTimeAsync(0);
      respondToRequest(
        TOOLS_CALL_METHOD,
        makeCreateTaskResult("tsk_poll", { pollInterval: 2_000 }),
      );
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.task?.status).toBe(WORKING_STATUS);
    expect(findAllCalls(TASKS_GET_METHOD)).toHaveLength(0);

    // pollInterval × 1.5 = 3000ms. Advance past that boundary — should
    // trigger exactly one `tasks/get`.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_100);
    });

    const getCalls = findAllCalls(TASKS_GET_METHOD);
    expect(getCalls.length).toBeGreaterThanOrEqual(1);
    const params = getCalls[0].params as GetTaskRequest["params"];
    expect(params.taskId).toBe("tsk_poll");

    // Respond to the tasks/get with updated state — hook should
    // adopt the refreshed task.
    const freshTask: GetTaskResult = {
      taskId: "tsk_poll",
      status: WORKING_STATUS,
      ttl: 60_000,
      createdAt: "2026-04-22T00:00:00.000Z",
      lastUpdatedAt: "2026-04-22T00:00:03.100Z",
      pollInterval: 2_000,
    };
    await act(async () => {
      respondToRequest(TASKS_GET_METHOD, freshTask);
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.task?.lastUpdatedAt).toBe("2026-04-22T00:00:03.100Z");
  });

  it("uses the 5s default fallback when no pollInterval is advertised", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useCallToolAsTask("do_thing"), {
      wrapper: createWrapper(),
    });
    completeHandshake();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    await act(async () => {
      result.current.fire({});
      await vi.advanceTimersByTimeAsync(0);
      // NB: no pollInterval on the task.
      respondToRequest(TOOLS_CALL_METHOD, makeCreateTaskResult("tsk_def"));
      await vi.advanceTimersByTimeAsync(0);
    });

    // Default 5000ms × 1.5 = 7500ms. Before the boundary, no poll.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(7_000);
    });
    expect(findAllCalls(TASKS_GET_METHOD).length).toBe(0);

    // Past the boundary, poll fires.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(findAllCalls(TASKS_GET_METHOD).length).toBe(1);
  });

  it("stops polling once the task becomes terminal", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useCallToolAsTask("do_thing"), {
      wrapper: createWrapper(),
    });
    completeHandshake();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    await act(async () => {
      result.current.fire({});
      await vi.advanceTimersByTimeAsync(0);
      respondToRequest(
        TOOLS_CALL_METHOD,
        makeCreateTaskResult("tsk_term", { pollInterval: 1_000 }),
      );
      await vi.advanceTimersByTimeAsync(0);
    });

    // One poll fires.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_600);
    });
    const firstPolls = findAllCalls(TASKS_GET_METHOD).length;
    expect(firstPolls).toBeGreaterThanOrEqual(1);

    // Receiver reports terminal.
    await act(async () => {
      respondToRequest(TASKS_GET_METHOD, {
        taskId: "tsk_term",
        status: COMPLETED_STATUS,
        ttl: 60_000,
        createdAt: "2026-04-22T00:00:00.000Z",
        lastUpdatedAt: "2026-04-22T00:00:01.600Z",
      } satisfies GetTaskResult);
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.isTerminal).toBe(true);

    // Advance far past the next would-be boundary — no new polls.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(findAllCalls(TASKS_GET_METHOD).length).toBe(firstPolls);
  });
});

// -----------------------------------------------------------------------------
// result / error population
// -----------------------------------------------------------------------------

describe("useCallToolAsTask — result & error", () => {
  it("populates result on terminal completion", async () => {
    const { result } = renderHook(
      () => useCallToolAsTask<Record<string, unknown>, { answer: number }>("do_thing"),
      {
        wrapper: createWrapper(),
      },
    );
    completeHandshake();
    await flushMicrotasks();

    await act(async () => {
      result.current.fire({});
      await Promise.resolve();
      respondToRequest(TOOLS_CALL_METHOD, makeCreateTaskResult("tsk_ok"));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.task?.status).toBe(WORKING_STATUS);

    // Respond to the pending tasks/result.
    await act(async () => {
      respondToRequest(TASKS_RESULT_METHOD, {
        content: [{ type: "text", text: '{"answer":42}' }],
      } satisfies CallToolResult);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.result).not.toBeNull();
    expect(result.current.result?.isError).toBe(false);
    expect(result.current.result?.data).toEqual({ answer: 42 });
    expect(result.current.error).toBeNull();
  });

  it("populates error when CallToolResult.isError is true", async () => {
    const { result } = renderHook(() => useCallToolAsTask("do_thing"), {
      wrapper: createWrapper(),
    });
    completeHandshake();
    await flushMicrotasks();

    await act(async () => {
      result.current.fire({});
      await Promise.resolve();
      respondToRequest(TOOLS_CALL_METHOD, makeCreateTaskResult("tsk_terr"));
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      respondToRequest(TASKS_RESULT_METHOD, {
        isError: true,
        content: [{ type: "text", text: "boom" }],
      } satisfies CallToolResult);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.error).not.toBeNull();
    expect(result.current.error?.message).toContain("boom");
    // Result still populated so consumers can read the raw payload.
    expect(result.current.result?.isError).toBe(true);
  });

  it("populates error when notifications/tasks/status reports failed", async () => {
    const { result } = renderHook(() => useCallToolAsTask("do_thing"), {
      wrapper: createWrapper(),
    });
    completeHandshake();
    await flushMicrotasks();

    await act(async () => {
      result.current.fire({});
      await Promise.resolve();
      respondToRequest(TOOLS_CALL_METHOD, makeCreateTaskResult("tsk_fail"));
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      dispatchNotification(TASKS_STATUS_NOTIFICATION_METHOD, {
        taskId: "tsk_fail",
        status: FAILED_STATUS,
      });
    });

    expect(result.current.task?.status).toBe(FAILED_STATUS);
    expect(result.current.isTerminal).toBe(true);
    expect(result.current.isWorking).toBe(false);

    // Now the blocking tasks/result resolves with isError:true — both
    // notification-driven terminal state and error surface correctly.
    await act(async () => {
      respondToRequest(TASKS_RESULT_METHOD, {
        isError: true,
        content: [{ type: "text", text: "failed" }],
      } satisfies CallToolResult);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.error).not.toBeNull();
  });
});

// -----------------------------------------------------------------------------
// cancel()
// -----------------------------------------------------------------------------

describe("useCallToolAsTask — cancel()", () => {
  it("transitions task to cancelled and stops polling", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useCallToolAsTask("do_thing"), {
      wrapper: createWrapper(),
    });
    completeHandshake();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    await act(async () => {
      result.current.fire({});
      await vi.advanceTimersByTimeAsync(0);
      respondToRequest(
        TOOLS_CALL_METHOD,
        makeCreateTaskResult("tsk_cancel", { pollInterval: 1_000 }),
      );
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.isWorking).toBe(true);

    // Call cancel, respond to the tasks/cancel request.
    await act(async () => {
      const p = result.current.cancel();
      await vi.advanceTimersByTimeAsync(0);
      respondToRequest(TASKS_CANCEL_METHOD, {
        taskId: "tsk_cancel",
        status: CANCELLED_STATUS,
        ttl: 60_000,
        createdAt: "2026-04-22T00:00:00.000Z",
        lastUpdatedAt: "2026-04-22T00:00:02.000Z",
      } satisfies CancelTaskResult);
      await vi.advanceTimersByTimeAsync(0);
      await p;
    });

    expect(result.current.task?.status).toBe(CANCELLED_STATUS);
    expect(result.current.isTerminal).toBe(true);
    expect(result.current.isWorking).toBe(false);

    // Advance time — polling should not fire anymore.
    const pollsBefore = findAllCalls(TASKS_GET_METHOD).length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(findAllCalls(TASKS_GET_METHOD).length).toBe(pollsBefore);
  });

  it("surfaces cancel errors via error state", async () => {
    const { result } = renderHook(() => useCallToolAsTask("do_thing"), {
      wrapper: createWrapper(),
    });
    completeHandshake();
    await flushMicrotasks();

    await act(async () => {
      result.current.fire({});
      await Promise.resolve();
      respondToRequest(TOOLS_CALL_METHOD, makeCreateTaskResult("tsk_cerr"));
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      const p = result.current.cancel();
      await Promise.resolve();
      rejectRequest(TASKS_CANCEL_METHOD, { code: -32602, message: "task already terminal" });
      await Promise.resolve();
      await p;
    });

    expect(result.current.error?.message).toMatch(/terminal/);
  });

  it("is a no-op when called without an active task", async () => {
    const { result } = renderHook(() => useCallToolAsTask("do_thing"), {
      wrapper: createWrapper(),
    });

    // Should not throw; no pending cancel request should go out.
    await act(async () => {
      await result.current.cancel();
    });

    expect(findAllCalls(TASKS_CANCEL_METHOD)).toHaveLength(0);
    expect(result.current.error).toBeNull();
  });
});

// -----------------------------------------------------------------------------
// isWorking / isTerminal derivation
// -----------------------------------------------------------------------------

describe("useCallToolAsTask — isWorking / isTerminal", () => {
  it.each([
    [WORKING_STATUS, true, false],
    [COMPLETED_STATUS, false, true],
    [FAILED_STATUS, false, true],
    [CANCELLED_STATUS, false, true],
  ])("status=%s → isWorking=%s, isTerminal=%s", async (status, expectWorking, expectTerminal) => {
    const { result } = renderHook(() => useCallToolAsTask("do_thing"), {
      wrapper: createWrapper(),
    });
    completeHandshake();
    await flushMicrotasks();

    await act(async () => {
      result.current.fire({});
      await Promise.resolve();
      respondToRequest(TOOLS_CALL_METHOD, makeCreateTaskResult(`tsk_${status}`));
      await Promise.resolve();
      await Promise.resolve();
    });

    // Drive to the target status via a notification.
    await act(async () => {
      dispatchNotification(TASKS_STATUS_NOTIFICATION_METHOD, {
        taskId: `tsk_${status}`,
        status,
      });
    });

    expect(result.current.isWorking).toBe(expectWorking);
    expect(result.current.isTerminal).toBe(expectTerminal);
  });
});

// -----------------------------------------------------------------------------
// Unmount cleanup
// -----------------------------------------------------------------------------

describe("useCallToolAsTask — unmount cleanup", () => {
  it("stops polling and does NOT send tasks/cancel on unmount", async () => {
    vi.useFakeTimers();
    const { result, unmount } = renderHook(() => useCallToolAsTask("do_thing"), {
      wrapper: createWrapper(),
    });
    completeHandshake();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    await act(async () => {
      result.current.fire({});
      await vi.advanceTimersByTimeAsync(0);
      respondToRequest(
        TOOLS_CALL_METHOD,
        makeCreateTaskResult("tsk_unmount", { pollInterval: 1_000 }),
      );
      await vi.advanceTimersByTimeAsync(0);
    });

    const cancelCallsBefore = findAllCalls(TASKS_CANCEL_METHOD).length;
    const pollsBefore = findAllCalls(TASKS_GET_METHOD).length;

    // Unmount mid-task.
    unmount();

    // No setState warnings should surface (would be logged to console
    // by React). Also, advance past the poll boundary — no new polls
    // should be sent after unmount.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(findAllCalls(TASKS_GET_METHOD).length).toBe(pollsBefore);
    // Critical: unmount must NOT cancel the server-side task.
    expect(findAllCalls(TASKS_CANCEL_METHOD).length).toBe(cancelCallsBefore);
  });

  it("does not emit state updates after unmount when notifications still arrive", async () => {
    // Real timers — drives through microtask queue without test timers.
    const { result, unmount } = renderHook(() => useCallToolAsTask("do_thing"), {
      wrapper: createWrapper(),
    });
    completeHandshake();
    await flushMicrotasks();

    await act(async () => {
      result.current.fire({});
      await Promise.resolve();
      respondToRequest(TOOLS_CALL_METHOD, makeCreateTaskResult("tsk_late"));
      await Promise.resolve();
      await Promise.resolve();
    });

    const consoleErrorSpy = vi.spyOn(console, "error");
    unmount();

    // Late notification shouldn't trigger a React warning.
    dispatchNotification(TASKS_STATUS_NOTIFICATION_METHOD, {
      taskId: "tsk_late",
      status: COMPLETED_STATUS,
    });

    // Late tasks/result response shouldn't either.
    try {
      respondToRequest(TASKS_RESULT_METHOD, {
        content: [{ type: "text", text: '"ok"' }],
      } satisfies CallToolResult);
    } catch {
      // If the request was already resolved, that's fine.
    }

    await new Promise((r) => setTimeout(r, 0));

    // React's "can't perform state update on unmounted component" is a
    // console.error in dev builds. We assert zero such calls.
    const unmountWarnings = consoleErrorSpy.mock.calls.filter(
      (c) => typeof c[0] === "string" && /unmounted/i.test(c[0]),
    );
    expect(unmountWarnings).toHaveLength(0);
    consoleErrorSpy.mockRestore();
  });
});

// -----------------------------------------------------------------------------
// Re-fire mid-task
// -----------------------------------------------------------------------------

describe("useCallToolAsTask — re-fire while a previous task is running", () => {
  it("replaces the handle without cancelling the prior server-side task", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useCallToolAsTask("do_thing"), {
      wrapper: createWrapper(),
    });
    completeHandshake();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    await act(async () => {
      result.current.fire({ query: "first" });
      await vi.advanceTimersByTimeAsync(0);
      respondToRequest(
        TOOLS_CALL_METHOD,
        makeCreateTaskResult("tsk_first", { pollInterval: 1_000 }),
      );
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.task?.taskId).toBe("tsk_first");
    const cancelCallsBefore = findAllCalls(TASKS_CANCEL_METHOD).length;

    // Re-fire before the first task reaches terminal.
    await act(async () => {
      result.current.fire({ query: "second" });
      await vi.advanceTimersByTimeAsync(0);
      respondToRequest(
        TOOLS_CALL_METHOD,
        makeCreateTaskResult("tsk_second", { pollInterval: 1_000 }),
      );
      await vi.advanceTimersByTimeAsync(0);
    });

    // New task is active.
    expect(result.current.task?.taskId).toBe("tsk_second");
    expect(result.current.isWorking).toBe(true);
    expect(result.current.error).toBeNull();

    // The prior task must NOT have been cancelled on the wire — that's
    // the "leave server-side state intact" rule from Task 005.
    expect(findAllCalls(TASKS_CANCEL_METHOD).length).toBe(cancelCallsBefore);

    // Notifications for the OLD task must no longer update hook state
    // (listener was unsubscribed on re-fire).
    await act(async () => {
      dispatchNotification(TASKS_STATUS_NOTIFICATION_METHOD, {
        taskId: "tsk_first",
        status: COMPLETED_STATUS,
      });
    });
    expect(result.current.task?.taskId).toBe("tsk_second");
    expect(result.current.task?.status).toBe(WORKING_STATUS);

    // Notifications for the NEW task do update state.
    await act(async () => {
      dispatchNotification(TASKS_STATUS_NOTIFICATION_METHOD, {
        taskId: "tsk_second",
        status: COMPLETED_STATUS,
      });
    });
    expect(result.current.task?.status).toBe(COMPLETED_STATUS);
  });
});

// -----------------------------------------------------------------------------
// Stable callback identities
// -----------------------------------------------------------------------------

describe("useCallToolAsTask — stable callback identities", () => {
  it("fire and cancel identities are stable across renders (safe as deps)", async () => {
    const { result, rerender } = renderHook(() => useCallToolAsTask("do_thing"), {
      wrapper: createWrapper(),
    });

    const fire1 = result.current.fire;
    const cancel1 = result.current.cancel;

    rerender();

    expect(result.current.fire).toBe(fire1);
    expect(result.current.cancel).toBe(cancel1);
  });
});

// -----------------------------------------------------------------------------
// result() settles the polling loop and synthesizes terminal task state.
// Per spec, `tasks/result` is blocking — when it returns, the task IS
// terminal, even if no notification or poll has settled yet. The hook
// must reflect that immediately so consumers don't see incoherent
// `result populated && isWorking=true` renders.
// -----------------------------------------------------------------------------

describe("useCallToolAsTask — result() settles terminal state", () => {
  it("result() success synthesizes status='completed' and stops polling", async () => {
    vi.useFakeTimers();

    const { result } = renderHook(() => useCallToolAsTask("do_thing"), {
      wrapper: createWrapper(),
    });

    completeHandshake();
    await flushMicrotasks();

    await act(async () => {
      result.current.fire();
      await Promise.resolve();
    });
    respondToRequest(TOOLS_CALL_METHOD, makeCreateTaskResult("tsk_done"));
    await flushMicrotasks();

    // Resolve `tasks/result` BEFORE any notification or refresh has
    // moved task.status off `working`.
    expect(result.current.task?.status).toBe(WORKING_STATUS);
    expect(result.current.isTerminal).toBe(false);

    respondToRequest(TASKS_RESULT_METHOD, {
      content: [{ type: "text", text: '{"ok":true}' }],
    });
    await flushMicrotasks();

    // The hook must reach terminal state on the strength of result()
    // alone, without waiting for a status notification or poll.
    expect(result.current.result).not.toBeNull();
    expect(result.current.task?.status).toBe(COMPLETED_STATUS);
    expect(result.current.isTerminal).toBe(true);
    expect(result.current.isWorking).toBe(false);

    // Polling must have stopped — advancing past the poll cadence
    // does NOT produce a new tasks/get on the wire.
    const beforeAdvance = findAllCalls(TASKS_GET_METHOD).length;
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    expect(findAllCalls(TASKS_GET_METHOD).length).toBe(beforeAdvance);
  });

  it("result() with isError synthesizes status='failed' and stops polling", async () => {
    vi.useFakeTimers();

    const { result } = renderHook(() => useCallToolAsTask("do_thing"), {
      wrapper: createWrapper(),
    });

    completeHandshake();
    await flushMicrotasks();

    await act(async () => {
      result.current.fire();
      await Promise.resolve();
    });
    respondToRequest(TOOLS_CALL_METHOD, makeCreateTaskResult("tsk_isError"));
    await flushMicrotasks();

    respondToRequest(TASKS_RESULT_METHOD, {
      content: [{ type: "text", text: "boom" }],
      isError: true,
    });
    await flushMicrotasks();

    expect(result.current.task?.status).toBe(FAILED_STATUS);
    expect(result.current.isTerminal).toBe(true);
    expect(result.current.error).not.toBeNull();

    const beforeAdvance = findAllCalls(TASKS_GET_METHOD).length;
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    expect(findAllCalls(TASKS_GET_METHOD).length).toBe(beforeAdvance);
  });

  it("result() rejection synthesizes status='failed' and stops polling", async () => {
    vi.useFakeTimers();

    const { result } = renderHook(() => useCallToolAsTask("do_thing"), {
      wrapper: createWrapper(),
    });

    completeHandshake();
    await flushMicrotasks();

    await act(async () => {
      result.current.fire();
      await Promise.resolve();
    });
    respondToRequest(TOOLS_CALL_METHOD, makeCreateTaskResult("tsk_reject"));
    await flushMicrotasks();

    rejectRequest(TASKS_RESULT_METHOD, { code: -32602, message: "task gone" });
    await flushMicrotasks();

    expect(result.current.error?.message).toContain("task gone");
    expect(result.current.task?.status).toBe(FAILED_STATUS);
    expect(result.current.isTerminal).toBe(true);

    const beforeAdvance = findAllCalls(TASKS_GET_METHOD).length;
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    expect(findAllCalls(TASKS_GET_METHOD).length).toBe(beforeAdvance);
  });
});

// -----------------------------------------------------------------------------
// Bounded backoff: max consecutive refresh failures stops the poll loop.
// Without the guard, a host-side TTL eviction or bridge teardown would
// cause every refresh to reject and the timer would re-arm forever.
// -----------------------------------------------------------------------------

describe("useCallToolAsTask — refresh failure backoff", () => {
  it("stops polling silently after MAX_REFRESH_FAILURES consecutive rejects", async () => {
    vi.useFakeTimers();

    const { result } = renderHook(() => useCallToolAsTask("do_thing"), {
      wrapper: createWrapper(),
    });

    completeHandshake();
    await flushMicrotasks();

    await act(async () => {
      result.current.fire();
      await Promise.resolve();
    });
    // pollInterval=1000 → fallback fires every 1500ms. Note: result()
    // is intentionally LEFT UNANSWERED so the polling loop is the only
    // path that could keep firing.
    respondToRequest(
      TOOLS_CALL_METHOD,
      makeCreateTaskResult("tsk_failover", { pollInterval: 1000 }),
    );
    await flushMicrotasks();

    // Reject 5 consecutive refreshes (the MAX_REFRESH_FAILURES limit).
    // After the 5th, the timer must NOT re-arm.
    for (let i = 0; i < 5; i++) {
      await act(async () => {
        vi.advanceTimersByTime(1500);
      });
      await flushMicrotasks();
      rejectRequest(TASKS_GET_METHOD, { code: -32602, message: "gone" });
      await flushMicrotasks();
    }

    const callsAfterLimit = findAllCalls(TASKS_GET_METHOD).length;
    expect(callsAfterLimit).toBe(5);

    // Advance way past the cadence — no further tasks/get should
    // appear on the wire.
    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });
    expect(findAllCalls(TASKS_GET_METHOD).length).toBe(5);
  });

  it("resets the failure counter on a successful refresh", async () => {
    vi.useFakeTimers();

    const { result } = renderHook(() => useCallToolAsTask("do_thing"), {
      wrapper: createWrapper(),
    });

    completeHandshake();
    await flushMicrotasks();

    await act(async () => {
      result.current.fire();
      await Promise.resolve();
    });
    respondToRequest(
      TOOLS_CALL_METHOD,
      makeCreateTaskResult("tsk_recovered", { pollInterval: 1000 }),
    );
    await flushMicrotasks();

    // 4 rejects, then 1 success, then 4 more rejects — should NOT trip
    // the limit because the counter resets in the middle.
    for (let i = 0; i < 4; i++) {
      await act(async () => {
        vi.advanceTimersByTime(1500);
      });
      await flushMicrotasks();
      rejectRequest(TASKS_GET_METHOD, { code: -32602, message: "transient" });
      await flushMicrotasks();
    }

    await act(async () => {
      vi.advanceTimersByTime(1500);
    });
    await flushMicrotasks();
    respondToRequest(TASKS_GET_METHOD, {
      taskId: "tsk_recovered",
      status: WORKING_STATUS,
      ttl: 60_000,
      createdAt: "2026-04-22T00:00:00.000Z",
      lastUpdatedAt: "2026-04-22T00:00:05.000Z",
    } satisfies GetTaskResult);
    await flushMicrotasks();

    for (let i = 0; i < 4; i++) {
      await act(async () => {
        vi.advanceTimersByTime(1500);
      });
      await flushMicrotasks();
      rejectRequest(TASKS_GET_METHOD, { code: -32602, message: "transient" });
      await flushMicrotasks();
    }

    // 9 polls fired (4 reject + 1 success + 4 reject). If the counter
    // hadn't reset, the loop would have stopped at strike 5 (just 5
    // polls total).
    expect(findAllCalls(TASKS_GET_METHOD).length).toBe(9);
  });
});

// -----------------------------------------------------------------------------
// onStatus delivers a fully-populated Task (no placeholder timestamps).
// Spec's TaskStatusNotificationParams omits createdAt/lastUpdatedAt/ttl;
// the handle merges these from the initial CreateTaskResult.task.
// -----------------------------------------------------------------------------

describe("useCallToolAsTask — onStatus merges initial Task fields", () => {
  it("notification-driven task updates carry real timestamps, not empty strings", async () => {
    const { result } = renderHook(() => useCallToolAsTask("do_thing"), {
      wrapper: createWrapper(),
    });

    completeHandshake();
    await flushMicrotasks();

    await act(async () => {
      result.current.fire();
      await Promise.resolve();
    });
    respondToRequest(
      TOOLS_CALL_METHOD,
      makeCreateTaskResult("tsk_merge", {
        createdAt: "2026-04-22T00:00:00.000Z",
        ttl: 120_000,
        pollInterval: 2_000,
      }),
    );
    await flushMicrotasks();

    await act(async () => {
      dispatchNotification(TASKS_STATUS_NOTIFICATION_METHOD, {
        taskId: "tsk_merge",
        status: WORKING_STATUS,
        statusMessage: "halfway",
      });
    });
    await flushMicrotasks();

    const task = result.current.task;
    expect(task).not.toBeNull();
    // Notification fields win.
    expect(task?.taskId).toBe("tsk_merge");
    expect(task?.status).toBe(WORKING_STATUS);
    expect(task?.statusMessage).toBe("halfway");
    // Initial-task fields fill in.
    expect(task?.createdAt).toBe("2026-04-22T00:00:00.000Z");
    expect(task?.ttl).toBe(120_000);
    expect(task?.pollInterval).toBe(2_000);
    // Received-time stamp — not empty, parses as a real ISO date.
    expect(task?.lastUpdatedAt).not.toBe("");
    expect(Number.isFinite(Date.parse(task?.lastUpdatedAt ?? ""))).toBe(true);
  });
});

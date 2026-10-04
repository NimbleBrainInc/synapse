/**
 * `useCallToolAsTask` — React lifecycle wrapper around `callToolAsTask`,
 * against the MCP tasks extension (`io.modelcontextprotocol/tasks`,
 * protocol 2026-07-28).
 *
 * Tests exercise the hook's public API through `AppProvider` and a mocked
 * `postMessage` transport. Method strings come from SDK request types; the
 * extension's own wire fields are pinned literally.
 */

import type {
  CallToolRequest,
  CallToolResult,
  CancelTaskRequest,
  GetTaskRequest,
  TaskStatus,
} from "@modelcontextprotocol/client";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HostCapabilityError, TaskError } from "../../errors.js";
import { AppProvider, useCallToolAsTask } from "../../react/index.js";
import type { TasksCapability } from "../../types.js";

const TOOLS_CALL_METHOD: CallToolRequest["method"] = "tools/call";
const TASKS_GET_METHOD: GetTaskRequest["method"] = "tasks/get";
const TASKS_CANCEL_METHOD: CancelTaskRequest["method"] = "tasks/cancel";

const WORKING: TaskStatus = "working";
const INPUT_REQUIRED: TaskStatus = "input_required";
const COMPLETED: TaskStatus = "completed";
const FAILED: TaskStatus = "failed";
const CANCELLED: TaskStatus = "cancelled";

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

let postMessageSpy: ReturnType<typeof vi.fn>;

/** Let the client send, and let a dispatched frame reach its handler. */
async function flush(): Promise<void> {
  // Microtasks only, never a timer: fake timers would otherwise stall it.
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

function makeInitResult(hostTasks: TasksCapability | null) {
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

async function reply(method: string, data: Record<string, unknown>): Promise<void> {
  await flush();
  const msg = sent(method).find((m) => m.id !== undefined && !answeredIds.has(String(m.id)));
  if (!msg) throw new Error(`No pending ${method} request`);
  answeredIds.add(String(msg.id));
  window.dispatchEvent(
    new MessageEvent("message", {
      source: window.parent,
      data: { jsonrpc: "2.0", id: msg.id, ...data },
    }),
  );
  await flush();
}

const respond = (method: string, result: unknown) => reply(method, { result });
const respondError = (method: string, code: number, message: string) =>
  reply(method, { error: { code, message } });

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

function createWrapper() {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <AppProvider name="test-app" version="1.0.0">
        {children}
      </AppProvider>
    );
  };
}

async function settle(): Promise<void> {
  await act(async () => {
    await flush();
  });
}

/** Render the hook and complete the handshake. */
async function renderReady(hostTasks: TasksCapability | null = {}, toolName = "do_research") {
  const rendered = renderHook(() => useCallToolAsTask(toolName), { wrapper: createWrapper() });
  await flush();
  await respond("ui/initialize", makeInitResult(hostTasks));
  await settle();
  return rendered;
}

type Rendered = Awaited<ReturnType<typeof renderReady>>;

/** Fire, and answer the `tools/call` with `answer`. */
async function fireWith(r: Rendered, answer: unknown): Promise<void> {
  await act(async () => {
    void r.result.current.fire({ query: "foo" }).catch(() => {});
    await respond(TOOLS_CALL_METHOD, answer);
    await flush();
  });
}

/** Advance fake time inside `act`, so the renders it causes are flushed. */
async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function answerGet(result: unknown): Promise<void> {
  await act(async () => {
    await respond(TASKS_GET_METHOD, result);
    await flush();
  });
}

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
// fire()
// -----------------------------------------------------------------------------

describe("useCallToolAsTask — fire()", () => {
  it("returns nulls before fire() is called", async () => {
    const { result } = await renderReady();
    expect(result.current.task).toBeNull();
    expect(result.current.result).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.isWorking).toBe(false);
    expect(result.current.isTerminal).toBe(false);
  });

  it("a task answer leaves the hook working", async () => {
    const r = await renderReady();
    await fireWith(r, wireTask("tsk_fire", WORKING));
    expect(r.result.current.task?.taskId).toBe("tsk_fire");
    expect(r.result.current.task?.status).toBe(WORKING);
    expect(r.result.current.isWorking).toBe(true);
    expect(r.result.current.isTerminal).toBe(false);
  });

  it("a call answered outright completes at once with its result", async () => {
    const r = await renderReady();
    await fireWith(r, TOOL_RESULT);
    expect(r.result.current.task?.status).toBe(COMPLETED);
    expect(r.result.current.result?.data).toEqual({ answer: 42 });
    expect(r.result.current.error).toBeNull();
    expect(r.result.current.isTerminal).toBe(true);
    expect(sent(TASKS_GET_METHOD)).toHaveLength(0);
  });

  it("without the host's tasks extension, fire rejects and error holds HostCapabilityError", async () => {
    const r = await renderReady(null);
    let thrown: unknown;
    await act(async () => {
      thrown = await r.result.current.fire({}).catch((e: unknown) => e);
    });
    expect(thrown).toBeInstanceOf(HostCapabilityError);
    expect(r.result.current.error).toBeInstanceOf(HostCapabilityError);
    expect(sent(TOOLS_CALL_METHOD)).toHaveLength(0);
  });
});

// -----------------------------------------------------------------------------
// Polling, result, error
// -----------------------------------------------------------------------------

describe("useCallToolAsTask — polling to the end", () => {
  it("mirrors polled status and lands the inlined result", async () => {
    vi.useFakeTimers();
    const r = await renderReady();
    await fireWith(r, wireTask("tsk_poll", WORKING, { pollIntervalMs: 1_000 }));

    await advance(1_000);
    expect(sent(TASKS_GET_METHOD)).toHaveLength(1);
    await answerGet(wireTask("tsk_poll", WORKING, { statusMessage: "halfway" }));
    expect(r.result.current.task?.statusMessage).toBe("halfway");
    expect(r.result.current.isWorking).toBe(true);

    await advance(1_000);
    await answerGet(wireTask("tsk_poll", COMPLETED, { result: TOOL_RESULT }));
    expect(r.result.current.task?.status).toBe(COMPLETED);
    expect(r.result.current.result?.data).toEqual({ answer: 42 });
    expect(r.result.current.isTerminal).toBe(true);

    // Nothing polls after the end.
    await advance(10_000);
    expect(sent(TASKS_GET_METHOD)).toHaveLength(2);
    expect(sent("tasks/result")).toHaveLength(0);
  });

  it("an isError result sets both result and error", async () => {
    vi.useFakeTimers();
    const r = await renderReady();
    await fireWith(r, wireTask("tsk_iserr", WORKING, { pollIntervalMs: 500 }));
    await advance(500);
    await answerGet(
      wireTask("tsk_iserr", COMPLETED, {
        result: { content: [{ type: "text", text: "quota exceeded" }], isError: true },
      }),
    );
    expect(r.result.current.result?.isError).toBe(true);
    expect(r.result.current.error?.message).toBe("quota exceeded");
    expect(r.result.current.isTerminal).toBe(true);
  });

  it("a failed task sets error to a TaskError carrying the host's message", async () => {
    vi.useFakeTimers();
    const r = await renderReady();
    await fireWith(r, wireTask("tsk_fail", WORKING, { pollIntervalMs: 500 }));
    await advance(500);
    await answerGet(wireTask("tsk_fail", FAILED, { error: { code: -32603, message: "boom" } }));

    expect(r.result.current.error).toBeInstanceOf(TaskError);
    expect(r.result.current.error?.message).toBe("boom");
    expect(r.result.current.task?.status).toBe(FAILED);
    expect(r.result.current.isTerminal).toBe(true);
    expect(r.result.current.isWorking).toBe(false);
  });

  it("input_required cancels the task and ends the hook with an error", async () => {
    vi.useFakeTimers();
    const r = await renderReady();
    await fireWith(r, wireTask("tsk_input", WORKING, { pollIntervalMs: 500 }));
    await advance(500);
    await answerGet(wireTask("tsk_input", INPUT_REQUIRED));
    await act(async () => {
      await respond(TASKS_CANCEL_METHOD, {});
      await flush();
    });

    expect(sent(TASKS_CANCEL_METHOD)).toHaveLength(1);
    expect(r.result.current.error).toBeInstanceOf(TaskError);
    expect(r.result.current.task?.status).toBe(INPUT_REQUIRED);
    expect(r.result.current.isTerminal).toBe(true);
    expect(r.result.current.isWorking).toBe(false);
  });

  it("a failed poll ends the hook as failed with the error", async () => {
    vi.useFakeTimers();
    const r = await renderReady();
    await fireWith(r, wireTask("tsk_gone", WORKING, { pollIntervalMs: 500 }));
    await advance(500);
    await act(async () => {
      await respondError(TASKS_GET_METHOD, -32602, "unknown task");
      await flush();
    });
    expect(r.result.current.error?.message).toMatch(/unknown task/);
    expect(r.result.current.task?.status).toBe(FAILED);
    expect(r.result.current.isTerminal).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// cancel()
// -----------------------------------------------------------------------------

describe("useCallToolAsTask — cancel()", () => {
  it("cancels, shows the cancelled task, stops polling, and reports no error", async () => {
    vi.useFakeTimers();
    const r = await renderReady();
    await fireWith(r, wireTask("tsk_cancel", WORKING, { pollIntervalMs: 1_000 }));

    await act(async () => {
      void r.result.current.cancel();
      await respond(TASKS_CANCEL_METHOD, {});
      await respond(TASKS_GET_METHOD, wireTask("tsk_cancel", CANCELLED));
      await flush();
    });

    expect(sent(TASKS_CANCEL_METHOD)[0]!.params).toEqual({ taskId: "tsk_cancel" });
    expect(r.result.current.task?.status).toBe(CANCELLED);
    expect(r.result.current.error).toBeNull();
    expect(r.result.current.isTerminal).toBe(true);

    await advance(10_000);
    expect(sent(TASKS_GET_METHOD)).toHaveLength(1);
  });

  it("surfaces a cancel failure via error", async () => {
    const r = await renderReady();
    await fireWith(r, wireTask("tsk_cancel_err", WORKING));
    await act(async () => {
      void r.result.current.cancel();
      await respondError(TASKS_CANCEL_METHOD, -32602, "already terminal");
      await flush();
    });
    expect(r.result.current.error?.message).toMatch(/already terminal/);
  });

  it("is a no-op without an active task", async () => {
    const r = await renderReady();
    await act(async () => {
      await r.result.current.cancel();
    });
    expect(sent(TASKS_CANCEL_METHOD)).toHaveLength(0);
  });
});

// -----------------------------------------------------------------------------
// Lifecycle
// -----------------------------------------------------------------------------

describe("useCallToolAsTask — lifecycle", () => {
  it("unmount stops polling and does not cancel the task", async () => {
    vi.useFakeTimers();
    const r = await renderReady();
    await fireWith(r, wireTask("tsk_unmount", WORKING, { pollIntervalMs: 500 }));

    r.unmount();
    await advance(10_000);
    expect(sent(TASKS_GET_METHOD)).toHaveLength(0);
    expect(sent(TASKS_CANCEL_METHOD)).toHaveLength(0);
  });

  it("re-firing follows the new task, leaves the old one running, and polls only the new one", async () => {
    vi.useFakeTimers();
    const r = await renderReady();
    await fireWith(r, wireTask("tsk_first", WORKING, { pollIntervalMs: 500 }));
    await fireWith(r, wireTask("tsk_second", WORKING, { pollIntervalMs: 500 }));

    expect(r.result.current.task?.taskId).toBe("tsk_second");
    await advance(500);
    const gets = sent(TASKS_GET_METHOD);
    expect(gets).toHaveLength(1);
    expect(gets[0]!.params).toEqual({ taskId: "tsk_second" });
    expect(sent(TASKS_CANCEL_METHOD)).toHaveLength(0);
    await answerGet(wireTask("tsk_second", COMPLETED, { result: TOOL_RESULT }));
    expect(r.result.current.result?.data).toEqual({ answer: 42 });
  });

  it("fire and cancel identities are stable across renders", async () => {
    const r = await renderReady();
    const { fire, cancel } = r.result.current;
    r.rerender();
    expect(r.result.current.fire).toBe(fire);
    expect(r.result.current.cancel).toBe(cancel);
  });
});

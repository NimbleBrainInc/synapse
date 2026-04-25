/**
 * Spec Compliance Tests
 *
 * These tests enforce that the synapse library's wire-format messages match
 * the ext-apps spec (2026-01-26) exactly. They use canonical types and
 * constants from @modelcontextprotocol/ext-apps as the source of truth.
 *
 * If the spec changes a field name, method name, or message shape, these
 * tests fail at COMPILE TIME (type errors) or at RUNTIME (assertion failures).
 * This prevents silent regressions like clientInfo vs appInfo.
 */

// --- Canonical spec types and constants ---
import type {
  McpUiAppCapabilities,
  McpUiHostCapabilities,
  McpUiHostContext,
  McpUiHostContextChangedNotification,
  McpUiInitializedNotification,
  McpUiInitializeRequest,
  McpUiInitializeResult,
  McpUiMessageRequest,
  McpUiOpenLinkRequest,
  McpUiSizeChangedNotification,
  McpUiToolCancelledNotification,
  McpUiToolInputNotification,
  McpUiToolInputPartialNotification,
  McpUiToolResultNotification,
  McpUiUpdateModelContextRequest,
} from "@modelcontextprotocol/ext-apps";
import {
  HOST_CONTEXT_CHANGED_METHOD,
  INITIALIZE_METHOD,
  INITIALIZED_METHOD,
  LATEST_PROTOCOL_VERSION,
  MESSAGE_METHOD,
  OPEN_LINK_METHOD,
  RESOURCE_TEARDOWN_METHOD,
  SIZE_CHANGED_METHOD,
  TOOL_CANCELLED_METHOD,
  TOOL_INPUT_METHOD,
  TOOL_INPUT_PARTIAL_METHOD,
  TOOL_RESULT_METHOD,
} from "@modelcontextprotocol/ext-apps";
import type {
  CallToolRequest,
  CancelTaskRequest,
  CreateTaskResult,
  GetTaskPayloadRequest,
  GetTaskPayloadResult,
  GetTaskRequest,
  GetTaskResult,
  ReadResourceRequest,
  ReadResourceResult,
  TaskStatus,
  TextContent,
} from "@modelcontextprotocol/sdk/types.js";
import { RELATED_TASK_META_KEY } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { connect } from "../connect.js";
import { resolveEventMethod } from "../event-map.js";
import { parseToolResult } from "../result-parser.js";
import type { App, TasksCapability } from "../types.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let postMessageSpy: ReturnType<typeof vi.fn>;

/** Build a spec-compliant McpUiInitializeResult. */
function makeSpecInitResult(overrides?: Partial<McpUiInitializeResult>): McpUiInitializeResult {
  return {
    protocolVersion: LATEST_PROTOCOL_VERSION,
    hostInfo: { name: "test-host", version: "1.0.0" },
    hostCapabilities: {
      openLinks: {},
      serverTools: {},
      logging: {},
    },
    hostContext: {
      theme: "dark",
      styles: {
        variables: {
          "--color-background-primary": "#0a0a09",
          "--color-text-primary": "#e5e5e5",
        },
      },
      toolInfo: {
        tool: { name: "search", description: "Search", inputSchema: { type: "object" } },
      },
      containerDimensions: { width: 400, maxHeight: 800 },
    },
    ...overrides,
  };
}

/** Connect and complete the ext-apps handshake with a spec-compliant response. */
function connectAndHandshake(
  options?: Partial<Parameters<typeof connect>[0]>,
  initResult?: McpUiInitializeResult,
): Promise<App> {
  const promise = connect({ name: "test-app", version: "1.0.0", ...options });

  const initCall = postMessageSpy.mock.calls.find(
    (c: unknown[]) =>
      c[0] &&
      typeof c[0] === "object" &&
      (c[0] as Record<string, unknown>).method === INITIALIZE_METHOD,
  );
  if (!initCall) throw new Error("No ui/initialize call found");

  const id = (initCall[0] as Record<string, unknown>).id as string;
  window.dispatchEvent(
    new MessageEvent("message", {
      data: { jsonrpc: "2.0", id, result: initResult ?? makeSpecInitResult() },
    }),
  );

  return promise;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  postMessageSpy = vi.fn();
  window.parent.postMessage = postMessageSpy;
  Object.defineProperty(document.body, "scrollWidth", { value: 800, configurable: true });
  Object.defineProperty(document.body, "scrollHeight", { value: 600, configurable: true });
});

let app: App | undefined;
afterEach(() => {
  app?.destroy();
  app = undefined;
});

// ---------------------------------------------------------------------------
// 1. Method name constants match the spec
// ---------------------------------------------------------------------------

describe("method name constants", () => {
  it("INITIALIZE_METHOD is ui/initialize", () => {
    expect(INITIALIZE_METHOD).toBe("ui/initialize");
  });

  it("INITIALIZED_METHOD is ui/notifications/initialized", () => {
    expect(INITIALIZED_METHOD).toBe("ui/notifications/initialized");
  });

  it("TOOL_RESULT_METHOD is ui/notifications/tool-result", () => {
    expect(TOOL_RESULT_METHOD).toBe("ui/notifications/tool-result");
  });

  it("TOOL_INPUT_METHOD is ui/notifications/tool-input", () => {
    expect(TOOL_INPUT_METHOD).toBe("ui/notifications/tool-input");
  });

  it("TOOL_INPUT_PARTIAL_METHOD is ui/notifications/tool-input-partial", () => {
    expect(TOOL_INPUT_PARTIAL_METHOD).toBe("ui/notifications/tool-input-partial");
  });

  it("TOOL_CANCELLED_METHOD is ui/notifications/tool-cancelled", () => {
    expect(TOOL_CANCELLED_METHOD).toBe("ui/notifications/tool-cancelled");
  });

  it("HOST_CONTEXT_CHANGED_METHOD is ui/notifications/host-context-changed", () => {
    expect(HOST_CONTEXT_CHANGED_METHOD).toBe("ui/notifications/host-context-changed");
  });

  it("MESSAGE_METHOD is ui/message", () => {
    expect(MESSAGE_METHOD).toBe("ui/message");
  });

  it("OPEN_LINK_METHOD is ui/open-link", () => {
    expect(OPEN_LINK_METHOD).toBe("ui/open-link");
  });

  it("SIZE_CHANGED_METHOD is ui/notifications/size-changed", () => {
    expect(SIZE_CHANGED_METHOD).toBe("ui/notifications/size-changed");
  });

  it("RESOURCE_TEARDOWN_METHOD is ui/resource-teardown", () => {
    expect(RESOURCE_TEARDOWN_METHOD).toBe("ui/resource-teardown");
  });
});

// ---------------------------------------------------------------------------
// 2. Event map resolves short names to spec constants
// ---------------------------------------------------------------------------

describe("event map uses spec constants", () => {
  it("tool-result resolves to TOOL_RESULT_METHOD", () => {
    expect(resolveEventMethod("tool-result")).toBe(TOOL_RESULT_METHOD);
  });

  it("tool-input resolves to TOOL_INPUT_METHOD", () => {
    expect(resolveEventMethod("tool-input")).toBe(TOOL_INPUT_METHOD);
  });

  it("tool-cancelled resolves to TOOL_CANCELLED_METHOD", () => {
    expect(resolveEventMethod("tool-cancelled")).toBe(TOOL_CANCELLED_METHOD);
  });

  it("theme-changed resolves to HOST_CONTEXT_CHANGED_METHOD", () => {
    expect(resolveEventMethod("theme-changed")).toBe(HOST_CONTEXT_CHANGED_METHOD);
  });

  it("teardown resolves to RESOURCE_TEARDOWN_METHOD", () => {
    expect(resolveEventMethod("teardown")).toBe(RESOURCE_TEARDOWN_METHOD);
  });
});

// ---------------------------------------------------------------------------
// 3. ui/initialize request has spec-compliant params
// ---------------------------------------------------------------------------

describe("ui/initialize request shape", () => {
  it("sends appInfo (not clientInfo)", async () => {
    app = await connectAndHandshake();

    const initCall = postMessageSpy.mock.calls.find(
      (c: unknown[]) => (c[0] as Record<string, unknown>).method === INITIALIZE_METHOD,
    );
    const params = (initCall![0] as Record<string, unknown>).params as Record<string, unknown>;

    // Spec-required fields
    expect(params).toHaveProperty("appInfo");
    expect(params).toHaveProperty("appCapabilities");
    expect(params).toHaveProperty("protocolVersion");

    // Must NOT have old field names
    expect(params).not.toHaveProperty("clientInfo");
    expect(params).not.toHaveProperty("capabilities");
  });

  it("appInfo contains name and version", async () => {
    app = await connectAndHandshake({ name: "my-widget", version: "2.0.0" });

    const initCall = postMessageSpy.mock.calls.find(
      (c: unknown[]) => (c[0] as Record<string, unknown>).method === INITIALIZE_METHOD,
    );
    const params = (initCall![0] as Record<string, unknown>)
      .params as McpUiInitializeRequest["params"];

    expect(params.appInfo).toEqual({ name: "my-widget", version: "2.0.0" });
  });

  it("uses LATEST_PROTOCOL_VERSION", async () => {
    app = await connectAndHandshake();

    const initCall = postMessageSpy.mock.calls.find(
      (c: unknown[]) => (c[0] as Record<string, unknown>).method === INITIALIZE_METHOD,
    );
    const params = (initCall![0] as Record<string, unknown>)
      .params as McpUiInitializeRequest["params"];

    expect(params.protocolVersion).toBe(LATEST_PROTOCOL_VERSION);
  });
});

// ---------------------------------------------------------------------------
// 4. ui/initialize response parsing uses spec field names
// ---------------------------------------------------------------------------

describe("ui/initialize response parsing", () => {
  it("extracts hostInfo (not serverInfo)", async () => {
    app = await connectAndHandshake(
      undefined,
      makeSpecInitResult({
        hostInfo: { name: "claude-desktop", version: "3.0.0" },
      }),
    );

    expect(app.hostInfo).toEqual({ name: "claude-desktop", version: "3.0.0" });
  });

  it("extracts theme from hostContext.theme string", async () => {
    app = await connectAndHandshake(undefined, makeSpecInitResult());
    expect(app.theme.mode).toBe("dark");
  });

  it("extracts style tokens from hostContext.styles.variables", async () => {
    app = await connectAndHandshake(undefined, makeSpecInitResult());
    expect(app.theme.tokens).toEqual({
      "--color-background-primary": "#0a0a09",
      "--color-text-primary": "#e5e5e5",
    });
  });

  it("extracts toolInfo from hostContext", async () => {
    app = await connectAndHandshake(undefined, makeSpecInitResult());
    expect(app.toolInfo?.tool).toMatchObject({ name: "search" });
  });

  it("extracts containerDimensions from hostContext", async () => {
    app = await connectAndHandshake(undefined, makeSpecInitResult());
    expect(app.containerDimensions).toEqual({ width: 400, maxHeight: 800 });
  });

  it("defaults gracefully when hostContext is missing", async () => {
    app = await connectAndHandshake(undefined, {
      protocolVersion: LATEST_PROTOCOL_VERSION,
      hostInfo: { name: "bare", version: "1.0.0" },
      hostCapabilities: {},
      hostContext: {} as McpUiHostContext,
    });
    expect(app.theme).toEqual({ mode: "light", tokens: {} });
    expect(app.toolInfo).toBeNull();
    expect(app.containerDimensions).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 5. Handshake message ordering per spec
// ---------------------------------------------------------------------------

describe("handshake ordering", () => {
  it("sends size-changed → ui/initialize → initialized (in order)", async () => {
    app = await connectAndHandshake();

    const methods = postMessageSpy.mock.calls
      .map((c: unknown[]) => (c[0] as Record<string, unknown>).method as string)
      .filter(Boolean);

    const sizeIdx = methods.indexOf(SIZE_CHANGED_METHOD);
    const initIdx = methods.indexOf(INITIALIZE_METHOD);
    const initializedIdx = methods.indexOf(INITIALIZED_METHOD);

    expect(sizeIdx).toBeGreaterThanOrEqual(0);
    expect(initIdx).toBeGreaterThan(sizeIdx);
    expect(initializedIdx).toBeGreaterThan(initIdx);
  });

  it("registers on-handlers BEFORE sending initialized", async () => {
    const handler = vi.fn();
    app = await connectAndHandshake({ on: { "tool-result": handler } });

    // initialized is last — verify it was sent
    const initializedCall = postMessageSpy.mock.calls.find(
      (c: unknown[]) => (c[0] as Record<string, unknown>).method === INITIALIZED_METHOD,
    );
    expect(initializedCall).toBeDefined();

    // Now dispatch a tool-result — handler should fire because it was
    // registered before initialized was sent
    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          jsonrpc: "2.0",
          method: TOOL_RESULT_METHOD,
          params: {
            content: [{ type: "text", text: '{"results":[]}' }],
          },
        },
      }),
    );

    expect(handler).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// 6. Outbound message shapes match spec
// ---------------------------------------------------------------------------

describe("outbound message shapes", () => {
  it("openLink sends ui/open-link with { url }", async () => {
    app = await connectAndHandshake();
    app.openLink("https://example.com");

    const call = postMessageSpy.mock.calls.find(
      (c: unknown[]) => (c[0] as Record<string, unknown>).method === OPEN_LINK_METHOD,
    );
    expect(call).toBeDefined();

    const params = (call![0] as Record<string, unknown>).params as McpUiOpenLinkRequest["params"];
    expect(params).toEqual({ url: "https://example.com" });
  });

  it("sendMessage sends ui/message with { role, content }", async () => {
    app = await connectAndHandshake();
    app.sendMessage("hello world");

    const call = postMessageSpy.mock.calls.find(
      (c: unknown[]) => (c[0] as Record<string, unknown>).method === MESSAGE_METHOD,
    );
    expect(call).toBeDefined();

    const params = (call![0] as Record<string, unknown>).params as McpUiMessageRequest["params"];
    expect(params.role).toBe("user");
    expect(params.content).toHaveLength(1);
    expect(params.content[0]).toMatchObject({ type: "text", text: "hello world" });
  });

  it("sendMessage with context puts it in _meta", async () => {
    app = await connectAndHandshake();
    app.sendMessage("test", { action: "search" });

    const call = postMessageSpy.mock.calls.find(
      (c: unknown[]) => (c[0] as Record<string, unknown>).method === MESSAGE_METHOD,
    );
    const params = (call![0] as Record<string, unknown>).params as McpUiMessageRequest["params"];
    const block = params.content[0] as TextContent;
    expect(block._meta).toEqual({ context: { action: "search" } });
  });

  it("updateModelContext sends ui/update-model-context with structuredContent", async () => {
    app = await connectAndHandshake();
    app.updateModelContext({ count: 42 }, "42 items");

    const call = postMessageSpy.mock.calls.find(
      (c: unknown[]) => (c[0] as Record<string, unknown>).method === "ui/update-model-context",
    );
    expect(call).toBeDefined();

    const params = (call![0] as Record<string, unknown>)
      .params as McpUiUpdateModelContextRequest["params"];
    expect(params.structuredContent).toEqual({ count: 42 });
    expect(params.content).toEqual([{ type: "text", text: "42 items" }]);
  });

  it("callTool sends tools/call with { name, arguments }", async () => {
    app = await connectAndHandshake();

    // Start the call (don't await — we need to respond to the request)
    const toolPromise = app.callTool("find_sessions", { query: "keynote" });

    // Find and respond to the tools/call request
    const call = postMessageSpy.mock.calls.find(
      (c: unknown[]) => (c[0] as Record<string, unknown>).method === "tools/call",
    );
    expect(call).toBeDefined();

    const params = (call![0] as Record<string, unknown>).params as CallToolRequest["params"];
    expect(params.name).toBe("find_sessions");
    expect(params.arguments).toEqual({ query: "keynote" });

    // Respond so the promise resolves
    const id = (call![0] as Record<string, unknown>).id;
    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          jsonrpc: "2.0",
          id,
          result: { content: [{ type: "text", text: '{"results":[]}' }] },
        },
      }),
    );

    const result = await toolPromise;
    expect(result.isError).toBe(false);
  });

  it("readServerResource sends resources/read with { uri }", async () => {
    app = await connectAndHandshake();

    // Start the read (don't await — we need to respond to the request)
    const readPromise = app.readServerResource({ uri: "videos://bunny-1mb" });

    // Find and respond to the resources/read request
    const call = postMessageSpy.mock.calls.find(
      (c: unknown[]) => (c[0] as Record<string, unknown>).method === "resources/read",
    );
    expect(call).toBeDefined();

    const params = (call![0] as Record<string, unknown>).params as ReadResourceRequest["params"];
    expect(params.uri).toBe("videos://bunny-1mb");

    // Respond with a spec-shaped ReadResourceResult so the promise resolves
    const id = (call![0] as Record<string, unknown>).id;
    const specResult: ReadResourceResult = {
      contents: [
        {
          uri: "videos://bunny-1mb",
          mimeType: "video/mp4",
          blob: "AAAA",
        },
      ],
    };
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { jsonrpc: "2.0", id, result: specResult },
      }),
    );

    const result = await readPromise;
    expect(result.contents).toHaveLength(1);
    const first = result.contents[0];
    expect(first.uri).toBe("videos://bunny-1mb");
    expect(first.mimeType).toBe("video/mp4");
    expect("blob" in first && first.blob).toBe("AAAA");
  });
});

// ---------------------------------------------------------------------------
// 7. Compile-time type guards (these are no-op at runtime but fail tsc)
// ---------------------------------------------------------------------------

describe("compile-time type assertions", () => {
  it("McpUiInitializeRequest.params has appInfo, not clientInfo", () => {
    // This test exists as a compile-time guard. If someone changes the
    // import or field name, TypeScript will error before tests even run.
    const params: McpUiInitializeRequest["params"] = {
      protocolVersion: LATEST_PROTOCOL_VERSION,
      appInfo: { name: "test", version: "1.0" },
      appCapabilities: {},
    };
    expect(params.appInfo.name).toBe("test");
  });

  it("McpUiInitializeResult has hostInfo, not serverInfo", () => {
    const result: McpUiInitializeResult = {
      protocolVersion: LATEST_PROTOCOL_VERSION,
      hostInfo: { name: "host", version: "1.0" },
      hostCapabilities: {},
      hostContext: {} as McpUiHostContext,
    };
    expect(result.hostInfo.name).toBe("host");
  });

  it("McpUiHostContext.theme is a string, not an object", () => {
    const ctx: McpUiHostContext = {
      theme: "dark",
      styles: { variables: {} },
    };
    expect(ctx.theme).toBe("dark");
  });

  it("McpUiHostContext.styles.variables holds CSS tokens", () => {
    const ctx: McpUiHostContext = {
      theme: "light",
      styles: {
        variables: {
          "--color-background-primary": "#fff",
          "--color-text-primary": "#000",
        },
      },
    };
    expect(ctx.styles?.variables?.["--color-background-primary"]).toBe("#fff");
  });

  it("McpUiMessageRequest.params has role and content array", () => {
    const params: McpUiMessageRequest["params"] = {
      role: "user",
      content: [{ type: "text", text: "hello" }],
    };
    expect(params.role).toBe("user");
    expect(params.content[0]).toMatchObject({ type: "text" });
  });

  it("McpUiToolResultNotification.params is a CallToolResult", () => {
    const params: McpUiToolResultNotification["params"] = {
      content: [{ type: "text", text: '{"data":true}' }],
    };
    expect(Array.isArray(params.content)).toBe(true);
  });

  it("ReadResourceRequest.params has uri", () => {
    const params: ReadResourceRequest["params"] = { uri: "foo://bar" };
    expect(params.uri).toBe("foo://bar");
  });

  it("ReadResourceResult has contents array with text or blob variants", () => {
    const result: ReadResourceResult = {
      contents: [
        { uri: "foo://text", mimeType: "text/plain", text: "hi" },
        { uri: "foo://blob", mimeType: "application/octet-stream", blob: "AAAA" },
      ],
    };
    expect(result.contents).toHaveLength(2);
    const [textItem, blobItem] = result.contents;
    if ("text" in textItem) expect(textItem.text).toBe("hi");
    if ("blob" in blobItem) expect(blobItem.blob).toBe("AAAA");
  });
});

// ---------------------------------------------------------------------------
// 8. MCP 2025-11-25 tasks utility — capability advertisement
// ---------------------------------------------------------------------------

describe("tasks capability advertisement (connect path)", () => {
  // `connect()` returns an `App` with no task-augmented call surface.
  // Per MCP 2025-11-25, requestors MUST NOT advertise capabilities they
  // can't use — doing so creates a false contract with hosts that may
  // allocate state on the strength of the advertisement. Positive
  // capability tests for the `createSynapse` path live in `core.test.ts`.
  it("connect() does NOT advertise appCapabilities.tasks", async () => {
    app = await connectAndHandshake();

    const initCall = postMessageSpy.mock.calls.find(
      (c: unknown[]) => (c[0] as Record<string, unknown>).method === INITIALIZE_METHOD,
    );
    expect(initCall).toBeDefined();

    const params = (initCall![0] as Record<string, unknown>).params as Record<string, unknown>;
    const caps = params.appCapabilities as Record<string, unknown>;

    expect(caps).not.toHaveProperty("tasks");
  });
});

// ---------------------------------------------------------------------------
// 9. _meta passthrough for io.modelcontextprotocol/related-task
// ---------------------------------------------------------------------------

describe("parseToolResult preserves _meta", () => {
  it("preserves _meta['io.modelcontextprotocol/related-task'] on parsed result", () => {
    const taskId = "tsk_01abc123";
    const raw = {
      content: [{ type: "text", text: '{"ok":true}' }],
      _meta: {
        [RELATED_TASK_META_KEY]: { taskId },
      },
    };

    const result = parseToolResult(raw);

    // Meta must be present — this key is how the requestor correlates
    // the response with its originating task per MCP 2025-11-25 §7.
    expect(result._meta).toBeDefined();
    expect(result._meta?.[RELATED_TASK_META_KEY]).toEqual({ taskId });
  });

  it("preserves arbitrary _meta keys (key-preserving passthrough, not selective copy)", () => {
    const raw = {
      content: [{ type: "text", text: '"hello"' }],
      _meta: {
        [RELATED_TASK_META_KEY]: { taskId: "tsk_xyz" },
        "vendor.namespace/custom-key": { foo: "bar" },
        progressToken: "prog-42",
      },
    };

    const result = parseToolResult(raw);

    // All three keys must flow through — spec adds fields post-hoc and
    // selective copying strips future additions silently.
    expect(result._meta?.[RELATED_TASK_META_KEY]).toEqual({ taskId: "tsk_xyz" });
    expect(result._meta?.["vendor.namespace/custom-key"]).toEqual({ foo: "bar" });
    expect(result._meta?.progressToken).toBe("prog-42");
  });

  it("does not add a _meta field when the source has no _meta (backward compat)", () => {
    const raw = {
      content: [{ type: "text", text: '{"id":"tsk_legacy"}' }],
    };

    const result = parseToolResult(raw);

    // Existing consumers iterate over result keys; an injected `_meta:
    // undefined` would be an observable change. Confirm the key is absent.
    expect(result._meta).toBeUndefined();
    expect(Object.hasOwn(result, "_meta")).toBe(false);
  });

  it("preserves _meta on error results (isError: true)", () => {
    const raw = {
      isError: true,
      content: [{ type: "text", text: "boom" }],
      _meta: {
        [RELATED_TASK_META_KEY]: { taskId: "tsk_failed" },
      },
    };

    const result = parseToolResult(raw);

    expect(result.isError).toBe(true);
    expect(result.data).toBe("boom");
    expect(result._meta?.[RELATED_TASK_META_KEY]).toEqual({ taskId: "tsk_failed" });
  });

  it("preserves _meta when content array is empty", () => {
    const raw = {
      content: [] as unknown[],
      _meta: {
        [RELATED_TASK_META_KEY]: { taskId: "tsk_empty" },
      },
    };

    const result = parseToolResult(raw);

    expect(result.data).toBeNull();
    expect(result._meta?.[RELATED_TASK_META_KEY]).toEqual({ taskId: "tsk_empty" });
  });

  it("preserves _meta when no text blocks are present", () => {
    const raw = {
      content: [{ type: "image", data: "AAAA", mimeType: "image/png" }],
      _meta: {
        [RELATED_TASK_META_KEY]: { taskId: "tsk_image" },
      },
    };

    const result = parseToolResult(raw);

    expect(result._meta?.[RELATED_TASK_META_KEY]).toEqual({ taskId: "tsk_image" });
  });

  it("ignores malformed _meta (non-object) without throwing", () => {
    // Defensive: a bridge that forwards a stringly-typed meta should not
    // crash the parser. Spec-compliant meta is always an object.
    const raw = {
      content: [{ type: "text", text: "{}" }],
      _meta: "not-an-object",
    };

    const result = parseToolResult(raw);
    expect(result._meta).toBeUndefined();
  });
});

describe("RELATED_TASK_META_KEY constant matches spec", () => {
  it("is io.modelcontextprotocol/related-task", () => {
    expect(RELATED_TASK_META_KEY).toBe("io.modelcontextprotocol/related-task");
  });
});

// ---------------------------------------------------------------------------
// 10. Task-augmented tools/call wire shape (MCP 2025-11-25 §)
// ---------------------------------------------------------------------------
//
// These tests drive through the `createSynapse` API (where
// `callToolAsTask` lives) rather than `connect()`. They assert the
// ENCODED wire bytes match the spec — this is the layer where silent
// drift is most costly.

describe("task-augmented tools/call wire shape", () => {
  const TOOLS_CALL_METHOD: CallToolRequest["method"] = "tools/call";
  const TASKS_GET_METHOD: GetTaskRequest["method"] = "tasks/get";
  const TASKS_RESULT_METHOD: GetTaskPayloadRequest["method"] = "tasks/result";
  const TASKS_CANCEL_METHOD: CancelTaskRequest["method"] = "tasks/cancel";

  function makeSynapseInitResult(
    hostTasks: TasksCapability = {
      cancel: {},
      requests: { tools: { call: {} } },
    },
  ) {
    return {
      protocolVersion: LATEST_PROTOCOL_VERSION,
      hostInfo: { name: "test-host", version: "1.0.0" },
      hostCapabilities: {
        openLinks: {},
        tasks: hostTasks,
        // biome-ignore lint/suspicious/noExplicitAny: host caps
        // widening — `McpUiHostCapabilities` doesn't yet model tasks.
      } as any,
      hostContext: {
        theme: "dark",
        styles: { variables: {} },
      } as McpUiHostContext,
    };
  }

  async function makeReadySynapse(): Promise<{
    synapse: import("../types.js").Synapse;
    cleanup: () => void;
  }> {
    // Dynamic import keeps this describe block self-contained and
    // avoids top-level coupling with the App-based setup above.
    const { createSynapse } = await import("../core.js");
    const s = createSynapse({ name: "test-app", version: "1.0.0" });
    s.ready.catch(() => {});

    // Answer ui/initialize
    const initCall = postMessageSpy.mock.calls.find(
      (c: unknown[]) => (c[0] as Record<string, unknown>).method === INITIALIZE_METHOD,
    );
    if (!initCall) throw new Error("ui/initialize not sent");
    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          jsonrpc: "2.0",
          id: (initCall[0] as Record<string, unknown>).id,
          result: makeSynapseInitResult(),
        },
      }),
    );
    await s.ready;
    return { synapse: s, cleanup: () => s.destroy() };
  }

  function respondTo(method: string, result: unknown): void {
    const call = postMessageSpy.mock.calls.find(
      (c: unknown[]) => (c[0] as Record<string, unknown>).method === method,
    );
    if (!call) throw new Error(`No pending ${method} request`);
    const id = (call[0] as Record<string, unknown>).id;
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { jsonrpc: "2.0", id, result },
      }),
    );
  }

  it("tools/call with task param has the spec wire shape", async () => {
    const { synapse, cleanup } = await makeReadySynapse();

    const pending = synapse.callToolAsTask("do_research", { query: "mcp" }, { ttl: 60_000 });

    // Find the tools/call message on the wire.
    const call = postMessageSpy.mock.calls.find(
      (c: unknown[]) => (c[0] as Record<string, unknown>).method === TOOLS_CALL_METHOD,
    );
    expect(call).toBeDefined();

    const msg = call![0] as Record<string, unknown>;
    // Request shape: has id, jsonrpc, method, params — no forbidden fields.
    expect(msg.jsonrpc).toBe("2.0");
    expect(msg.method).toBe(TOOLS_CALL_METHOD);
    expect(typeof msg.id).toBe("string");

    const params = msg.params as CallToolRequest["params"];
    // Spec-required fields
    expect(params.name).toBe("do_research");
    expect(params.arguments).toEqual({ query: "mcp" });
    // `task` is the augmentation signal
    expect(params.task).toEqual({ ttl: 60_000 });

    // Respond and clean up
    const createResult: CreateTaskResult = {
      task: {
        taskId: "tsk_spec",
        status: "working" satisfies TaskStatus,
        ttl: 60_000,
        createdAt: "2026-04-22T00:00:00.000Z",
        lastUpdatedAt: "2026-04-22T00:00:00.000Z",
      },
    };
    respondTo(TOOLS_CALL_METHOD, createResult);
    await pending;
    cleanup();
  });

  it("tasks/result response preserves _meta through parseToolResult", async () => {
    const { synapse, cleanup } = await makeReadySynapse();

    const pending = synapse.callToolAsTask("do_thing", {});
    respondTo(TOOLS_CALL_METHOD, {
      task: {
        taskId: "tsk_meta_spec",
        status: "working" satisfies TaskStatus,
        ttl: 60_000,
        createdAt: "2026-04-22T00:00:00.000Z",
        lastUpdatedAt: "2026-04-22T00:00:00.000Z",
      },
    } satisfies CreateTaskResult);
    const handle = await pending;

    const resultPromise = handle.result();

    // Spec §: `tasks/result` response MUST include
    // `_meta["io.modelcontextprotocol/related-task"] = { taskId }`.
    const terminal = {
      content: [{ type: "text", text: '{"ok":true}' }],
      _meta: {
        [RELATED_TASK_META_KEY]: { taskId: "tsk_meta_spec" },
      },
    } satisfies GetTaskPayloadResult;
    respondTo(TASKS_RESULT_METHOD, terminal);

    const result = await resultPromise;
    expect(result._meta).toBeDefined();
    expect(result._meta?.[RELATED_TASK_META_KEY]).toEqual({ taskId: "tsk_meta_spec" });

    cleanup();
  });

  it("lifecycle: start → refresh (working) → result (completed) records spec wire traffic", async () => {
    const { synapse, cleanup } = await makeReadySynapse();

    // 1. Start task
    const pending = synapse.callToolAsTask("do_thing", { q: 1 }, { ttl: 90_000 });
    const startMsg = postMessageSpy.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .find((m) => m.method === TOOLS_CALL_METHOD);
    expect(startMsg).toBeDefined();
    expect((startMsg!.params as CallToolRequest["params"]).task).toEqual({ ttl: 90_000 });

    respondTo(TOOLS_CALL_METHOD, {
      task: {
        taskId: "tsk_lc",
        status: "working" satisfies TaskStatus,
        ttl: 90_000,
        createdAt: "2026-04-22T00:00:00.000Z",
        lastUpdatedAt: "2026-04-22T00:00:00.000Z",
      },
    } satisfies CreateTaskResult);
    const handle = await pending;
    expect(handle.task.status).toBe("working" satisfies TaskStatus);

    // 2. Refresh (still working) — tasks/get with just { taskId }
    const refreshPromise = handle.refresh();
    const getMsg = postMessageSpy.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .find((m) => m.method === TASKS_GET_METHOD);
    expect(getMsg).toBeDefined();
    expect((getMsg!.params as GetTaskRequest["params"]).taskId).toBe("tsk_lc");
    // `taskId` is passed in `params` (NOT via _meta.related-task), per
    // spec § — tasks/{get,list,cancel} and status notifications use
    // `params.taskId` directly.
    expect(getMsg!.params as Record<string, unknown>).not.toHaveProperty("_meta");

    respondTo(TASKS_GET_METHOD, {
      taskId: "tsk_lc",
      status: "working" satisfies TaskStatus,
      ttl: 90_000,
      createdAt: "2026-04-22T00:00:00.000Z",
      lastUpdatedAt: "2026-04-22T00:00:10.000Z",
    } satisfies GetTaskResult);
    const refreshed = await refreshPromise;
    expect(refreshed.status).toBe("working" satisfies TaskStatus);
    expect(refreshed.lastUpdatedAt).toBe("2026-04-22T00:00:10.000Z");

    // 3. Terminal result — tasks/result with { taskId }
    const resultPromise = handle.result();
    const resultMsg = postMessageSpy.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .find((m) => m.method === TASKS_RESULT_METHOD);
    expect(resultMsg).toBeDefined();
    expect((resultMsg!.params as GetTaskPayloadRequest["params"]).taskId).toBe("tsk_lc");

    respondTo(TASKS_RESULT_METHOD, {
      content: [{ type: "text", text: '{"done":true}' }],
      _meta: { [RELATED_TASK_META_KEY]: { taskId: "tsk_lc" } },
    } satisfies GetTaskPayloadResult);

    const finalResult = await resultPromise;
    expect(finalResult.data).toEqual({ done: true });
    expect(finalResult._meta?.[RELATED_TASK_META_KEY]).toEqual({ taskId: "tsk_lc" });

    cleanup();
  });

  it("tasks/cancel wire shape: params.taskId only, no _meta related-task", async () => {
    const { synapse, cleanup } = await makeReadySynapse();

    const pending = synapse.callToolAsTask("do_thing", {});
    respondTo(TOOLS_CALL_METHOD, {
      task: {
        taskId: "tsk_cancel",
        status: "working" satisfies TaskStatus,
        ttl: 60_000,
        createdAt: "2026-04-22T00:00:00.000Z",
        lastUpdatedAt: "2026-04-22T00:00:00.000Z",
      },
    } satisfies CreateTaskResult);
    const handle = await pending;

    const cancelPromise = handle.cancel();

    const cancelMsg = postMessageSpy.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .find((m) => m.method === TASKS_CANCEL_METHOD);
    expect(cancelMsg).toBeDefined();
    const cancelParams = cancelMsg!.params as CancelTaskRequest["params"];
    expect(cancelParams.taskId).toBe("tsk_cancel");
    // Spec § exempts tasks/{get,list,cancel} from the related-task
    // _meta requirement; enforce by absence.
    expect(cancelMsg!.params as Record<string, unknown>).not.toHaveProperty("_meta");

    respondTo(TASKS_CANCEL_METHOD, {
      taskId: "tsk_cancel",
      status: "cancelled" satisfies TaskStatus,
      ttl: 60_000,
      createdAt: "2026-04-22T00:00:00.000Z",
      lastUpdatedAt: "2026-04-22T00:00:05.000Z",
    });
    const finalTask = await cancelPromise;
    expect(finalTask.status).toBe("cancelled" satisfies TaskStatus);

    cleanup();
  });
});

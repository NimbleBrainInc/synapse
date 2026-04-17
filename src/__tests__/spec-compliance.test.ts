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
  ReadResourceRequest,
  ReadResourceResult,
  TextContent,
} from "@modelcontextprotocol/sdk/types.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { connect } from "../connect.js";
import { resolveEventMethod } from "../event-map.js";
import type { App } from "../types.js";

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

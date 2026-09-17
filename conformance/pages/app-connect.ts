/**
 * The `connect()` client as an app, exercising every behaviour the React path
 * relies on. Imports the repo's source, so a change to it is under test here
 * without a release.
 *
 * Every call records `{ ok, value }` or `{ ok: false, error }` at
 * `window.__results.<key>`; the runner asserts against those keys, so a name
 * here is part of the suite's contract.
 */
import { connect } from "../../src/connect.js";
import { downloadFile } from "../../src/download-file.js";
import { pickFile } from "../../src/extensions.js";
import { internalsFor } from "../../src/internals.js";
import { callToolAsTask, TASKS_GET_METHOD, TASKS_RESULT_METHOD } from "../../src/task-handle.js";

const results: Record<string, unknown> = {};
(window as unknown as { __results: unknown }).__results = results;

async function step(key: string, fn: () => Promise<unknown> | unknown): Promise<void> {
  try {
    results[key] = { ok: true, value: await fn() };
  } catch (e) {
    results[key] = { ok: false, error: String(e) };
  }
}

// Give the body real content, so the size the app measures is not zero.
document.body.innerHTML = '<div style="height:120px">conformance</div>';

let app: Awaited<ReturnType<typeof connect>> | undefined;

await step("connect", async () => {
  app = await connect({
    name: "conformance-app",
    version: "1.0.0",
    autoResize: true,
    // Pre-registered, so the result the host sends the instant `initialized`
    // arrives is not lost. This is the one handler that cannot be attached
    // after `connect()` resolves.
    on: {
      "tool-result": (d: { content: unknown }) => {
        results.toolResult = d.content;
      },
    },
  });
  return "connected";
});

if (app) {
  const connected = app;
  connected.on("host-context-changed", (ctx) => {
    results.hostContextChanged = ctx;
  });
  // A vendor notification the spec does not model, subscribed by wire method,
  // because the SDK gives it no typed view.
  connected.on("vendor.example/notice", (params) => {
    results.vendorNotice = params;
  });
  connected.on("notifications/resources/list_changed", () => {
    results.resourcesListChanged = true;
  });

  results.hostInfo = connected.hostInfo;
  results.hostContextAtConnect = connected.hostContext;
  results.themeAtConnect = connected.theme.mode;
  results.supportsTasks = connected.supportsTasks;

  await step("callTool", () => connected.callTool("echo", { a: 1 }));
  await step("readServerResource", () => connected.readServerResource({ uri: "x://a" }));
  await step("sendMessage", () => connected.sendMessage("hi", { action: "a" }));
  await step("openLink", () => connected.openLink("https://example.com"));
  await step("updateModelContext", () => connected.updateModelContext({ a: 1 }));
  await step("downloadFile", () => downloadFile(connected, "a.txt", "abc", "text/plain"));
  // Every byte value a naive text encoding would mangle, so the row can prove
  // the base64 path round-trips rather than merely that something arrived.
  await step("downloadFileBlob", () =>
    downloadFile(connected, "b.bin", new Blob([new Uint8Array([0, 1, 127, 128, 254, 255])])),
  );
  // A NimbleBrain host extension request, app → host, answered by the host's
  // fallback handler.
  await step("requestFile", () => pickFile(connected));
  // The tasks utility has no ext-apps typed surface, so its methods ride the
  // generic request path. Driving them directly is what proves that path
  // carries a method the spec's host has never heard of.
  const internals = internalsFor(connected);
  await step("tasksGet", () => internals.request(TASKS_GET_METHOD, { taskId: "task-1" }));
  await step("tasksResult", () => internals.request(TASKS_RESULT_METHOD, { taskId: "task-1" }));

  // A task-*augmented* `tools/call` is a different thing: it puts `task` in
  // `params`, which the MCP SDK's `Protocol` recognises, and the spec's
  // `AppBridge` refuses outright. Recorded rather than asserted as parity,
  // because what it pins is the spec host's boundary, not our bug.
  await step("callToolAsTask", () => callToolAsTask(connected, "slow", {}));
}

results.finished = true;

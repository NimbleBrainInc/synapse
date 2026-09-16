/**
 * NimbleBrain host extensions — composable functions over {@link App}.
 *
 * These are not ext-apps spec surface. They ride the `synapse/` method prefix,
 * which `McpUiHostContext`'s open index signature makes legal, and only a
 * NimbleBrain host implements them. They live here rather than on the `App`
 * object so the object stays the spec surface plus the handshake state, and
 * so an app that never picks a file never pulls this code in.
 *
 * Every one of them is gated on the host identity established by the
 * handshake: off a NimbleBrain host, the fire-and-forget ones are no-ops and
 * the ones with a return value throw, because a picker that silently resolves
 * `null` forever is worse than one that says it isn't there.
 */
import { ACTION_METHOD, REQUEST_FILE_METHOD } from "./event-map.js";
import { internalsFor } from "./internals.js";
import type { App, FileResult, RequestFileOptions } from "./types.js";

/** 25 MB — the host's default cap on a single picked file. */
const DEFAULT_MAX_FILE_SIZE = 26_214_400;

/**
 * Trigger a host-side action.
 *
 * Sends a command *to* the host (navigate, open a panel). No-op off a
 * NimbleBrain host.
 */
export function action(app: App, name: string, params?: Record<string, unknown>): void {
  if (!app.isNimbleBrainHost) return;
  internalsFor(app).send(ACTION_METHOD, { action: name, ...params });
}

/**
 * Request one file from the user via the host's native file picker.
 *
 * Resolves `null` if the user cancels. Throws off a NimbleBrain host.
 */
export async function pickFile(app: App, options?: RequestFileOptions): Promise<FileResult | null> {
  if (!app.isNimbleBrainHost) {
    throw new Error("pickFile is not supported in this host");
  }
  const files = await requestFile(app, options, false);
  // One pick, so the first entry is the answer; an empty list is a cancel.
  return files[0] ?? null;
}

/**
 * Request several files from the user.
 *
 * Resolves `[]` if the user cancels. Throws off a NimbleBrain host.
 */
export async function pickFiles(app: App, options?: RequestFileOptions): Promise<FileResult[]> {
  if (!app.isNimbleBrainHost) {
    throw new Error("pickFiles is not supported in this host");
  }
  return await requestFile(app, options, true);
}

/**
 * Shared request path for `pickFile` / `pickFiles`.
 *
 * The host answers with `{ files }` — an empty array when the user cancelled.
 * A JSON-RPC result is an object by definition, and MCP types it as one, so the
 * files travel under a field rather than as a bare array or a bare `null`: a
 * spec client refuses to parse anything else, and the call would hang rather
 * than resolve.
 *
 * Entries are shape-checked here. The type promises a string `id`, and without
 * the guard a consumer reads `undefined.id` three frames later, where nothing
 * says which side is mismatched.
 */
async function requestFile(
  app: App,
  options: RequestFileOptions | undefined,
  multiple: boolean,
): Promise<FileResult[]> {
  const result = await internalsFor(app).request(REQUEST_FILE_METHOD, {
    accept: options?.accept,
    maxSize: options?.maxSize ?? DEFAULT_MAX_FILE_SIZE,
    multiple,
  });
  const files = (result as { files?: unknown } | null | undefined)?.files;
  if (files === undefined) {
    throw new Error(
      "synapse/request-file returned no `files`. The host is older than this " +
        "SDK targets: it answers the picker with a bare array or `null`, which " +
        "a spec-compliant client cannot parse.",
    );
  }
  if (!Array.isArray(files)) {
    throw new Error("synapse/request-file returned a `files` field that is not an array.");
  }
  return files.map(validateFileResult);
}

function validateFileResult(value: unknown): FileResult {
  if (
    typeof value !== "object" ||
    value === null ||
    typeof (value as { id?: unknown }).id !== "string"
  ) {
    throw new Error(
      "synapse/request-file returned a result without a string `id`. " +
        "The host appears to be on a version older than this SDK targets — " +
        "@nimblebrain/synapse 0.8.0+ requires a host with POST /v1/resources " +
        "(NimbleBrain ≥ the version that ships PR #93).",
    );
  }
  return value as FileResult;
}

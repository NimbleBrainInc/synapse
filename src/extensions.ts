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
import { ACTION_METHOD, DOWNLOAD_FILE_METHOD, REQUEST_FILE_METHOD } from "./event-map.js";
import { internalsFor } from "./internals.js";
import type { App, FileResult, RequestFileOptions } from "./types.js";

/** 25 MB — the host's default cap on a single picked file. */
const DEFAULT_MAX_FILE_SIZE = 26_214_400;

/**
 * Trigger a host-side action.
 *
 * The inverse direction of the `action` event: this sends a command *to* the
 * host (navigate, open a panel), where `app.on("action", …)` receives the ones
 * a tool emits. No-op off a NimbleBrain host.
 */
export function action(app: App, name: string, params?: Record<string, unknown>): void {
  if (!app.isNimbleBrainHost) return;
  // The outbound frame reuses the inbound method name; the host distinguishes
  // direction, not method.
  internalsFor(app).send(ACTION_METHOD, { action: name, ...params });
}

/**
 * Hand the user a file to save.
 *
 * Precedence for the MIME type: the explicit argument, then the Blob's own
 * type, then `application/octet-stream`. An empty-string argument falls
 * through — a `""` MIME is effectively "no type".
 */
export function downloadFile(
  app: App,
  filename: string,
  content: string | Blob,
  mimeType?: string,
): void {
  const resolvedMime =
    mimeType || (content instanceof Blob ? content.type : "") || "application/octet-stream";
  const blob = content instanceof Blob ? content : new Blob([content], { type: resolvedMime });
  internalsFor(app).send(DOWNLOAD_FILE_METHOD, {
    data: blob,
    filename,
    mimeType: resolvedMime,
  });
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
  const result = await requestFile(app, options, false);
  if (result === null) return null;
  // The host may return an array even for a single pick — take the first
  // entry to preserve the documented `FileResult | null` shape.
  return Array.isArray(result) ? (result[0] ?? null) : result;
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
  const result = await requestFile(app, options, true);
  if (result === null) return [];
  return Array.isArray(result) ? result : [result];
}

/**
 * Shared request path for `pickFile` / `pickFiles`. Centralizes:
 *
 * - The wire method name (which is what the NimbleBrain bridge actually
 *   handles — earlier SDK versions sent `synapse/pick-file` and the call would
 *   silently time out).
 * - Runtime shape validation. Older hosts (pre-`POST /v1/resources`) still
 *   respond but return the legacy `{ base64Data, … }` shape. The TS type
 *   promises a string `id`; without this guard, consumers would silently get
 *   `undefined.id` and fail downstream in confusing ways. Failing loud at the
 *   boundary tells the developer exactly which side is mismatched.
 */
async function requestFile(
  app: App,
  options: RequestFileOptions | undefined,
  multiple: boolean,
): Promise<FileResult | FileResult[] | null> {
  const result = await internalsFor(app).request(REQUEST_FILE_METHOD, {
    accept: options?.accept,
    maxSize: options?.maxSize ?? DEFAULT_MAX_FILE_SIZE,
    multiple,
  });
  if (result == null) return null;
  if (Array.isArray(result)) {
    return result.map(validateFileResult);
  }
  return validateFileResult(result);
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

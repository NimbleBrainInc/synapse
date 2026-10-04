/**
 * NimbleBrain host extensions — composable functions over {@link App}.
 *
 * These are not ext-apps spec surface. They are the NimbleBrain host's own
 * `ai.nimblebrain/*` methods, which this package implements a client for, and
 * `NIMBLEBRAIN_EXTENSIONS` in `event-map.ts` is the complete list. They
 * live here rather than on the `App` object so the object stays the spec
 * surface plus the handshake state, and so an app that never picks a file
 * never pulls this code in.
 *
 * Every one of them is gated on the host declaring it in `ui/initialize`: where
 * it is not declared, the fire-and-forget ones are no-ops and the ones with a
 * return value throw `HostCapabilityError`, because a picker that silently
 * resolves `null` forever is worse than one that says it isn't there.
 * `keydown` has no function here; `connect({ forwardKeys })` applies the same
 * gate.
 */
import { HostCapabilityError } from "./errors.js";
import { NAVIGATE_METHOD, NIMBLEBRAIN_EXTENSIONS, type NimbleBrainExtension } from "./event-map.js";
import { internalsFor } from "./internals.js";
import type {
  App,
  FileResult,
  RequestFileOptions,
  TrailEntry,
  UploadFilesOptions,
} from "./types.js";

/**
 * Whether the host declared a NimbleBrain extension. Use it to decide what to
 * offer, e.g. to hide an upload button on a host with no file picker.
 */
export function hostSupports(app: App, extension: NimbleBrainExtension): boolean {
  const { capability } = NIMBLEBRAIN_EXTENSIONS[extension];
  return app.hostCapabilities.experimental?.[capability] !== undefined;
}

/** 25 MB — the host's default cap on a single picked file. */
const DEFAULT_MAX_FILE_SIZE = 26_214_400;

/**
 * Trigger a host-side action.
 *
 * Sends a command *to* the host. The NimbleBrain host serves `openApp`
 * (`{ name }`) and `openConversation` (`{ id }`) and ignores any other name. A
 * message into the conversation is `sendMessage`, and an external page is
 * `openLink`. A no-op when the host did not declare `ai.nimblebrain/action`.
 */
export function action(app: App, name: string, params?: Record<string, unknown>): void {
  if (!hostSupports(app, "action")) return;
  internalsFor(app).send(NIMBLEBRAIN_EXTENSIONS.action.method, { action: name, ...params });
}

/** The most a host accepts: a longer trail or label drops the whole message. */
const MAX_TRAIL_ENTRIES = 32;
const MAX_LABEL_LENGTH = 200;
/** Sent for an empty label (a record still loading, a blank name): the host refuses "". */
const EMPTY_LABEL = "…";

/**
 * Tell the host where the app is: the whole trail, root first, the current view
 * last. The NimbleBrain host shows the last label as the page title and the
 * levels above it as a breadcrumb, and sends `ai.nimblebrain/navigate` (see
 * {@link onNavigate}) when the user picks one.
 *
 * Send it when a view first renders and on every navigation inside the app.
 * Each one replaces the last, so the app stays the only owner of its location
 * and a lost message corrects itself on the next.
 *
 * A host that declares `ai.nimblebrain/location` shows the title, so drop the
 * view's own title and breadcrumb there and keep them elsewhere
 * (`hostSupports(app, "location")`). A no-op where it is not declared, and for
 * an empty trail. Labels and depth are held to the host's bounds (32 levels,
 * keeping the root and the deepest; 1 to 200 characters a label, an empty one
 * sent as "…") rather than sent and dropped whole, which would leave the host
 * showing the previous view. An `id` is sent as given, since a shortened one
 * would no longer navigate: keep it to 512 characters.
 */
export function setLocation(app: App, trail: readonly TrailEntry[]): void {
  if (!hostSupports(app, "location") || trail.length === 0) return;
  const bounded =
    trail.length > MAX_TRAIL_ENTRIES
      ? [trail[0], ...trail.slice(trail.length - (MAX_TRAIL_ENTRIES - 1))]
      : trail;
  internalsFor(app).send(NIMBLEBRAIN_EXTENSIONS.location.method, {
    trail: bounded.map(({ id, label }) => ({
      id,
      label: label.slice(0, MAX_LABEL_LENGTH) || EMPTY_LABEL,
    })),
  });
}

/**
 * Run `handler` with a trail entry's `id` when the host asks the app to go
 * there (`ai.nimblebrain/navigate`). Navigate, then send the new trail with
 * {@link setLocation}. Returns the unsubscribe.
 */
export function onNavigate(app: App, handler: (id: string) => void): () => void {
  return app.on(NAVIGATE_METHOD, (params: { id?: unknown } | undefined) => {
    if (typeof params?.id === "string") handler(params.id);
  });
}

/**
 * Request one file from the user via the host's native file picker.
 *
 * Resolves `null` if the user cancels. Rejects with `HostCapabilityError` when
 * the host did not declare `ai.nimblebrain/request-file`.
 */
export async function pickFile(app: App, options?: RequestFileOptions): Promise<FileResult | null> {
  requireRequestFile("pickFile", app);
  const files = await requestFile(app, options, false);
  // One pick, so the first entry is the answer; an empty list is a cancel.
  return files[0] ?? null;
}

/**
 * Request several files from the user.
 *
 * Resolves `[]` if the user cancels. Rejects with `HostCapabilityError` when
 * the host did not declare `ai.nimblebrain/request-file`.
 */
export async function pickFiles(app: App, options?: RequestFileOptions): Promise<FileResult[]> {
  requireRequestFile("pickFiles", app);
  return await requestFile(app, options, true);
}

/**
 * Store files the app already holds, such as files dropped on it, the way a
 * pick stores them: the host uploads each one to the workspace and answers the
 * stored entries, under the same limits and with the same refusal (a rejection
 * whose `data` is `{ files, errors }`, the files stored despite it and why each
 * other was refused).
 *
 * Each file is read here, in the app's frame, and a copy holding its bytes
 * crosses to the host (`postMessage` clones it), never base64 in a tool call:
 * a dropped file read only by the host fails, since only this frame may read it. Resolves `[]` for an empty list without asking the
 * host. Rejects with `HostCapabilityError` when the host did not declare
 * `ai.nimblebrain/upload-files`; `hostSupports(app, "uploadFiles")` says so up
 * front, to decide whether to offer a drop target at all.
 */
export async function uploadFiles(
  app: App,
  files: readonly File[],
  options?: UploadFilesOptions,
): Promise<FileResult[]> {
  if (!hostSupports(app, "uploadFiles")) {
    throw new HostCapabilityError("uploadFiles", NIMBLEBRAIN_EXTENSIONS.uploadFiles.capability);
  }
  if (files.length === 0) return [];
  const maxSize = options?.maxSize ?? DEFAULT_MAX_FILE_SIZE;
  const held = await Promise.all(files.map((file) => holdInMemory(file, maxSize)));
  const result = await internalsFor(app).request(NIMBLEBRAIN_EXTENSIONS.uploadFiles.method, {
    files: held,
    maxSize,
  });
  return readFiles(result, NIMBLEBRAIN_EXTENSIONS.uploadFiles.method);
}

/**
 * A copy of `file` whose bytes live in memory, read here in the app's frame.
 *
 * A file dropped on the app, or chosen from an input in it, is a reference to
 * a file on disk that only the frame it was given to may read. Cloned to the
 * host, it keeps the reference and loses the right, so the host's upload fails
 * with "Failed to fetch". A copy read here carries its bytes. A file over
 * `maxSize` goes as it is: the host refuses it on its size alone, without
 * reading it, so it is never loaded just to be turned away.
 */
async function holdInMemory(file: File, maxSize: number): Promise<File> {
  if (file.size > maxSize) return file;
  let bytes: ArrayBuffer;
  try {
    bytes = await file.arrayBuffer();
  } catch {
    throw new Error(
      `Couldn't read "${file.name}". A folder, or a file that was moved or deleted, can't be uploaded.`,
    );
  }
  return new File([bytes], file.name, { type: file.type, lastModified: file.lastModified });
}

function requireRequestFile(feature: string, app: App): void {
  if (!hostSupports(app, "requestFile")) {
    throw new HostCapabilityError(feature, NIMBLEBRAIN_EXTENSIONS.requestFile.capability);
  }
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
  const result = await internalsFor(app).request(NIMBLEBRAIN_EXTENSIONS.requestFile.method, {
    accept: options?.accept,
    maxSize: options?.maxSize ?? DEFAULT_MAX_FILE_SIZE,
    multiple,
  });
  return readFiles(result, NIMBLEBRAIN_EXTENSIONS.requestFile.method);
}

/** The `{ files }` a picker or an upload answers, each entry shape-checked. */
function readFiles(result: unknown, method: string): FileResult[] {
  const files = (result as { files?: unknown } | null | undefined)?.files;
  if (files === undefined) {
    // Only the picker had hosts that answered a bare array or `null`.
    const why =
      method === NIMBLEBRAIN_EXTENSIONS.requestFile.method
        ? " The host is older than this SDK targets: it answers the picker with a " +
          "bare array or `null`, which a spec-compliant client cannot parse."
        : "";
    throw new Error(`${method} returned no \`files\`.${why}`);
  }
  if (!Array.isArray(files)) {
    throw new Error(`${method} returned a \`files\` field that is not an array.`);
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
      "ai.nimblebrain/request-file returned a result without a string `id`. " +
        "The host appears to be on a version older than this SDK targets — " +
        "@nimblebrain/synapse 0.8.0+ requires a host with POST /v1/resources " +
        "(NimbleBrain ≥ the version that ships PR #93).",
    );
  }
  return value as FileResult;
}

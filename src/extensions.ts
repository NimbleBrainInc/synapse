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
import type { App, FileResult, RequestFileOptions, TrailEntry } from "./types.js";

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
 * an empty trail. The trail is held to the host's bounds (32 levels, keeping
 * the root and the deepest; 200 characters a label) rather than sent and
 * dropped whole.
 */
export function setLocation(app: App, trail: readonly TrailEntry[]): void {
  if (!hostSupports(app, "location") || trail.length === 0) return;
  const bounded =
    trail.length > MAX_TRAIL_ENTRIES
      ? [trail[0], ...trail.slice(trail.length - (MAX_TRAIL_ENTRIES - 1))]
      : trail;
  internalsFor(app).send(NIMBLEBRAIN_EXTENSIONS.location.method, {
    trail: bounded.map(({ id, label }) => ({ id, label: label.slice(0, MAX_LABEL_LENGTH) })),
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
  const files = (result as { files?: unknown } | null | undefined)?.files;
  if (files === undefined) {
    throw new Error(
      "ai.nimblebrain/request-file returned no `files`. The host is older than this " +
        "SDK targets: it answers the picker with a bare array or `null`, which " +
        "a spec-compliant client cannot parse.",
    );
  }
  if (!Array.isArray(files)) {
    throw new Error("ai.nimblebrain/request-file returned a `files` field that is not an array.");
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

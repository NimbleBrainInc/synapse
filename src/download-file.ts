/**
 * Hand the user a file to save, over the ext-apps `ui/download-file` request.
 *
 * A function over {@link App} rather than a method on it, like the helpers in
 * `extensions.ts` — but unlike them this is spec surface, so it is not gated on
 * the host identity. Any host that advertises `downloadFile` can answer it.
 *
 * The bytes always travel embedded. The spec also allows a `ResourceLink`, which
 * asks the host to fetch a URI the app names; a host holding the user's session
 * has every reason to refuse that, and the NimbleBrain host does.
 */
import {
  DOWNLOAD_FILE_METHOD,
  type McpUiDownloadFileRequest,
  type McpUiDownloadFileResult,
} from "@modelcontextprotocol/ext-apps";
import type { EmbeddedResource } from "@modelcontextprotocol/sdk/types.js";
import { HostCapabilityError } from "./errors.js";
import { internalsFor } from "./internals.js";
import type { App } from "./types.js";

/** Bytes per `String.fromCharCode` spread — well under any engine's argument limit. */
const BASE64_CHUNK = 0x8000;

/**
 * Hand the user a file to save.
 *
 * A string is sent as the resource's `text`; a `Blob` is read and sent as
 * base64 `blob`. Reading a `Blob` is asynchronous, which is why this returns a
 * promise.
 *
 * Precedence for the MIME type: the explicit argument, then the Blob's own
 * type, then `application/octet-stream`. An empty-string argument falls
 * through — a `""` MIME is effectively "no type".
 *
 * The filename is the last segment of the resource's `file:///` URI, because an
 * embedded resource has no name field of its own.
 *
 * Resolves with the host's result: `{ isError: true }` when the host declined
 * or the user cancelled. Rejects with `HostCapabilityError`, without sending,
 * when the host did not declare `downloadFile` — a host that does not implement
 * the request may never answer it, and a request has no deadline.
 */
export async function downloadFile(
  app: App,
  filename: string,
  content: string | Blob,
  mimeType?: string,
): Promise<McpUiDownloadFileResult> {
  if (!app.hostCapabilities.downloadFile) {
    throw new HostCapabilityError("downloadFile", "downloadFile");
  }
  const internals = internalsFor(app);
  const resolvedMime =
    mimeType || (content instanceof Blob ? content.type : "") || "application/octet-stream";
  const uri = `file:///${filename}`;
  const resource: EmbeddedResource["resource"] =
    typeof content === "string"
      ? { uri, mimeType: resolvedMime, text: content }
      : { uri, mimeType: resolvedMime, blob: await toBase64(content) };
  const params: McpUiDownloadFileRequest["params"] = {
    contents: [{ type: "resource", resource }],
  };
  return (await internals.request(
    DOWNLOAD_FILE_METHOD,
    params as unknown as Record<string, unknown>,
  )) as McpUiDownloadFileResult;
}

async function toBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + BASE64_CHUNK));
  }
  return btoa(binary);
}

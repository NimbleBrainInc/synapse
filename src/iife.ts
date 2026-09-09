/**
 * IIFE entry point — exposes the SDK on `window.Synapse` for script-tag usage
 * from an MCP server's widget HTML.
 *
 * Usage: `Synapse.connect({ name: "widget", version: "1.0.0" }).then(app => …)`
 *
 * The global keeps the `Synapse` name: it is the package namespace that every
 * embedded `ui://` resource already references, not the removed legacy class.
 */

import { connect } from "./connect.js";
import { action, downloadFile, pickFile, pickFiles } from "./extensions.js";
import { connectUI } from "./host/connect.js";
import { callToolAsTask } from "./task-handle.js";

(window as any).Synapse = {
  connect,
  connectUI,
  callToolAsTask,
  action,
  downloadFile,
  pickFile,
  pickFiles,
};

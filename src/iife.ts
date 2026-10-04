/**
 * IIFE entry point — exposes the SDK on `window.Synapse` for script-tag usage
 * from an MCP server's widget HTML.
 *
 * Usage: `Synapse.connect({ name: "widget", version: "1.0.0" }).then(app => …)`
 */

import { connect } from "./connect.js";
import { downloadFile } from "./download-file.js";
import { HostCapabilityError, TaskError } from "./errors.js";
import {
  action,
  hostSupports,
  notify,
  onNavigate,
  pickFile,
  pickFiles,
  setLocation,
  uploadFiles,
} from "./extensions.js";
import { connectUI } from "./host/connect.js";
import { callToolAsTask } from "./task-handle.js";

(window as any).Synapse = {
  connect,
  connectUI,
  callToolAsTask,
  action,
  downloadFile,
  hostSupports,
  notify,
  pickFile,
  pickFiles,
  setLocation,
  onNavigate,
  uploadFiles,
  HostCapabilityError,
  TaskError,
};

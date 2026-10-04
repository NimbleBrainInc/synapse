export type {
  ReadResourceRequest,
  ReadResourceResult,
} from "@modelcontextprotocol/client";
export { connect } from "./connect.js";
// ext-apps `ui/download-file`, composable over `App`.
export { downloadFile } from "./download-file.js";
export { HostCapabilityError, TaskError } from "./errors.js";
export { NIMBLEBRAIN_EXTENSIONS, type NimbleBrainExtension } from "./event-map.js";
// NimbleBrain host extensions — composable over `App`, each a no-op or a
// `HostCapabilityError` where the host did not declare it. Not ext-apps spec.
export {
  action,
  hostSupports,
  notify,
  onNavigate,
  pickFile,
  pickFiles,
  setLocation,
  uploadFiles,
} from "./extensions.js";
// Cross-host UI client (push-first; any MCP Apps host, or standalone). A
// different axis from `connect()`, and unaffected by it.
export { connectUI } from "./host/connect.js";
export { detectHostKind } from "./host/detect.js";
export {
  type ConnectUIOptions,
  type HostCapabilities,
  type HostKind,
  HostUnsupportedError,
  SYNAPSE_DATA_ELEMENT_ID,
  type SynapseUIClient,
  type SynapseUITheme,
  ToolCallError,
} from "./host/types.js";
// The MCP tasks extension (`io.modelcontextprotocol/tasks`), composable over `App`.
export { callToolAsTask } from "./task-handle.js";
export type {
  App,
  AppEventName,
  ConnectOptions,
  Dimensions,
  FileResult,
  KeyForwardConfig,
  McpUiHostContext,
  ModelContext,
  Notice,
  NoticeLevel,
  RequestFileOptions,
  Task,
  TaskHandle,
  TaskResultOptions,
  TaskStatus,
  TasksCapability,
  Theme,
  ToolCallResult,
  ToolDefinition,
  ToolResultData,
  TrailEntry,
  UploadFilesOptions,
} from "./types.js";

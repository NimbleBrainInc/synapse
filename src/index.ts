export type {
  ReadResourceRequest,
  ReadResourceResult,
} from "@modelcontextprotocol/sdk/types.js";
export { connect } from "./connect.js";
export { FONT_FACES_CONTEXT_KEY } from "./detection.js";
// NimbleBrain host extensions — composable over `App`, no-ops or throws off a
// NimbleBrain host. Not ext-apps spec surface.
export { action, downloadFile, pickFile, pickFiles } from "./extensions.js";
// Cross-host UI client (push-first; ChatGPT / Claude / standalone). A
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
} from "./host/types.js";
// MCP 2025-11-25 tasks utility, composable over `App`.
export { callToolAsTask } from "./task-handle.js";
export type {
  AgentAction,
  App,
  AppEventName,
  BuiltinActionType,
  CallToolAsTaskOptions,
  CallToolOptions,
  ConnectOptions,
  CreateTaskResult,
  DataChangedEvent,
  Dimensions,
  FileResult,
  FontDisplayValue,
  FontFaceDescriptor,
  HostInfo,
  KeyForwardConfig,
  McpUiHostContext,
  ModelContext,
  NavigatePayload,
  NotifyPayload,
  RequestFileOptions,
  Task,
  TaskHandle,
  TaskStatus,
  TasksCapability,
  Theme,
  ToolCallResult,
  ToolDefinition,
  ToolResultData,
} from "./types.js";

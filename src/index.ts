export type {
  ReadResourceRequest,
  ReadResourceResult,
} from "@modelcontextprotocol/sdk/types.js";
export { connect } from "./connect.js";
export { createSynapse } from "./core.js";
export { FONT_FACES_CONTEXT_KEY } from "./detection.js";
// Cross-host UI client (push-first; ChatGPT / Claude / standalone). Additive —
// the ext-apps `connect`/`createSynapse` paths above are unchanged.
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
export { createStore } from "./store.js";
export type {
  ActionReducer,
  AgentAction,
  App,
  AppEventName,
  BuiltinActionType,
  CallToolAsTaskOptions,
  ConnectOptions,
  CreateTaskResult,
  DataChangedEvent,
  Dimensions,
  FileResult,
  FontFaceDescriptor,
  HostInfo,
  KeyForwardConfig,
  NavigatePayload,
  NotifyPayload,
  RequestFileOptions,
  StateAcknowledgement,
  Store,
  StoreConfig,
  StoreDispatch,
  Synapse,
  SynapseOptions,
  SynapseTheme,
  Task,
  TaskHandle,
  TaskStatus,
  TasksCapability,
  Theme,
  ToolCallResult,
  ToolDefinition,
  ToolResultData,
  VisibleState,
} from "./types.js";

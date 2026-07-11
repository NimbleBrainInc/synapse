export type { AppProviderProps } from "./app-provider.js";
// Connect API
export {
  AppProvider,
  useApp,
  useConnectTheme,
  useResize,
  useToolInput,
  useToolResult,
} from "./connect-hooks.js";
export type { UseCallToolAsTaskResult } from "./hooks.js";
export {
  SynapseProvider,
  useAction,
  useAgentAction,
  useCallTool,
  useCallToolAsTask,
  useChat,
  useDataSync,
  useFileUpload,
  useHostContext,
  useStore,
  useSynapse,
  useTheme,
  useVisibleState,
} from "./hooks.js";
export type { SynapseProviderProps } from "./provider.js";
// Cross-host UI client hooks (push-first). Pass a `connectUI()` client instance.
export { useData, useUITheme } from "./ui-client-hooks.js";

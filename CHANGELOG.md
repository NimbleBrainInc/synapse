# Changelog

All notable changes to this project will be documented in this file.

This project adheres to [Semantic Versioning](https://semver.org/).

## [0.7.0] - 2026-04-24

Adds the iframe-side surface of the MCP 2025-11-25 tasks utility so widgets can fire long-running tools without blocking on the request. Existing `callTool` consumers are unaffected.

### Added

- `synapse.callToolAsTask(name, args?, options?)` — issues a task-augmented `tools/call`, returns a `TaskHandle` populated from `CreateTaskResult` immediately. The handle exposes `result()` (blocks via `tasks/result` until terminal), `refresh()` (non-blocking `tasks/get`), `cancel()` (`tasks/cancel`), and `onStatus(cb)` (subscribes to `notifications/tasks/status` for the handle's `taskId`). Throws when the host did not advertise `tasks.requests.tools.call`.
- `useCallToolAsTask(toolName)` React hook — wraps `callToolAsTask` with lifecycle: notification subscription, polling fallback via `handle.refresh()` when notifications don't arrive (spec marks them OPTIONAL), terminal-state synthesis on `result()`, bounded backoff on consecutive refresh failures, and re-fire safety. Returns `{ fire, task, result, error, isWorking, isTerminal, cancel }`.
- New exported types: `Task`, `TaskStatus`, `CreateTaskResult` (re-exports from `@modelcontextprotocol/sdk/types.js`), `TasksCapability`, `TaskHandle<TOutput>`, `CallToolAsTaskOptions`, `UseCallToolAsTaskResult`.
- `Synapse._hostTasksCapability` — internal accessor for the host's declared `tasks` capability captured during `ui/initialize`. Tri-state (`null` pre-handshake, `undefined` if host didn't advertise, `TasksCapability` if present) so consumers can feature-detect.

### Changed

- `createSynapse()` now advertises `appCapabilities.tasks = { cancel: {}, requests: { tools: { call: {} } } }` in the `ui/initialize` request. Spec-compliant hosts ignore unknown capability fields, so this is a graceful addition for existing hosts; strict hosts that reject unknown capabilities (non-conformant per MCP) would need to be updated.
- `parseToolResult` now preserves `_meta` (including `io.modelcontextprotocol/related-task`) on the returned `ToolCallResult` via key-preserving spread. Additive — consumers iterating result keys will see one new optional field.
- `connect()` does **not** advertise the `tasks` capability. The returned `App` exposes no task-augmented call surface, so advertising would be a false contract with the host. Use `createSynapse()` for task-aware apps.

### Migration

- **TypeScript mocks of `Synapse`** will fail to compile because `callToolAsTask` and `_hostTasksCapability` are now required members. Add stubs (e.g. `callToolAsTask: vi.fn()`, `_hostTasksCapability: undefined`) or cast a `Partial<Synapse>` at the test boundary.
- No runtime migration needed for end-users of the SDK. Existing `callTool`, `readResource`, theme, and React hook code paths are untouched.

## [0.6.0] - 2026-04-24

### Breaking

- `HostInfo` no longer carries a `theme` field. It was redundant after the host-context unification; read theme via `synapse.getTheme()` / `useTheme()` instead. `HostInfo` reports identity only (host name, protocol version, `isNimbleBrain`).

### Added

- `useHostContext()` React hook and `synapse.getHostContext()` / `synapse.onHostContextChanged()` for reading and observing the full ext-apps host context — including host-specific extensions like NimbleBrain's `workspace` field. Returns the spec-typed `McpUiHostContext`.

### Changed

- `getTheme()` / `useTheme()` / `onThemeChanged()` are now selectors over the unified host-context state. Same API and behavior, but `onThemeChanged` no longer fires when only non-theme fields (e.g. workspace) change.

## [0.5.0] - 2026-04-21

Minor bump: removes a public method from the `Synapse` interface. Also changes the wire format of `synapse/download-file` (now sends a `Blob`, not a string) — must ship paired with a host bridge that accepts a `Blob` payload.

### Fixed

- `downloadFile()` with a Blob now delivers the actual bytes. Previously the Blob path replaced the content with the literal string `"[Blob content not serializable]"` before sending, producing a 31-byte text file on disk. `downloadFile()` now sends the Blob directly over the `postMessage` structured-clone channel; the host bridge downloads it as-is. String content is wrapped in a `Blob` before sending so exactly one shape travels the wire.
- When a Blob is passed with an intrinsic `type` and no explicit `mimeType` arg, the Blob's type is used on the wire (previously the SDK would emit `application/octet-stream` and the host would rewrap the Blob, losing the correct MIME). Precedence is: explicit `mimeType` arg > Blob's intrinsic type > `application/octet-stream` fallback.

### Removed

- **BREAKING:** `saveFile()` / `synapse/save-file`. The method had no host handler (silently no-op) and its signature was indistinguishable from `downloadFile()`. Use `downloadFile()`. If you need to persist a generated file to the workspace so the agent can reference it, that will be a distinct, spec'd API when the need arises.

## [0.4.4] - 2026-04-20

### Fixed

- Spec-compliant theme propagation in Vite preview and `createSynapse` handshake. Preview host now sends tokens under `hostContext.styles.variables` and emits `ui/notifications/host-context-changed` (replacing the legacy `hostContext.tokens` field and `synapse/theme-changed` method). `createSynapse` now injects host CSS variables and notifies theme subscribers immediately after the handshake resolves, so widgets see the host-provided theme on first paint instead of only on subsequent changes.

## [0.4.3] - 2026-04-16

### Added

- `Synapse.readResource(uri)` — reads an MCP resource from the originating server via the ext-apps `resources/read` bridge. Returns the spec-shaped `ReadResourceResult`.
- `App.readServerResource(params)` — spec-aligned equivalent on the low-level `App` type. Accepts `ReadResourceRequest["params"]` so callers can pass `_meta` (progress tokens, related-task).
- `ReadResourceRequest` and `ReadResourceResult` re-exported from the package root so consumers don't need a direct `@modelcontextprotocol/sdk` import.

### Fixed

- Vite preview harness no longer emits `synapse/data-changed` on UI-initiated tool-call responses. The old behavior created a feedback loop (tool call → `data-changed` → `useDataSync` refetches → tool call → …).

## [0.3.0] - 2026-03-31

### Added

- `connect()` — async entry point that owns the handshake and resolves with a ready-to-use `App` object. Replaces the `createSynapse()` + `await ready` pattern.
- `App.on()` — generic event subscription with short-name mapping (`"tool-result"`, `"tool-input"`, `"theme-changed"`, `"teardown"`)
- `App.resize()` — manual and auto resize with `ResizeObserver` (16ms debounce)
- `App.updateModelContext()` — push LLM-visible state (replaces `setVisibleState` name in the new API)
- `App.sendMessage()` — send chat messages (replaces `chat` name in the new API)
- `ToolResultData` type — parsed tool result with `content`, `structuredContent`, and `raw` fields
- `Theme` type — simplified theme interface (mode + tokens, no primaryColor)
- `Dimensions` type — container dimensions from the host
- `ConnectOptions` interface
- React: `AppProvider` component wrapping `connect()`
- React: `useApp()`, `useToolResult()`, `useToolInput()`, `useResize()`, `useConnectTheme()` hooks
- IIFE build: `window.Synapse` global with `connect`, `createSynapse`, `createStore`
- Package export: `./iife` entry point (`dist/connect.iife.global.js`)
- Content parser implementing the 5-step RFC algorithm for `tool-result` notifications
- Event-name mapping module (`tool-result` → `ui/notifications/tool-result`, etc.)
- Resize module with manual and auto modes

### Changed

- IIFE global renamed from `window.NbSynapse` to `window.Synapse`

### Deprecated

- `createSynapse()` — use `connect()` instead. `createSynapse()` continues to work for backwards compatibility.
- `SynapseProvider` — use `AppProvider` instead for new apps.

## [0.2.2]

### Changed

- `downloadFile()` renamed to `saveFile()` (message: `synapse/save-file`)
- `requestFile()` renamed to `pickFile()` (message: `synapse/pick-file`)
- `requestFiles()` renamed to `pickFiles()`

## [0.1.0]

### Added

- `createSynapse()` — framework-agnostic core with typed tool calls, data sync, theme tracking, and keyboard forwarding
- `createStore()` — reactive state store with optional persistence and agent visibility
- React bindings (`@nimblebrain/synapse/react`): `SynapseProvider`, `useSynapse`, `useCallTool`, `useDataSync`, `useTheme`, `useAction`, `useChat`, `useVisibleState`, `useStore`
- Vite plugin (`@nimblebrain/synapse/vite`): dev server CORS, HMR for sandboxed iframes, runtime injection
- Code generation CLI (`@nimblebrain/synapse/codegen`): generate TypeScript types from manifests, running servers, or schema directories
- IIFE build (`synapse-runtime.iife.js`) for iframe injection without a bundler

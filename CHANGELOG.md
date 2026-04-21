# Changelog

All notable changes to this project will be documented in this file.

This project adheres to [Semantic Versioning](https://semver.org/).

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

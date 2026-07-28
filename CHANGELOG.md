# Changelog

All notable changes to this project will be documented in this file.

This project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed

- **The unbacked defaults carry no brand.** `--nb-color-warm` fell back to `#d4620a` / `#fb923c` — an orange from a superseded brand generation, on a token map whose own docblock promises "grays + a generic blue". No host injects `--nb-color-warm`, so every app rendering `<Badge tone="warm">` painted that orange in every host, including one whose palette has a single blue accent and no warm channel at all. It now resolves to the generic accent the rest of the map already uses, so an unbacked emphasis badge reads as emphasis without introducing a second hue. A host that wants a distinct warm still injects one.
- **Headings fall back to the body stack, not a serif.** `tokens.fontHeading` fell back to `Georgia, 'Times New Roman', serif`, so any host that injects no `--nb-font-heading` rendered headings in a display serif — the same brand-by-default problem the removal of `@nimblebrain/synapse/ui/fonts` addressed in 0.13.0, one token over. The fallback is now the sans stack: one family, hierarchy from weight and size.

## [0.13.0] - 2026-07-26

Moves typography onto the same host-wins footing as colour. The token contract could always *name* a font family (`--font-sans`), but a CSS custom property cannot carry the `@font-face` rule that loads one — and an app iframe is its own document, inheriting no faces from the host page. So a host sending only tokens was naming a typeface the app had no way to render. Hosts now send the faces alongside the tokens, and the SDK ships no font data at all.

### Added

- **Host fonts on the cross-host client.** The `mcpapps` adapter (the MCP Apps standard path, which both Claude and the NimbleBrain runtime route through) carries `synapse/fontFaces` into `SynapseUITheme`, so `connectUI` apps receive host typography too. ChatGPT's Apps SDK supplies only a mode string, so that adapter cannot.
- **`SynapseTheme.fontFaces`** — an optional list of `@font-face` descriptors (`family`, `src`, and optional `weight` / `style` / `display`) a host sends to style the app in its own typeface. Arrives over the wire as the `synapse/fontFaces` host-context extension (`McpUiHostContext` declares `[key: string]: unknown` for forward compatibility, so this is spec-legal; hosts that omit it are unaffected). `src` takes any CSS `src` descriptor, so relative paths (`url('/fonts/x.woff2')`), absolute URLs, and `data:` URIs all work — whatever origin it names must satisfy the app iframe's `font-src` CSP.
- **`applyTheme(mode, tokens, fontFaces?)`** — internal, and now the single funnel by which theming reaches the DOM, replacing bare `applyThemeVariables` at all six call sites (both connection paths' handshake and `host-context-changed`, plus `<SynapseProvider>` and `applyHostTheme`). Colour and typography travel together deliberately: a vars-only *or* faces-only entry point invites a caller to wire one and forget the other, shipping a host's palette under the wrong typeface. The package's public surface is unchanged — no theming entry point is exported, since every funnel call is inside the SDK.

### Fixed

- **Loaded faces survive a partial `host-context-changed`.** The ext-apps notification carries only the fields that changed, so a bare `{ theme: "dark" }` toggle must not be read as "the host has no fonts". One rule now holds end to end — at the wire, in both connection paths, and at the sink: **absent means unchanged, an explicit list (including empty) replaces.** `applyTheme(mode, tokens)` therefore leaves loaded faces alone rather than wiping them. Without this a dark-mode toggle dropped the app's typeface mid-session, including under `<SynapseProvider>`, whose `ThemeInjector` re-applies the theme a tick after the transport handler.
- **`getTheme()` and the `onThemeChanged` payload agree with the DOM.** Both resolve through the same fold, so neither reports typography the app isn't actually using.
- **A fonts-only host change reaches theme subscribers.** `onThemeChanged`'s equality filter compares font faces, so a host swapping typeface without touching mode or tokens no longer updates the DOM while every `useTheme()` consumer reports the old faces.

### Breaking

- **`@nimblebrain/synapse/ui/fonts` is removed.** It injected a Fontshare stylesheet for one host's brand from inside a general-purpose library — fetching a third-party CDN as an import side effect, into a sandboxed iframe whose CSP blocked it anyway. A library that hardcodes a consumer's brand doesn't merely couple to it: it rots silently when that consumer rebrands, which is exactly what happened here.

  **Migration.** Delete `import "@nimblebrain/synapse/ui/fonts"` from your app entry; the app then renders in web-safe fallbacks until its host sends `fontFaces`. Existing apps pinned to `^0.11.0` / `^0.12.0` are unaffected until they bump, since caret on `0.x` will not cross a minor.

### Changed

- **The no-host path is now a supported configuration, not a degraded one.** With no host, no network and no font files, an app renders in web-safe stacks (`system-ui` / `ui-monospace` / `Georgia`) — pinned by test, along with the guarantees that the SDK names no font CDN and carries no font binaries. Hosts should still give every `--font-*` token value a web-safe tail: a bare family name with no matching face falls through to the browser default.

## [0.12.2] - 2026-07-24

### Fixed

- **`Drawer` traps Tab focus** (a11y). The sandbox-safe rebuild in 0.12.1 focused into the panel and locked background scroll but let a keyboard user `Tab` out to controls behind the scrim. `Tab` / `Shift+Tab` now cycle within the panel's focusable elements (and stay on the panel when it holds nothing tabbable). Scope: this contains Tab while focus is inside the panel — the full native-`inert` behavior (recovering focus that drops to `<body>` when a focused child unmounts, and fencing off portal'd overlays) is a larger FocusScope effort tracked in #43.

## [0.12.1] - 2026-07-24

### Fixed

- **`Drawer` no longer white-screens an app.** The platform mounts every app in a sandboxed iframe that withholds `allow-modals`, so the old native-`<dialog>` `Drawer` threw on `showModal()` and unmounted the whole app the moment it opened — the one environment these components run in is exactly the one a `<dialog>` can't. It is now a plain positioned-`<div>` overlay with the same API (`open` / `onClose` / `onEscape` / `side` / `width` and the `Header` / `Body` / `Footer` slots), hand-rolling what `showModal()` gave for free: the scrim, focus-into-panel on open (restored on close), background-scroll lock, and Escape. It renders nothing when closed, so an always-mounted `open={false}` Drawer no longer covers the layout.

## [0.12.0] - 2026-07-12

Adds a **cross-host UI client** so one Synapse-authored component renders in ChatGPT (OpenAI Apps SDK) and Claude (the **MCP Apps standard**, SEP-1865), not only the NimbleBrain runtime. The host bridge each surface needs — feature-detect the environment, locate pushed data, route theme / resize / link / follow-up — is now a versioned framework surface (`connectUI`) instead of a per-app hand-rolled shim. Purely additive: the ext-apps `connect` / `createSynapse` paths and every existing app are untouched.

### Added

- **`connectUI()`** — a framework-agnostic, **push-first** client (`@nimblebrain/synapse` and `@nimblebrain/synapse/host`). `data()` / `onData()` deliver the tool output that spawned the widget; `theme()` / `onTheme()`, `resize()`, `openLink()`, `sendPrompt()`, and `capabilities()` are cross-host primitives; `callTool()` is the pull escape hatch that rejects with `HostUnsupportedError` where a host advertises no widget→server call. The client applies theme to the DOM for both conventions at once (`data-theme` attribute + CSS variables), so apps never wire theming by hand.
- **Host adapters** behind the detection seam: `chatgpt` (`window.openai.toolOutput` + `openai:set_globals`; `sendFollowUpMessage`; `openExternal`; `callTool`), an **MCP Apps standard** adapter for Claude Desktop and the runtime (the `ui/*` JSON-RPC bridge over `postMessage`: `ui/initialize` → `ui/notifications/initialized` → `tool-result` / `host-context-changed`, plus `size-changed`, `ui/open-link`, `ui/message`, and `tools/call` for pull; theme mode **and** `hostContext.styles.variables` tokens flow through; the legacy mcp-ui `ui-lifecycle-*` messages are folded in as a compat shim so a pre-standard host still renders), and an `inline` fallback (baked-in `<script type="application/json">` for SSR / standalone). `synapse/*` NimbleBrain-private fields never appear in host payloads.
- **MCP Apps server descriptors** (`SynapseUI`, Python) — the tool declares the nested `_meta.ui.resourceUri` and the component is served under `text/html;profile=mcp-app` (alongside the unchanged ChatGPT `text/html+skybridge` resource), so an MCP Apps host mounts the widget. Plain MCP clients still read `structuredContent` and degrade gracefully.
- **`@nimblebrain/synapse/iife/ui`** (`window.SynapseUI`) — a lean IIFE (~7 KB; no ext-apps / Zod in its graph) a self-contained `ui://` component inlines to speak every host bridge. The full runtime IIFE (`window.Synapse`) also exposes `connectUI`.

## [0.11.0] - 2026-06-23

Fixes a silent full-pane collapse. `AppFrame` fills its host pane with `height: 100%`, but that only resolves against a definite-height ancestor chain (`#root` → `body` → `html`) — and the SDK shipped no such chain. A Synapse app iframe is its own bare document, so unless the app added `html, body, #root { height: 100% }` to its own `index.html`, `AppFrame`'s `height: 100%` resolved against a content-height ancestor and the whole app collapsed to content height: full width, short height (e.g. an empty board rendering as a ~442px band inside an 868px pane). The precondition the shell depended on was neither supplied nor enforced, so multiple apps hit it.

### Added

- `@nimblebrain/synapse/ui/base` — a side-effect import that injects the root-height chain (`html, body, #root { height: 100% }`) plus `body { margin: 0 }`. Import it in an app entry to establish the chain before first paint (no layout jump), or for a full-pane app that renders without `AppFrame`.

### Fixed

- `AppFrame` now establishes the root-height chain itself, calling the same base reset on render, so **every** app built on it fills the pane with no per-app `index.html` requirement — existing apps included. The fix uses a percentage chain rather than a viewport unit (`vh`/`dvh`): percentages resolve against the actual allocated pane, staying correct on hosts that give an app a pane shorter than the viewport (where a viewport unit would overflow with a second scrollbar). `AppFrame`'s `height: 100%` and internal scroll model are unchanged; the missing precondition is simply now supplied.

## [0.10.2] - 2026-06-23

Fixes three `ui` tokens that were theme-blind in dark mode. `tokens.bgSubtle`, `tokens.fgFaint`, and `tokens.borderStrong` reference CSS vars (`--color-background-tertiary`, `--color-text-tertiary`, `--color-border-secondary`) that no host injected, so they always resolved to their hardcoded **light** fallbacks — rendering white-on-white surfaces, invisible borders, and illegible faint text whenever a host signaled dark. This hit the SDK's own components (Card, ListRow, Prose, Table, Badge, Button, Avatar, SearchField, SegmentedControl, EmptyState, StatusDot) and any app pairing one of these with a theme-aware token. A `var()` fallback is a static literal that can't branch on theme, so the fix is a theme-aware default layer, not a smarter fallback.

### Fixed

- The SDK now ships a **neutral default theme** (`theme-defaults.ts`) that backs every color var the token contract references, in both light and dark. It's applied to `:root` beneath the host's variables — so the host's brand values still win for the keys it provides, and any var the host omits resolves to a theme-correct neutral default. The three previously-unbacked tokens now render correctly in dark mode against any host, a standalone `connect()` widget, or a third-party host. Values stay neutral (brand arrives only by host injection), preserving the library's host-agnostic design.
- The preview harnesses (`vite` plugin host + `preview` server) now inject the three vars in both themes, so `synapse dev`/`preview` matches a complete host, and a duplicate `--color-text-primary` key in those theme maps was removed.

### Changed

- Theme variables now reach the DOM through a single shared path, `applyThemeVariables(mode, hostVars)`, replacing three near-duplicate inline injectors in `core.ts`, `connect.ts`, and the React `<SynapseProvider>`. No public API change.

## [0.10.1] - 2026-06-19

Fixes a master/detail overlap. A too-wide child in `ListDetailLayout.List` — e.g. an auto-layout `<table>` that won't shrink below its content — spilled out of the fixed-width list rail and painted over the detail pane. Surfaced dogfooding the People CRM, whose list rendered a 3-column table inside the 320px rail.

### Fixed

- `ListDetailLayout.List` now clips horizontal overflow (`overflow: hidden auto`) and sets `minWidth: 0` on the side-by-side rail, so an oversized child scrolls/clips within the rail instead of overlapping the detail pane. Prefer `ListRow` for master lists; reserve `Table` for full-width surfaces.

## [0.10.0] - 2026-06-19

Makes the `Drawer` header affordances first-class so consumers stop re-rolling them, and adds a bottom-sheet variant. Surfaced by dogfooding the CRM and todo-board retrofits, where each app had hand-rolled a back button, lost heading semantics, and keyed touch sizing off viewport width. Purely additive — existing `Drawer` / `Drawer.Header` usage is unchanged.

### Added

- `Drawer.Header` `title` prop — renders a real `<h2>` and wires the dialog's accessible name via `aria-labelledby` (replacing consumer `aria-label` when present).
- `Drawer.Header` `onBack` prop — a leading back button (e.g. to pop a panel stack).
- `Drawer.Header` `actions` prop — a trailing slot placed before the close button.
- `Drawer` `side="bottom"` — a bottom-sheet variant (full width, content height capped at 92%).
- The header's close/back icon buttons grow to a 44px hit target under `@media (pointer: coarse)` — keyed to input modality, not viewport width, so touch laptops get large targets and narrow desktop windows don't.



Adds `@nimblebrain/synapse/ui` — a token-driven, brand-free component layer so embedded Synapse apps share one system with per-host personality. Components hold no brand; the host injects the theme via CSS variables (`hostContext.styles.variables`), so the same app adopts any host's look with no re-render. Purely additive — no changes to existing exports. See [PR #12](https://github.com/NimbleBrainInc/synapse/pull/12).

### Added

- `@nimblebrain/synapse/ui` subpath export with a `var(--token, neutral-fallback)` token contract (no brand baked in).
- Primitives: `Stack`, `Inline`, `Spacer`, `Divider`. Typography: `Text`, `Heading`, `Prose`.
- Components: `Avatar`, `Badge`, `Button`, `TextLink`, `Card`, `Drawer` (native `<dialog>`), `EmptyState`, `ListRow`, `Pagination`, `SearchField`, `SegmentedControl`, `Spinner`, `StatusDot`, `Table`.
- Layouts: `AppFrame`, `SidebarLayout` (reflow/drawer), `ListDetailLayout`, plus the `useBreakpoint` hook.
- `@nimblebrain/synapse/ui/fonts` subpath for font wiring.



Fixes the file picker, which was effectively dead in NimbleBrain hosts and inflated bytes through tool-call JSON. `pickFile` / `pickFiles` now resolve to a stable workspace file ID; the host persists the bytes server-side over multipart.

### Breaking

- `FileResult.base64Data` removed; `FileResult.id` (workspace file ID, `fl_` + 24 hex) added. Tools that need the bytes look the file up by ID server-side instead of receiving them inline. The prior shape capped uploads at the JSON body limit; this removes that ceiling.

### Fixed

- `pickFile` / `pickFiles` sent `synapse/pick-file`, but the NimbleBrain bridge handles `synapse/request-file` — calls would hang until the iframe's request timeout. Both methods now send `synapse/request-file`.

## [0.7.0] - 2026-04-24

Adds iframe-side support for the [MCP 2025-11-25 tasks utility](https://docs.nimblebrain.ai/apps/synapse/#long-running-tools) so widgets can fire long-running tools without blocking. See [PR #8](https://github.com/NimbleBrainInc/synapse/pull/8).

### Added

- `synapse.callToolAsTask(name, args?, opts?)` returns a `TaskHandle` (`result()` / `refresh()` / `cancel()` / `onStatus()`) for long-running tools.
- `useCallToolAsTask(name)` React hook with notification subscription and polling fallback.
- `Task`, `TaskStatus`, `CreateTaskResult`, `TasksCapability`, `TaskHandle`, `CallToolAsTaskOptions`, `UseCallToolAsTaskResult` exports.

### Changed

- `createSynapse()` advertises `appCapabilities.tasks` on init; `parseToolResult` preserves `_meta` (including `io.modelcontextprotocol/related-task`).

### Breaking

- TypeScript mocks of `Synapse` must add stubs for `callToolAsTask` and `_hostTasksCapability` (now required interface members). Runtime API unchanged.

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

# Changelog

All notable changes to this project will be documented in this file.

This project adheres to [Semantic Versioning](https://semver.org/).

## [0.17.0] - 2026-09-08

### Breaking

- **One connection API. `createSynapse` / `Synapse` / `SynapseProvider` are gone; `connect()` / `App` / `AppProvider` is the whole surface.**

  `connect()` landed in 0.3.0 to replace `createSynapse()`, and the 0.3.0 notes marked the old call deprecated — but nothing enforced it, and every feature wave since landed on the deprecated path. `App` froze at five hooks while `Synapse` grew to thirteen. That is not a migration in progress; it is a fork whose dead branch was carrying the product.

  It cost more than confusion. The two families were indistinguishable at the import site and disjoint at runtime, so a hook from the wrong one type-checked, built, and threw `useApp must be used within an <AppProvider>` at mount — which is how a saved-chart panel went down the first time a user opened it. Removing one half is what makes that class of failure unrepresentable.

  Caret ranges on `0.x` do not cross a minor, so this arrives only on a deliberate bump.

  | Removed | Use |
  |---|---|
  | `createSynapse(options)` | `await connect(options)` |
  | `Synapse` (type) | `App` |
  | `SynapseOptions` | `ConnectOptions` |
  | `SynapseTheme` | `Theme` (no `primaryColor` — it was a constant no host ever set) |
  | `<SynapseProvider>` | `<AppProvider>` |
  | `useSynapse()` | `useApp()` |
  | `useConnectTheme()` | `useTheme()` |
  | `useVisibleState()` | `useModelContext()` |
  | `useChat()` | `useSendMessage()` |
  | `useAgentAction(cb)` | `app.on("action", cb)` |
  | `synapse.chat(text, ctx)` | `app.sendMessage(text, ctx)` |
  | `synapse.setVisibleState(s, sum)` | `app.updateModelContext(s, sum)`, or `useModelContext` for the debounce |
  | `synapse.readResource(uri)` | `app.readServerResource({ uri })` |
  | `synapse.getTheme()` / `onThemeChanged(cb)` | `app.theme` / `app.on("theme-changed", cb)` |
  | `synapse.getHostContext()` / `onHostContextChanged(cb)` | `app.hostContext` / `app.on("host-context-changed", cb)` |
  | `synapse.onDataChanged(cb)` | `app.on("data-changed", cb)` |
  | `synapse.onAction(cb)` | `app.on("action", cb)` |
  | `synapse.action(name, params)` | `action(app, name, params)` |
  | `synapse.pickFile(o)` / `pickFiles(o)` | `pickFile(app, o)` / `pickFiles(app, o)` |
  | `synapse.downloadFile(f, c, m)` | `downloadFile(app, f, c, m)` |
  | `synapse.callToolAsTask(n, a, o)` | `callToolAsTask(app, n, a, o)` |
  | `synapse.ready` | the `connect()` promise itself |
  | `synapse._request` / `_onMessage` | no replacement — `callTool`'s `server` option covers the one real use, and the plumbing is now module-private |
| `synapse._hostTasksCapability` | `app.supportsTasks` |
| `VisibleState` (type) | `ModelContext` |
  | `Synapse.createSynapse` (IIFE global) | `Synapse.connect` |

- **`createStore` / `useStore` / `Store` / `StoreConfig` removed.** Zero consumers anywhere, and it was built on two NimbleBrain-private methods with no spec equivalent. Re-addable in ~110 lines against `App` if a real one appears.

- **The NimbleBrain extensions are functions over `App`, not methods on it.** `action`, `pickFile`, `pickFiles`, `downloadFile` and `callToolAsTask` all take the app as their first argument and are imported from the package root. The point of the convergence was a smaller object with a nice front door, not the same seventeen methods under a new name — and an app that never picks a file no longer carries the picker.

- **`sendMessage` sends `_meta.context` only on a NimbleBrain host.** `context` is a NimbleBrain convention riding the spec's open `_meta`; `Synapse.chat` already gated it and `App.sendMessage` did not. The gate is what the merged method keeps. On any other host the message is sent without it.

- **`app.updateModelContext` sends immediately.** The 250 ms debounce that `setVisibleState` applied now lives in `useModelContext`, where the rapid-change problem actually is. A non-React caller that relied on the debounce should coalesce its own pushes.

- **`AppProvider` renders nothing until the handshake completes**, where `SynapseProvider` rendered children immediately and left them to race the connection. A migrated app shows its own frame a tick later than it used to; nothing below the provider can now observe a half-connected app.

### Added

- **`connect({ internal })`** — the cross-server call mode `createSynapse` had. An internal app's `callTool` carries its own name as `server`.
- **`callTool(name, args, { server })`** — route one call to a sibling server explicitly, instead of reaching past the SDK for a raw `tools/call`.
- **`connect({ forwardKeys })`** — keyboard forwarding, off by default and gated on a NimbleBrain host. `SynapseProvider` forwarded Escape and every Ctrl/Cmd combo unconditionally; forwarding to a host that does not implement `synapse/keydown` only swallows the key. Pass `true` for the old default set, or an array for specific combos.
- **`app.hostContext`, `app.isNimbleBrainHost`, `app.destroyed`** — handshake state that previously existed only on `Synapse`.
- **`useCallTool`, `useDataSync`, `useHostContext`, `useModelContext`, `useFileUpload`, `useAction`, `useSendMessage`, `useCallToolAsTask`** now work under `<AppProvider>`. This is the parity that was missing; every one of them was previously reachable only from the provider being removed.
- **`connect()` advertises `appCapabilities.tasks`.** It did not before, correctly, because `App` could not task-augment a call. It can now, so it says so — per MCP 2025-11-25 a requestor advertises exactly what it can use.
- **`app.supportsTasks`** — whether the host negotiated the tasks utility, as a plain answer to a plain question. The old form of this was reading `_hostTasksCapability`, an `@internal` member consumers were told to feature-detect against; a capability question deserves a public name, not a documented peek into plumbing.

### Internal

- **The helpers' plumbing is module-private.** `action`, `pickFile`, `pickFiles`, `downloadFile` and `callToolAsTask` reach the transport through a `WeakMap` keyed by the app, not through a member on it. An `_internals` (or `_request`) member is still a member — it type-checks, autocompletes, and hands every consumer a transport the SDK does not model a use for. Underscore and an `@internal` tag are a request, not a boundary, and treating one as a boundary is how a bridge script came to hand-roll its own `tools/call`.

### Fixed

- **A partial `host-context-changed` no longer wipes the fields it omits** (#46). The spec types the notification as "a partial context update containing only changed fields", so it is a delta and `hostContext` is the state it updates. It was being applied as a replacement, which meant a host toggling dark mode with a bare `{ theme: "dark" }` lost its whole palette mid-session — `styles.variables` re-derived as `{}` and `applyTheme` stripped every host CSS variable from the DOM — and lost every extension it had published, so `useHostContext().workspace` read `undefined` after any toggle.

  The merge is shallow. `styles.variables` is a complete map when a host sends one, so deep-merging it would leave no way to remove a variable. Fonts keep their own fold on top, because it encodes a rule a merge cannot: a batch whose entries are all malformed must leave the loaded faces alone rather than unload the host's typeface.

  `on("host-context-changed", …)` delivers the **merged snapshot**, because that is what `hostContext` means and a delta cannot distinguish an omitted field from a cleared one. The notification exactly as sent is still available by subscribing to the wire method, `on("ui/notifications/host-context-changed", …)`.

- **A host that errors `ui/initialize` no longer leaves the app blank.** `AppProvider` gates children on the handshake and had no rejection path, so a refused handshake rendered nothing forever with only an unhandled rejection to show for it. The rejection now re-throws during render, which makes it an ordinary React error: it reaches the nearest error boundary and is loud in development.

### Changed

- Smaller published package: unpacked 2,125,422 → 2,062,828 bytes. The runtime JS that a bundler actually pulls in drops ~15 KB (315,987 → 301,104 bytes across ESM+CJS), and `react/index.js` drops 13% (13,267 → 11,499 raw, 2,956 → 2,638 gzipped). The `connect.iife` global barely moves, because Zod dominates it — a separate problem, untouched here.
- `./host` (`connectUI` / `window.SynapseUI`), `./ui`, `./vite` and `./codegen` are unchanged, and so is every wire frame. Only the TypeScript surface moved.

## [0.16.0] - 2026-09-07

### Breaking

- **`Text truncate` now forms a block box.** It set `overflow`, `text-overflow` and `white-space` on a `<span>`, and the first two do not apply to a non-replaced INLINE box — so the only declaration that survived was `white-space: nowrap`, and the prop did the opposite of its name: text became unwrappable instead of clipped. Inside an auto-layout `<table>` that widened the column to the full string and carried every later column off the pane. It now sets `display: block` and `min-width: 0` alongside, so the box can both clip and shrink as a flex item.

  Nothing can have depended on the intended behaviour, because it never had any — but **a layout tuned around the broken behaviour will move**. Filed here rather than under Fixed because it is the one change in this release that reaches an existing consumer's rendering. Caret ranges on `0.x` do not cross a minor, so it arrives only on a deliberate bump.

### Added

- **`PageLayout` — one screen of an app, assembled in the one order that works.** A header naming what you are looking at, a tab bar of that thing's facets, an optional toolbar over the content, then the content. Every level of an app is this shape, and descending changes only whose facets the bar holds: at the root the header names the app and the tabs are its sections; a level down a trail appears, the header names the record, and the tabs are the record's own.

  **It is a component even though the kit's rule says thin compositions stay recipes**, because that rule measures mechanical complexity and this is not a complexity problem. Assembling these DIFFERENTLY is a defect rather than a preference, and prose does not stop it: two tab bars stacked until nobody could tell which row changed what, a chrome bar whose rule missed the host's by a few pixels, an unbounded description pushing content below the fold — all shipped, all ordering mistakes a component makes unavailable. The amended rule: a layout becomes a component when it is complex to build **or** when getting its arrangement wrong is a bug.

- **`Breadcrumb`, `PageHeader`, `Tabs` — the pieces it is built from**, exported for apps that need one without the whole shape. A hierarchy deeper than two levels cannot be navigated by a back button, and every app that grew one has been assembling the same four pieces itself. `PageHeader` fixes their order (trail → title + status + actions → description) because a multi-screen app only reads as one app if the top of every screen has one rhythm.

  `Tabs` exists beside `SegmentedControl` rather than instead of it, and the split is the point. They are mechanically the same control and different jobs: **tabs change which FACET of one chosen entity is shown** (they add no selection, so they add no level), **a segmented control narrows or reshapes a SET**. An app using one component for both stacks two or three identical pill rows down the page — app nav, entity facets, list filter, all in one costume — and the reader cannot tell which row changes what. The distinction is carried in the form: an underlined bar that belongs to the thing above it, versus a raised track that belongs to the thing below it. `Tabs` ships the full tablist contract (roving tabindex, arrow keys, wrap) because half of the pattern is worse than none of it.

  **There is deliberately no app-chrome bar, and no slot for an app's sections.** A Synapse app does not own its window: the host spends the left edge on a rail and the right on a chat panel, so a bar of the app's own is a third chrome layer whose rule lands a few pixels off the chat panel's — two near-parallel lines that read as a mistake rather than as structure, and no amount of styling reconciles them. The measured column is ~1000px on a laptop with chat open, so a row spent on chrome is a row taken from the thing someone opened the app to see.

  An app's sections are facets of the app exactly as a record's tabs are facets of the record, so they go in a `Tabs` bar under the header — **one shape at every level, and only the tab bar's contents change as you descend.** At the root the header names the app and the tabs are its sections; a level down the header names the record, a trail appears above it, and the tabs are the record's own. The sections are not repeated at depth: two tab bars stacked is what made the screen unreadable in the first place, and the trail is how you get back to them.

- **`Table` gains `minWidth`** — the width below which the table scrolls inside its own container rather than crushing. A fixed-layout table has no lower bound of its own, so seven columns in a 400px pane become seven clipped headers and a badge overflowing its cell; this is where a caller says how narrow is too narrow.

  It is the whole of the scrolling API on purpose. A flag that merely turned scrolling on would have no well-defined moment to engage: under fixed layout the table always fits its container, and under auto layout it engages at whatever width the content happens to reach — which is not a decision anyone made. You cannot scroll meaningfully without saying where scrolling starts.

  Opt-in rather than a default because it costs the sticky header: an `overflow-x` container captures the stickiness `position: sticky` resolves against the page's own scroller, and CSS offers no way to scroll one axis while leaving the other visible.

### Fixed

- **`Table` honours a declared column `width`.** Declaring `width` on any column now switches the table to `table-layout: fixed`; columns without one divide the remainder equally. Under auto layout — the CSS default — a declared width is advisory and content wins, so `Column.width` was a knob that silently did nothing and a truncating cell had no width to be clipped against. **A column that truncates must declare a width**; nothing fails loudly when you forget, because the table renders and the columns you cannot see are simply past the right edge.

## [0.15.0] - 2026-07-27

### Breaking

- **The `warm` tone and the `warm` / `warmLight` tokens are removed.** `--nb-color-warm` was a second accent channel that no host injects — the NimbleBrain runtime's projection covers ten colour vars and this was never among them — so every app rendering `<Badge tone="warm">` painted the SDK's own fallback, `#d4620a`, a hex from a retired brand generation. A library cannot ship a channel it has no unbranded value for: the neutral answer to "a second accent" is that there isn't one.

  **Migration.** `tone="warm"` → `tone="accent"` where the badge is informational, `tone="warning"` where it is a caution. `tokens.warm` / `tokens.warmLight` → `tokens.accent` / `tokens.infoLight`, or the `warning` pair. Apps pinned to `^0.11.0`–`^0.14.0` are unaffected until they bump, since caret on `0.x` will not cross a minor.

### Fixed

- **Headings fall back to the body stack, not a serif.** `tokens.fontHeading` fell back to `Georgia, 'Times New Roman', serif`, so any host that injects no `--nb-font-heading` rendered headings in a display serif — the same brand-by-default problem the removal of `@nimblebrain/synapse/ui/fonts` addressed in 0.13.0, one token over. The fallback is now the sans stack: one family, hierarchy from weight and size.
- **The vendored Python IIFE tracks the build.** `python/nimblebrain_synapse/_assets/synapse-ui.iife.js` is a second shipping path, and it carried the old values independently of `dist/`.

### Added

- **A neutrality guard on the colour defaults.** Every hex in `DEFAULT_THEME_VARS` *and* in the `tokens` `var()` fallbacks must appear in a declared sanctioned set — neutral ladder, a generic blue, and the generic semantic hues. Both maps, because both are the unbranded-default claim and the brand orange sat in both: one is the block the SDK injects, the other is what each component resolves against when a host declares nothing. Typography got a guard in 0.13.0; colour had none, which is how that orange survived two releases under docblocks claiming the values were unbranded. An allowlist rather than a denylist: a denylist only catches the brand values someone thought to name, which is how the last one got in.
## [0.14.1] - 2026-07-27

### Fixed

- **The defaults no longer add DOM requirements that break an existing caller.** Through 0.13.0 this module needed exactly `document.documentElement.style.setProperty`, plus a feature-checked `document.fonts`. 0.14.0 moved the neutral defaults into a `<style>` element and started clearing stale keys, which silently added four more requirements — `getElementById`, `createElement`, `head.prepend` and `removeProperty`. A caller whose `document` supplied the old envelope and not the new one began throwing.

  The throw is not contained: it unwinds through `applyTheme` into the handshake, so the app never finishes connecting and the symptom is a dead session with nothing pointing at theming. `removeProperty` is the quieter half — `appliedInlineKeys` is empty on the first apply, so that pass is skipped entirely and the throw waits for a theme toggle.

  Both new capabilities are now feature-checked at the point of use, the way `applyThemeFontFaces` has always checked `document.fonts`. A document that cannot carry a stylesheet gets no default layer and keeps its session; the host's variables are still written inline, which is the part that carries its brand. This restores 0.13.0's capability envelope exactly — it does not widen it.

## [0.14.0] - 2026-07-27

Makes the neutral default theme behave like a default. It was applied as inline properties on `documentElement`, which outranks every author stylesheet — so it beat the very declarations it was meant to back up.

### Requires: a host channel that can be updated

The SDK no longer overrides what a host declares for a token, so a host is now responsible for keeping its own token values current. **Anything that varies with light/dark must reach the app on a channel the host can update.** A host that bakes its tokens into the app document once, at mount, and cannot rewrite them afterwards will hold those tokens at their mount-time values across a theme toggle.

This is a pre-existing condition that 0.14.0 stops masking, not one it introduces. Since 0.10.2 the SDK's inline defaults overrode such tokens outright, which hid the staleness by discarding the host's values — the bug this release fixes. Bumping from 0.10.2–0.13.x will surface it; bumping from 0.9.x or earlier, which shipped no default map, changes nothing about it either way.

Against the NimbleBrain runtime that condition holds today: `--color-text-accent` and the `--nb-color-*` family are delivered in a `srcdoc` block fixed at mount, so they keep their mount-mode values when the user flips the theme, four of them landing under WCAG AA on a dark background. Tracked as [nimblebrain#817](https://github.com/NimbleBrainInc/nimblebrain/issues/817). Worth fixing on its own schedule — it is not a reason to hold this bump.

### Fixed

- **A default no longer overrides the host.** `applyThemeVariables` now installs `DEFAULT_THEME_VARS` as a `@layer synapse-defaults` stylesheet instead of writing it to `documentElement.style`. An unlayered rule outranks a layered one, so a host's or app's own `:root` declaration wins, while a var nobody declares still resolves to a theme-correct neutral default — which is what the map was always documented to do.

  This mattered because `hostContext.styles.variables` is a closed enum: a host whose design system is larger than that enum has to deliver the remainder as a stylesheet injected into the app document, and that is the only channel available to it. Every such var that the SDK also defaulted was silently replaced by the SDK's value, permanently, with no self-heal path. A host sending its brand accent that way rendered in the SDK's neutral blue instead.

  The host's protocol-delivered variables still go inline, so they continue to win over both the layer and any app rule. Overriding a default from an app now needs no `!important` — a plain `:root` rule is enough. The defaults arrive as an injected `<style>`, the same channel `base-reset` and the interactive components already require.

- **A narrowed variable set no longer leaves the previous one pinned inline.** An ext-apps `host-context-changed` carries only the fields that changed, so a notification that flips mode while omitting `styles` reaches `applyThemeVariables` as an empty var set. Applying the defaults inline used to mask that by rewriting every defaulted key on each call; a layer cannot, because it cannot outrank an inline property. A key the SDK wrote inline on a previous call and the incoming set does not carry is now removed, letting the cascade resolve it against the host's stylesheet, the app's rule, or the layer — rather than pinning the previous theme's values while the layer flips.

  Removal is keyed off what the SDK last wrote, not off `DEFAULT_THEME_VARS`. Those are different sets: a host may send any spec-enum var, and roughly 25 theme-sensitive ones (`--color-text-danger`, `--color-background-inverse`, …) have no neutral default, so keying off the default map would leave exactly those pinned at the previous mode's value. It also means the SDK never clears an inline property it did not set, so an app writing `documentElement.style` itself is left alone.

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



## [0.9.0] - 2026-06-07

Adds `@nimblebrain/synapse/ui` — a token-driven, brand-free component layer so embedded Synapse apps share one system with per-host personality. Components hold no brand; the host injects the theme via CSS variables (`hostContext.styles.variables`), so the same app adopts any host's look with no re-render. Purely additive — no changes to existing exports. See [PR #12](https://github.com/NimbleBrainInc/synapse/pull/12).

### Added

- `@nimblebrain/synapse/ui` subpath export with a `var(--token, neutral-fallback)` token contract (no brand baked in).
- Primitives: `Stack`, `Inline`, `Spacer`, `Divider`. Typography: `Text`, `Heading`, `Prose`.
- Components: `Avatar`, `Badge`, `Button`, `TextLink`, `Card`, `Drawer` (native `<dialog>`), `EmptyState`, `ListRow`, `Pagination`, `SearchField`, `SegmentedControl`, `Spinner`, `StatusDot`, `Table`.
- Layouts: `AppFrame`, `SidebarLayout` (reflow/drawer), `ListDetailLayout`, plus the `useBreakpoint` hook.
- `@nimblebrain/synapse/ui/fonts` subpath for font wiring.



## [0.8.0] - 2026-04-27

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

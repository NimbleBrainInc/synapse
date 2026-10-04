# @nimblebrain/synapse

[![CI](https://github.com/NimbleBrainInc/synapse/actions/workflows/ci.yml/badge.svg)](https://github.com/NimbleBrainInc/synapse/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@nimblebrain/synapse)](https://www.npmjs.com/package/@nimblebrain/synapse)
[![npm downloads](https://img.shields.io/npm/dm/@nimblebrain/synapse)](https://www.npmjs.com/package/@nimblebrain/synapse)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org/)

Agent-aware app SDK for the [MCP ext-apps](https://modelcontextprotocol.io/specification/2025-06-18/user-interaction/ext-apps) protocol. One `await connect()` and you're live — typed tool calls, reactive data sync, and React hooks that work in any host implementing ext-apps (Claude Desktop, VS Code, ChatGPT, [NimbleBrain](https://nimblebrain.ai), or your own runtime).

## What is Synapse?

Synapse is an optional enhancement layer over `@modelcontextprotocol/ext-apps`. It wraps the ext-apps protocol handshake and adds:

- **Zero-config handshake** — `await connect()` resolves when the host is ready. You never see `ui/initialize`.
- **Typed tool calls** — call MCP tools with full TypeScript input/output types
- **Reactive data sync** — refresh when your server announces its data changed (`notifications/resources/list_changed`)
- **Theme tracking** — automatic light/dark mode and custom design tokens
- **Agent context** — push what the user is looking at to the model with `useModelContext`
- **Keyboard forwarding** — forward shortcuts from sandboxed iframes to the host
- **Code generation** — generate TypeScript types from manifests, running servers, or JSON schemas

Every call checks what the host declared in `ui/initialize`. Where a capability is missing, the call does a documented thing: it sends nothing, it keeps its initial value, or it rejects with `HostCapabilityError` without sending. See [the portable-app contract](https://synapse.nimblebrain.ai/docs/concepts/degradation/).

## Why Synapse?

Raw ext-apps gives you an iframe and postMessage. That works — until the agent changes data and your UI goes stale, or the user filters a view and the agent can't see what they're looking at, or you spend an afternoon wiring up JSON-RPC request tracking for the third time.

Synapse handles the plumbing so you can focus on the UI. See **[Why Synapse?](docs/WHY.md)** for before/after comparisons of each problem it solves.

## Install

```bash
npm install @nimblebrain/synapse
```

**Peer dependencies:** `@modelcontextprotocol/ext-apps@^2.0.0`, `@modelcontextprotocol/client@^2.0.0`, `@modelcontextprotocol/core@^2.0.0` (and `zod@^4.2.0`, which ext-apps requires)

**Building a Python MCP server?** The server half — one self-contained `ui://`
component rendered across ChatGPT, Claude, and NimbleBrain — ships as the
[`nimblebrain-synapse`](python/README.md) PyPI package (`pip install nimblebrain-synapse`).

## Package Exports

| Entry Point | Description |
|-------------|-------------|
| `@nimblebrain/synapse` | Vanilla JS core — `connect()`, plus the helpers over an `App`: `callToolAsTask()`, `action()`, `pickFile()`, `pickFiles()`, `uploadFiles()`, `notify()`, `downloadFile()` |
| `@nimblebrain/synapse/react` | React hooks and the `AppProvider` |
| `@nimblebrain/synapse/ui` | Component library — tokens, primitives, components, layouts |
| `@nimblebrain/synapse/ui/base` | Side-effect import that establishes the root-height chain (`html, body, #root`) the app shell fills. `AppFrame` does this automatically on render; import it in your entry to apply it before first paint |
| `@nimblebrain/synapse/vite` | Vite plugin for dev mode |
| `@nimblebrain/synapse/codegen` | CLI + programmatic code generation |
| `@nimblebrain/synapse/iife` | Pre-built IIFE bundle for `<script>` tags (`window.Synapse`) |

## UI Components (`@nimblebrain/synapse/ui`)

A React component library for embedded Synapse apps: a token contract, layout
primitives (`Stack`, `Inline`, …), components (`Card`, `Badge`, `Drawer`, `ConfirmDialog`,
`Table`, `ListRow`, …), and responsive layout scaffolds (`AppFrame`,
`SidebarLayout`, `ListDetailLayout`). The `gallery/` app is a living reference —
every token and component in light/dark across several themes.

### Design principles

These are the durable decisions behind the library; they rarely change.

- **The library holds no brand.** Tokens are `var(--token, neutral-fallback)`
  references, not hex values. The host injects the real palette at runtime
  (the MCP ext-apps `hostContext.styles.variables`), so the same app adopts
  whatever host it runs in. Standalone, it renders in neutral fallbacks.
- **That includes typography — the SDK ships no fonts.** Font fallbacks are
  web-safe system stacks, so an app renders correctly with no host, no network,
  and no font files. A host that wants its own typeface sends `@font-face`
  CSS in the host context (`styles.css.fonts`); the library fetches nothing on its own. See
  [Host fonts](#host-fonts).
- **Theme via CSS, not React.** Components style with token-driven inline-style
  objects whose values are those `var()` refs, so theming — including light/dark —
  resolves in CSS with no re-render. `ensureStyle` injects keyframes and
  pseudo-state rules once; brand values never get baked in.
- **Scaffold only genuinely-complex layouts.** `AppFrame`, `SidebarLayout`, and
  `ListDetailLayout` exist because they encapsulate real responsive/stateful
  complexity. Boards, grids, and simple lists are primitives + recipes, not
  components — the library codifies the shapes apps actually take, not a general
  layout engine.
- **Responsive to the pane, not the device.** Layouts observe their own width
  (`ResizeObserver` via `useBreakpoint`), because an app's iframe may be
  fullscreen, split, or a narrow rail regardless of screen size.
- **Sandbox-safe overlays.** `Drawer` and `ConfirmDialog` are plain `<div>`
  overlays, not a native `<dialog>`: the app iframe withholds `allow-modals`, so
  `<dialog>.showModal()` throws there. The scrim, Tab focus trap,
  focus-in/restore, scroll-lock, and Escape are hand-rolled once and shared, and
  the innermost open overlay owns Escape and Tab, so a confirmation raised inside
  a drawer closes without closing the drawer.

### Host fonts

A CSS custom property can *name* a font family but cannot *load* one, and an app
iframe is its own document — it inherits no `@font-face` from the host page. So a
host that sends only tokens is naming a typeface the app has no way to render.
The MCP Apps spec closes that gap with `styles.css.fonts`: the host sends
`@font-face` CSS in the host context, and the SDK loads it into the app document.

```ts
// Host side — the hostContext of ui/initialize.
{
  theme: "dark",
  styles: {
    variables: { "--font-sans": "'Your Sans', system-ui, sans-serif" },
    css: {
      fonts: "@font-face { font-family: 'Your Sans'; src: url('/fonts/your-sans.woff2') format('woff2'); font-weight: 400 700; font-display: swap; }",
    },
  },
}
```

Three things worth knowing:

- **Sending no fonts is a supported configuration, not a degraded one.** Omit
  `styles.css.fonts` and the app renders in the web-safe fallbacks (`system-ui` for
  both body and headings, `ui-monospace` for code).
- **Give every `--font-*` token value a web-safe tail.** A bare family name with
  no matching face falls through to the browser default, not to your intended
  stack. `"'Your Sans', system-ui, sans-serif"`, never `"'Your Sans'"`.
- **The URL must satisfy the app iframe's CSP — and `'self'` may not mean what
  you expect.** A host that mounts apps in a `srcdoc` iframe *without*
  `allow-same-origin` (the usual choice, since granting it to third-party app
  HTML is a sandbox escape) gives the frame an **opaque origin**, and CSP
  `'self'` then matches nothing. Under a typical `font-src 'self' data:`, a
  `data:` URI is the only form that works unconditionally; any http(s) URL —
  self-hosted or CDN — needs the host to add that origin to the frame's CSP.
  Check the host's policy before choosing between them.

Faces are applied through the same funnel as the token variables
(`applyTheme`), so a theme change can never leave an app with the host's palette
under the wrong typeface.

## Quick Start

### Vanilla JS

```typescript
import { connect } from "@nimblebrain/synapse";

const app = await connect({ name: "my-app", version: "1.0.0" });

// Theme, host info, and tool context are available immediately
console.log(app.theme.mode); // "dark"
console.log(app.hostInfo);   // { name: "nimblebrain", version: "2.0.0" }

// Subscribe to tool results from the agent
app.on("tool-result", (data) => {
  console.log(data.content); // parsed JSON or raw string
});

// Call an MCP tool
const result = await app.callTool("get_items", { limit: 10 });
console.log(result.data);

// Tell the agent what the user sees
app.updateModelContext(
  { selectedItem: "item-42" },
  "User is viewing item 42",
);
```

### React

```tsx
import { AppProvider, useToolResult, useResize } from "@nimblebrain/synapse/react";

function App() {
  return (
    <AppProvider name="my-app" version="1.0.0">
      <ItemList />
    </AppProvider>
  );
}

function ItemList() {
  const result = useToolResult();
  const resize = useResize();

  useEffect(() => { if (result) resize(); }, [result, resize]);

  if (!result) return <p>Waiting for data...</p>;
  return result.content.items.map((item) => <div key={item.id}>{item.name}</div>);
}
```

### Script Tag (IIFE)

Drop a single `<script>` tag — no bundler required:

```html
<script src="https://unpkg.com/@nimblebrain/synapse/dist/connect.iife.global.js"></script>
<script>
Synapse.connect({ name: "widget", version: "1.0.0", autoResize: true })
  .then(app => {
    app.on("tool-result", (data) => {
      document.getElementById("root").innerHTML = render(data.content);
    });
  });
</script>
```

### Vite Plugin

```typescript
// vite.config.ts
import { synapseVite } from "@nimblebrain/synapse/vite";

export default {
  plugins: [
    synapseVite({
      appName: "my-app",
    }),
  ],
};
```

### Code Generation

Generate TypeScript types from an app manifest:

```bash
npx synapse --from-manifest ./manifest.json --out src/generated/types.ts
```

Or from a running MCP server:

```bash
npx synapse --from-server http://localhost:3000 --out src/generated/types.ts
```

Or from a directory of `.schema.json` files (generates CRUD tool types):

```bash
npx synapse --from-schema ./schemas --out src/generated/types.ts
```

## Handling Events

The `App` object returned by `connect()` uses a unified `on()` method for all events. Each call returns an unsubscribe function.

```typescript
const app = await connect({ name: "my-app", version: "1.0.0" });

// Tool results from the agent (parsed content, not raw JSON-RPC)
const unsub = app.on("tool-result", (data) => {
  console.log(data.content);            // parsed JSON or raw string
  console.log(data.structuredContent);   // structuredContent if host sent it
  console.log(data.raw);                // original params for advanced use
});

// Tool input arguments (what the agent is calling with)
app.on("tool-input", (args) => {
  console.log(args); // Record<string, unknown>
});

// Theme changes
app.on("theme-changed", (theme) => {
  document.body.classList.toggle("dark", theme.mode === "dark");
});

// Lifecycle — clean up when the host tears down the view
app.on("teardown", () => {
  saveState();
});

// Any wire method works as a passthrough event name — here, your server
// announcing that its data changed (which is what useDataSync listens for)
app.on("notifications/resources/list_changed", (params) => {
  refreshData();
});

// Unsubscribe when done
unsub();
```

| `on()` Event | Spec Method | Data |
|---|---|---|
| `"tool-result"` | `ui/notifications/tool-result` | `ToolResultData` (parsed) |
| `"tool-input"` | `ui/notifications/tool-input` | `Record<string, unknown>` |
| `"tool-input-partial"` | `ui/notifications/tool-input-partial` | `Record<string, unknown>` |
| `"tool-cancelled"` | `ui/notifications/tool-cancelled` | — |
| `"theme-changed"` | `ui/notifications/host-context-changed` | `Theme` — fires only when the theme actually moves |
| `"host-context-changed"` | `ui/notifications/host-context-changed` | `McpUiHostContext` — every change, unfiltered |
| `"teardown"` | `ui/resource-teardown` | — |
| Any custom string | Passed through as-is | `unknown` |

## API Reference

### `connect(options)`

The one entry point. Creates a connected `App` instance. The returned promise resolves after the ext-apps handshake completes — theme, host info, and tool context are available immediately.

```typescript
import { connect } from "@nimblebrain/synapse";

const app = await connect({ name: "my-app", version: "1.0.0" });
```

| Option | Type | Description |
|--------|------|-------------|
| `name` | `string` | App name (must match registered bundle name) |
| `version` | `string` | Semver version |
| `autoResize` | `boolean?` | Observe `document.body` and auto-send `size-changed`. Default: `false` |
| `forwardKeys` | `boolean \| KeyForwardConfig[]?` | Forward keyboard shortcuts to the host. Only a NimbleBrain host consumes them, so it stays off elsewhere. |
| `on` | `Record<string, (data) => void>?` | Pre-register handlers before the handshake, so no early message is lost |

### `App` Properties

| Property | Type | Description |
|----------|------|-------------|
| `theme` | `Theme` | Current theme (`mode`, `tokens`) |
| `hostInfo` | `{ name, version }` | Host identity |
| `toolInfo` | `{ tool } \| null` | Tool context if launched from a tool call |
| `containerDimensions` | `Dimensions \| null` | Container size constraints from host |
| `hostContext` | `McpUiHostContext` | The full host context — spec fields plus host extensions |
| `isNimbleBrainHost` | `boolean` | Whether the host identified itself as NimbleBrain |
| `destroyed` | `boolean` | True after `destroy()` |
| `supportsTasks` | `boolean` | Whether the host declared the MCP tasks extension (`io.modelcontextprotocol/tasks`) |

### `App` Methods

| Method | Description |
|--------|-------------|
| `on(event, handler)` | Subscribe to events. Returns unsubscribe function. |
| `resize(width?, height?)` | Send size to host. Auto-measures `document.body` if no args. |
| `openLink(url)` | Open a URL (host-aware) |
| `updateModelContext(state, summary?)` | Push LLM-visible state |
| `callTool(name, args?)` | Call a tool on this app's own MCP server and get a typed result |
| `readServerResource({ uri })` | Read an MCP resource from the originating server |
| `sendMessage(text)` | Send a message into the agent conversation |
| `destroy()` | Clean up all listeners, observers, and timers |

### Helpers over an `App`

The `App` object carries the ext-apps surface and the state the handshake
established. Everything else is a function that takes an app — imported from the
package root — so the object stays small and an app that never picks a file
never carries the picker.

```typescript
import { connect, action, pickFile, downloadFile, callToolAsTask } from "@nimblebrain/synapse";

const app = await connect({ name: "my-app", version: "1.0.0" });
action(app, "openConversation", { id: "conv_abc123" });
```

| Function | Description |
|----------|-------------|
| `callToolAsTask(app, name, args?)` | Call a tool the server may run as a task; returns a `Promise<TaskHandle>`. See [Long-running tools](#long-running-tools-tasks). |
| `action(app, name, params?)` | Trigger a NimbleBrain host action: `openApp` (`{ name }`) or `openConversation` (`{ id }`). No-op unless the host declares `ai.nimblebrain/action`. |
| `pickFile(app, options?)` | Native file picker, single file. Rejects with `HostCapabilityError` unless the host declares `ai.nimblebrain/request-file`. |
| `pickFiles(app, options?)` | Native file picker, multiple files. Rejects with `HostCapabilityError` unless the host declares `ai.nimblebrain/request-file`. |
| `uploadFiles(app, files, options?)` | Store `File`s the app already holds (dropped on it, say), answered like a pick. Rejects with `HostCapabilityError` unless the host declares `ai.nimblebrain/upload-files`. |
| `notify(app, { level, title, description? })` | Ask the host to show the user a notice, labelled with your app. `level` is `success`, `info`, `warning` or `error`; `title` is 1–120 characters, `description` up to 500. Resolves `true` once shown, and `false` without sending unless the host declares `ai.nimblebrain/notify`. Rejects with the host's error when it refuses one. |
| `hostSupports(app, extension)` | Whether the host declared a NimbleBrain extension (`"action"`, `"notify"`, `"requestFile"`, `"uploadFiles"`, `"keydown"`, `"location"`). |
| `downloadFile(app, name, content, mime?)` | Hand the user a file to save, over the spec's `ui/download-file`. Resolves with the host's result — `{ isError: true }` when the host declined or the user cancelled — and rejects, without sending, when the host did not advertise the `downloadFile` capability. |

`app.supportsTasks` says whether the host declared the MCP tasks extension.
`callToolAsTask` throws when it is false, so read it to decide
whether to offer a long-running action at all rather than to discover the answer
from an exception.

A host declares it in
`hostCapabilities.experimental["io.modelcontextprotocol/tasks"]`, the MCP tasks
extension identifier, and nowhere else; presence is the signal, so `{}` is a
declaration. A top-level `hostCapabilities.tasks` is
not read, because a spec client's handshake parse strips it.

## React Hooks

Wrap your tree in `<AppProvider>` — it takes the same options as `connect()` and
renders nothing until the handshake completes, so nothing below it can observe a
half-connected app.

```tsx
import { AppProvider, useApp, useCallTool, useTheme } from "@nimblebrain/synapse/react";
```

| Hook | Returns | Description |
|------|---------|-------------|
| `useApp()` | `App` | The connected app |
| `useTheme()` | `Theme` | Reactive theme. Re-renders only when the theme actually moves. |
| `useHostContext<T>()` | `T` | The full host context, including host extensions |
| `useToolResult()` | `ToolResultData \| null` | Re-renders on every `tool-result` event |
| `useToolInput()` | `Record<string, unknown> \| null` | Re-renders on every `tool-input` event |
| `useResize()` | `(w?, h?) => void` | Resize helper — auto-measures body if no args |
| `useCallTool(name)` | `{ call, data, isPending, error }` | Call a tool with loading/error state |
| `useCallToolAsTask(name)` | `{ fire, task, result, error, isWorking, isTerminal, cancel }` | The full task lifecycle for a long-running tool. See below. |
| `useDataSync(cb)` | — | Run `cb` when your server announces its data changed (`notifications/resources/list_changed`); `cb` gets the notification's params |
| `useModelContext()` | `(state, summary?) => void` | Push LLM-visible state, debounced 250ms |
| `useModelContext(factory, deps)` | — | The same, pushed whenever `deps` change |
| `useSendMessage()` | `(text) => void` | Send a message into the agent conversation |
| `useAction()` | `(name, params?) => void` | Trigger a NimbleBrain host action |
| `useNotify()` | `(notice) => Promise<boolean>` | Show the user a notice through the host, labelled with your app. See `notify` |
| `useFileUpload()` | `{ pickFile, pickFiles, uploadFiles, isPending }` | The host's native file picker, and uploads of files the app holds (NB-only) |

## Long-running tools (tasks)

For tools whose work exceeds the stock MCP request timeout (~60s) — research runs, batch imports, multi-stage analyses — use `callToolAsTask` (or `useCallToolAsTask` in React) instead of `callTool`. It speaks the MCP tasks extension (`io.modelcontextprotocol/tasks`, protocol 2026-07-28): the `tools/call` declares the extension in its `_meta`, and the server either answers with the result or with a task the handle polls through `tasks/get`. A call answered outright gives a handle whose `task` is already `completed`, so there is one code path.

```tsx
import { useCallToolAsTask } from "@nimblebrain/synapse/react";

function ResearchPanel() {
  const { fire, task, result, error, isWorking, isTerminal, cancel } =
    useCallToolAsTask<{ query: string }, { report: string }>("start_research");

  if (!task) return <button onClick={() => fire({ query: "Q2 metrics" })}>Run</button>;
  if (isWorking) return <Spinner onCancel={cancel} status={task.status} />;
  if (error) return <ErrorBox error={error} />;
  return <Report data={result} />;
}
```

**The server decides.** Whether a call runs as a task is the server's choice per call. A server without the tasks extension answers every call outright, and the handle completes at once; to have a slow tool run as a task, the server implements the extension.

**Dual-channel pattern.** When a task creates a domain entity (a research run, an import job), the UI learns the entity exists from the server, **not** from the task result: the server announces the write with `notifications/resources/list_changed`, and `useDataSync` re-reads the list the entity now appears in. The task channel signals "started / running / done / cancelled"; the server's data carries the durable record. UIs that need to navigate to the new entity should re-read on `useDataSync` rather than awaiting `result()`.

**Capability detection.** `callToolAsTask` rejects with `HostCapabilityError`, without sending, on a host that did not declare the extension. Branch on `app.supportsTasks` and fall back to `callTool`:

```typescript
const result = app.supportsTasks
  ? await (await callToolAsTask(app, "start_research", { query })).result()
  : await app.callTool("start_research", { query });
```

**Polling and the end of a task.** `handle.result()` polls `tasks/get` at the task's `pollInterval` (2 s when it names none, never under 250 ms) and resolves the result a completed `tasks/get` carries inline. It rejects with `TaskError` when the task fails (carrying the server's error), is cancelled, or asks for input (`input_required`): Synapse cannot answer an input request, so it cancels the task first. `onStatus` reports the status changes those polls observe; the host pushes none. Pass `result({ signal })` an `AbortSignal` to stop waiting.

**Cancellation.** `handle.cancel()` sends `tasks/cancel` and returns the task from one `tasks/get`. Unmounting a React component, or firing again, stops polling but does **not** cancel the server-side task.

## Development

```bash
npm install
npm run build      # Build ESM + CJS + IIFE
npm test           # Run tests
npm run typecheck  # Type-check
npm run lint       # Lint with Biome
npm run lint:fix   # Auto-fix lint issues
npm run ci         # Run full CI pipeline locally (lint → typecheck → build → test)
```

## Publishing

Publishing uses npm trusted publishing via GitHub Actions. No `npm login` needed.

```bash
# 1. Bump version in package.json
npm version patch   # or minor / major

# 2. Push commit + tag — CI verifies (lint, typecheck, build, test) then publishes
git push origin main --tags
```

The `publish.yml` workflow triggers on `v*` tags. It runs the full CI suite, verifies the tag matches `package.json`, then publishes with `--provenance`.

## License

[MIT](LICENSE)

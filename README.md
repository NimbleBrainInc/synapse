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
- **Reactive data sync** — subscribe to data change events from the agent
- **Theme tracking** — automatic light/dark mode and custom design tokens
- **State store** — Redux-like store with optional persistence and LLM visibility
- **Keyboard forwarding** — forward shortcuts from sandboxed iframes to the host
- **Code generation** — generate TypeScript types from manifests, running servers, or JSON schemas

In non-NimbleBrain hosts (Claude Desktop, VS Code, ChatGPT), NB-specific features degrade gracefully to no-ops while ext-apps baseline behavior is preserved.

## Why Synapse?

Raw ext-apps gives you an iframe and postMessage. That works — until the agent changes data and your UI goes stale, or the user filters a view and the agent can't see what they're looking at, or you spend an afternoon wiring up JSON-RPC request tracking for the third time.

Synapse handles the plumbing so you can focus on the UI. See **[Why Synapse?](docs/WHY.md)** for before/after comparisons of each problem it solves.

## Install

```bash
npm install @nimblebrain/synapse
```

**Peer dependency:** `@modelcontextprotocol/ext-apps@^1.3.1`

**Building a Python MCP server?** The server half — one self-contained `ui://`
component rendered across ChatGPT, Claude, and NimbleBrain — ships as the
[`nimblebrain-synapse`](python/README.md) PyPI package (`pip install nimblebrain-synapse`).

## Package Exports

| Entry Point | Description |
|-------------|-------------|
| `@nimblebrain/synapse` | Vanilla JS core — `connect()`, `createSynapse()`, `createStore()` |
| `@nimblebrain/synapse/react` | React hooks and providers (`AppProvider`, `SynapseProvider`) |
| `@nimblebrain/synapse/ui` | Component library — tokens, primitives, components, layouts |
| `@nimblebrain/synapse/ui/base` | Side-effect import that establishes the root-height chain (`html, body, #root`) the app shell fills. `AppFrame` does this automatically on render; import it in your entry to apply it before first paint |
| `@nimblebrain/synapse/vite` | Vite plugin for dev mode |
| `@nimblebrain/synapse/codegen` | CLI + programmatic code generation |
| `@nimblebrain/synapse/iife` | Pre-built IIFE bundle for `<script>` tags (`window.Synapse`) |

## UI Components (`@nimblebrain/synapse/ui`)

A React component library for embedded Synapse apps: a token contract, layout
primitives (`Stack`, `Inline`, …), components (`Card`, `Badge`, `Drawer`,
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
  descriptors on the theme; the library fetches nothing on its own. See
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
- **Sandbox-safe overlays.** `Drawer` is a plain `<div>` overlay, not a native
  `<dialog>`: the app iframe withholds `allow-modals`, so `<dialog>.showModal()`
  throws there. The scrim, Tab focus trap, focus-in/restore, scroll-lock, and
  Escape are hand-rolled.

### Host fonts

A CSS custom property can *name* a font family but cannot *load* one, and an app
iframe is its own document — it inherits no `@font-face` from the host page. So a
host that sends only tokens is naming a typeface the app has no way to render.
`SynapseTheme.fontFaces` closes that gap: the host sends the faces alongside the
tokens, and the SDK loads them into the app document.

```ts
// Host side — sent as the `synapse/fontFaces` host-context extension.
{
  mode: "dark",
  tokens: { "--font-sans": "'Your Sans', system-ui, sans-serif" },
  fontFaces: [
    { family: "Your Sans", src: "url('/fonts/your-sans.woff2') format('woff2')", weight: "400 700" },
  ],
}
```

| Field | Notes |
|---|---|
| `family` | Must match the family named in the host's `--font-*` token value. |
| `src` | Any CSS `src` descriptor — relative (`url('/fonts/x.woff2')`), absolute (`url('https://cdn.example/x.woff2')`), or `data:`. |
| `weight` | Single weight (`400`) or a variable range (`400 700`). Optional. |
| `style` | `normal`, `italic`, … Optional. |
| `display` | Defaults to `swap`, so text paints in the fallback rather than blocking. Optional. |

Three things worth knowing:

- **Sending no fonts is a supported configuration, not a degraded one.** Omit
  `fontFaces` and the app renders in the web-safe fallbacks (`system-ui`,
  `ui-monospace`, `Georgia`).
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

// NimbleBrain extensions work as passthrough event names
app.on("synapse/data-changed", (params) => {
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
| `"theme-changed"` | `ui/notifications/host-context-changed` | `Theme` |
| `"teardown"` | `ui/resource-teardown` | — |
| Any custom string | Passed through as-is | `unknown` |

## State Store

Create a typed, reactive store with optional persistence and agent visibility:

```typescript
import { createSynapse, createStore } from "@nimblebrain/synapse";

const synapse = createSynapse({ name: "my-app", version: "1.0.0" });

const store = createStore(synapse, {
  initialState: { count: 0, items: [] },
  actions: {
    increment: (state) => ({ ...state, count: state.count + 1 }),
    addItem: (state, item: string) => ({
      ...state,
      items: [...state.items, item],
    }),
  },
  persist: true,
  visibleToAgent: true,
  summarize: (state) => `${state.items.length} items, count=${state.count}`,
});

store.dispatch.increment();
store.dispatch.addItem("hello");
```

Use `useStore` in React:

```tsx
import { useStore } from "@nimblebrain/synapse/react";

function Counter() {
  const { state, dispatch } = useStore(store);
  return <button onClick={() => dispatch.increment()}>{state.count}</button>;
}
```

## API Reference

### `connect(options)` — Recommended

Creates a connected `App` instance. The returned promise resolves after the ext-apps handshake completes — theme, host info, and tool context are available immediately.

```typescript
import { connect } from "@nimblebrain/synapse";

const app = await connect({ name: "my-app", version: "1.0.0" });
```

| Option | Type | Description |
|--------|------|-------------|
| `name` | `string` | App name (must match registered bundle name) |
| `version` | `string` | Semver version |
| `autoResize` | `boolean?` | Observe `document.body` and auto-send `size-changed`. Default: `false` |

### `App` Properties

| Property | Type | Description |
|----------|------|-------------|
| `theme` | `Theme` | Current theme (`mode`, `tokens`) |
| `hostInfo` | `{ name, version }` | Host identity |
| `toolInfo` | `{ tool } \| null` | Tool context if launched from a tool call |
| `containerDimensions` | `Dimensions \| null` | Container size constraints from host |

### `App` Methods

| Method | Description |
|--------|-------------|
| `on(event, handler)` | Subscribe to events. Returns unsubscribe function. |
| `resize(width?, height?)` | Send size to host. Auto-measures `document.body` if no args. |
| `openLink(url)` | Open a URL (host-aware) |
| `updateModelContext(state, summary?)` | Push LLM-visible state |
| `callTool(name, args?)` | Call an MCP tool and get typed result |
| `sendMessage(text, context?)` | Send a chat message to the agent |
| `destroy()` | Clean up all listeners, observers, and timers |

### `createSynapse(options)` — Advanced / Legacy

The original Synapse API. Still fully supported — use it when you need the state store, agent actions, file operations, or NimbleBrain-specific features not yet surfaced in `connect()`.

```typescript
import { createSynapse } from "@nimblebrain/synapse";

const synapse = createSynapse({ name: "my-app", version: "1.0.0" });
await synapse.ready;
```

| Option | Type | Description |
|--------|------|-------------|
| `name` | `string` | App name (must match registered bundle name) |
| `version` | `string` | Semver version |
| `internal` | `boolean?` | Enable cross-server tool calls (NB internal only) |
| `forwardKeys` | `KeyForwardConfig[]?` | Custom keyboard forwarding rules |

### `Synapse` Methods

| Method | Description |
|--------|-------------|
| `ready` | Promise that resolves after the ext-apps handshake |
| `isNimbleBrainHost` | Whether the host is a NimbleBrain platform |
| `callTool(name, args?)` | Call an MCP tool and get typed result |
| `callToolAsTask(name, args?, opts?)` | Call a long-running tool task-augmented; returns a `Promise<TaskHandle>`. See [Long-running tools](#long-running-tools-tasks) below. |
| `onDataChanged(cb)` | Subscribe to data change events |
| `onAction(cb)` | Subscribe to agent actions (typed, declarative) |
| `getTheme()` | Get current theme |
| `onThemeChanged(cb)` | Subscribe to theme changes |
| `action(name, params?)` | Dispatch a NB platform action |
| `chat(message, context?)` | Send a chat message to the agent |
| `setVisibleState(state, summary?)` | Push LLM-visible state (debounced 250ms) |
| `downloadFile(name, content, mime?)` | Trigger a file download (NB-only) |
| `pickFile(options?)` | Open native file picker, single file (NB-only) |
| `pickFiles(options?)` | Open native file picker, multiple files (NB-only) |
| `openLink(url)` | Open a URL (host-aware) |
| `destroy()` | Clean up all listeners and timers |

`Synapse` also exposes `_hostTasksCapability: TasksCapability | undefined | null` — the host's declared `tasks` capability from `ui/initialize`. `null` pre-handshake, `undefined` if the host did not advertise tasks, or the `TasksCapability` shape if it did. Read it to feature-detect before calling `callToolAsTask`.

## React Hooks

### `AppProvider`-based (Recommended)

Wrap your app with `<AppProvider>` and use these hooks. Each is a thin wrapper over `connect()`.

```tsx
import { AppProvider, useApp, useToolResult, useToolInput, useResize } from "@nimblebrain/synapse/react";
```

| Hook | Returns | Description |
|------|---------|-------------|
| `useApp()` | `App` | Access the connected `App` instance |
| `useToolResult()` | `ToolResultData \| null` | Re-renders on every `tool-result` event |
| `useToolInput()` | `Record<string, unknown> \| null` | Re-renders on every `tool-input` event |
| `useConnectTheme()` | `Theme` | Reactive theme from `connect()` |
| `useResize()` | `(w?, h?) => void` | Resize helper — auto-measures body if no args |

To call a tool on this path, use the `App` instance: `useApp()`, then `app.callTool(name, args)`. The `useCallTool` hook (with built-in loading state) belongs to the `SynapseProvider` set below.

### `SynapseProvider`-based (Legacy)

For existing apps using `createSynapse()`. Still fully supported.

```tsx
import { SynapseProvider, useSynapse, useCallTool, useTheme } from "@nimblebrain/synapse/react";
```

| Hook | Returns | Description |
|------|---------|-------------|
| `useSynapse()` | `Synapse` | Access the Synapse instance |
| `useCallTool(name)` | `{ call, data, isPending, error }` | Call a tool with loading/error state |
| `useDataSync(cb)` | — | Subscribe to data change events |
| `useTheme()` | `SynapseTheme` | Reactive theme object |
| `useAction()` | `(name, params?) => void` | Dispatch platform actions |
| `useAgentAction(cb)` | — | Subscribe to agent actions |
| `useChat()` | `(msg, ctx?) => void` | Send chat messages |
| `useVisibleState()` | `(state, summary?) => void` | Push LLM-visible state |
| `useFileUpload()` | File picker helpers | File upload (NB-only) |
| `useStore(store)` | `{ state, dispatch }` | Bind a store to React |
| `useCallToolAsTask(name)` | `{ fire, task, result, error, isWorking, isTerminal, cancel }` | Lifecycle wrapper around `callToolAsTask` for long-running tools. See below. |

## Long-running tools (tasks)

For tools whose work exceeds the stock MCP request timeout (~60s) — research runs, batch imports, multi-stage analyses — use `callToolAsTask` (or `useCallToolAsTask` in React) instead of `callTool`. The host returns a `CreateTaskResult` immediately; the actual `CallToolResult` is fetched via `tasks/result` when the task reaches a terminal state.

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

**Authoring task-aware tools.** The server side declares `execution.taskSupport: "optional"` (or `"required"`) on the tool's `tools/list` entry. With FastMCP (Python):

```python
from fastmcp.server.tasks import TaskConfig

@mcp.tool(task=TaskConfig(mode="optional"))
async def start_research(query: str, ctx: Context) -> dict:
    ...
```

`mode="optional"` lets the same tool run inline (`callTool`) or as a task (`callToolAsTask`) — the client decides. `mode="required"` rejects non-task calls with JSON-RPC `-32601`.

**Dual-channel pattern.** When a task creates a domain entity (a research run, an import job), the entity ID is delivered via `synapse/data-changed` / `useDataSync`, **not** the task result. The task channel signals "started / running / done / cancelled"; the entity channel carries the durable record. UIs that need to navigate to the new entity should listen on `useDataSync` rather than awaiting `result()`.

**Capability detection.** Hosts that don't support tasks won't advertise the `tasks.requests.tools.call` capability. `callToolAsTask` throws on hosts without the capability — wrap in a try/catch and fall back to `callTool` if you want graceful degradation:

```typescript
try {
  const handle = await synapse.callToolAsTask("start_research", { query });
  // ...task-aware UI
} catch (err) {
  if (String(err).includes("tasks.requests.tools.call")) {
    // Legacy host — fall back to a blocking call.
    const result = await synapse.callTool("start_research", { query });
  } else {
    throw err;
  }
}
```

**Status notifications are optional.** Per spec, hosts MAY emit `notifications/tasks/status` but consumers MUST NOT rely on them. `useCallToolAsTask` polls `tasks/get` as a fallback (using `pollInterval × 1.5` from the initial `Task`, defaulting to ~7.5s). Polling stops automatically on terminal status, on `result()` settling, or after 5 consecutive refresh failures.

**Cancellation.** `handle.cancel()` issues `tasks/cancel`. Cancelling an already-terminal task surfaces a `-32602` error from the host. Unmounting a React component does **not** cancel the server-side task — the task continues, and the user can re-fire to recover state.

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

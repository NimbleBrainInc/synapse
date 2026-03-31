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

## Package Exports

| Entry Point | Description |
|-------------|-------------|
| `@nimblebrain/synapse` | Vanilla JS core — `connect()`, `createSynapse()`, `createStore()` |
| `@nimblebrain/synapse/react` | React hooks and providers (`AppProvider`, `SynapseProvider`) |
| `@nimblebrain/synapse/vite` | Vite plugin for dev mode |
| `@nimblebrain/synapse/codegen` | CLI + programmatic code generation |
| `@nimblebrain/synapse/iife` | Pre-built IIFE bundle for `<script>` tags (`window.Synapse`) |

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
import { AppProvider, useToolResult, useCallTool, useResize } from "@nimblebrain/synapse/react";

function App() {
  return (
    <AppProvider name="my-app" version="1.0.0">
      <ItemList />
    </AppProvider>
  );
}

function ItemList() {
  const result = useToolResult();
  const { call, data, isPending } = useCallTool("list_items");
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
| `onDataChanged(cb)` | Subscribe to data change events |
| `onAction(cb)` | Subscribe to agent actions (typed, declarative) |
| `getTheme()` | Get current theme |
| `onThemeChanged(cb)` | Subscribe to theme changes |
| `action(name, params?)` | Dispatch a NB platform action |
| `chat(message, context?)` | Send a chat message to the agent |
| `setVisibleState(state, summary?)` | Push LLM-visible state (debounced 250ms) |
| `saveFile(name, content, mime?)` | Trigger a file save (NB-only) |
| `pickFile(options?)` | Open native file picker, single file (NB-only) |
| `pickFiles(options?)` | Open native file picker, multiple files (NB-only) |
| `openLink(url)` | Open a URL (host-aware) |
| `destroy()` | Clean up all listeners and timers |

## React Hooks

### `AppProvider`-based (Recommended)

Wrap your app with `<AppProvider>` and use these hooks. Each is a thin wrapper over `connect()`.

```tsx
import { AppProvider, useApp, useToolResult, useToolInput, useResize, useCallTool } from "@nimblebrain/synapse/react";
```

| Hook | Returns | Description |
|------|---------|-------------|
| `useApp()` | `App` | Access the connected `App` instance |
| `useToolResult()` | `ToolResultData \| null` | Re-renders on every `tool-result` event |
| `useToolInput()` | `Record<string, unknown> \| null` | Re-renders on every `tool-input` event |
| `useConnectTheme()` | `Theme` | Reactive theme from `connect()` |
| `useResize()` | `(w?, h?) => void` | Resize helper — auto-measures body if no args |
| `useCallTool(name)` | `{ call, data, isPending, error }` | Call a tool with loading/error state |

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

Requires npm login with access to the `@nimblebrain` org.

```bash
# First time: log in to npm
npm login

# Bump version (updates package.json and creates a git tag)
npm version patch   # or minor / major

# Publish (build runs automatically via prepublishOnly)
npm publish --access public

# Push the version tag
git push origin main --tags
```

## License

[MIT](LICENSE)

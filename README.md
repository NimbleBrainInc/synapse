# @nimblebrain/synapse

[![CI](https://github.com/NimbleBrainInc/synapse/actions/workflows/ci.yml/badge.svg)](https://github.com/NimbleBrainInc/synapse/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@nimblebrain/synapse)](https://www.npmjs.com/package/@nimblebrain/synapse)
[![npm downloads](https://img.shields.io/npm/dm/@nimblebrain/synapse)](https://www.npmjs.com/package/@nimblebrain/synapse)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org/)

Agent-aware app SDK for the [NimbleBrain](https://nimblebrain.ai) platform. Typed tool calls, reactive state, and React hooks over the [MCP ext-apps](https://modelcontextprotocol.io/specification/2025-06-18/user-interaction/ext-apps) protocol.

## What is Synapse?

Synapse is an optional enhancement layer over `@modelcontextprotocol/ext-apps`. It wraps the ext-apps protocol handshake and adds:

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
| `@nimblebrain/synapse` | Vanilla JS core (no framework dependency) |
| `@nimblebrain/synapse/react` | React hooks and provider |
| `@nimblebrain/synapse/vite` | Vite plugin for dev mode |
| `@nimblebrain/synapse/codegen` | CLI + programmatic code generation |

## Quick Start

### Vanilla JS

```typescript
import { createSynapse } from "@nimblebrain/synapse";

const synapse = createSynapse({
  name: "my-app",
  version: "1.0.0",
});

await synapse.ready;

// Call an MCP tool
const result = await synapse.callTool("get_items", { limit: 10 });
console.log(result.data);

// React to data changes from the agent
synapse.onDataChanged((event) => {
  console.log(`${event.tool} was called on ${event.server}`);
});

// Push state visible to the LLM
synapse.setVisibleState(
  { selectedItem: "item-42" },
  "User is viewing item 42",
);
```

### React

```tsx
import { SynapseProvider, useCallTool, useTheme } from "@nimblebrain/synapse/react";

function App() {
  return (
    <SynapseProvider name="my-app" version="1.0.0">
      <ItemList />
    </SynapseProvider>
  );
}

function ItemList() {
  const { call, data, isPending } = useCallTool<Item[]>("list_items");
  const theme = useTheme();

  return (
    <div style={{ colorScheme: theme.mode }}>
      <button onClick={() => call()} disabled={isPending}>
        Load Items
      </button>
      {data?.map((item) => <div key={item.id}>{item.name}</div>)}
    </div>
  );
}
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

### `createSynapse(options)`

Creates a Synapse instance. Returns a `Synapse` object.

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
| `getTheme()` | Get current theme |
| `onThemeChanged(cb)` | Subscribe to theme changes |
| `action(name, params?)` | Dispatch a NB platform action |
| `chat(message, context?)` | Send a chat message to the agent |
| `setVisibleState(state, summary?)` | Push LLM-visible state (debounced 250ms) |
| `downloadFile(name, content, mime?)` | Trigger a file download |
| `openLink(url)` | Open a URL (host-aware) |
| `destroy()` | Clean up all listeners and timers |

### React Hooks

| Hook | Description |
|------|-------------|
| `useSynapse()` | Access the Synapse instance |
| `useCallTool(name)` | `{ call, data, isPending, error }` for a tool |
| `useDataSync(cb)` | Subscribe to data change events |
| `useTheme()` | Reactive theme object |
| `useAction()` | Dispatch platform actions |
| `useChat()` | Send chat messages |
| `useVisibleState()` | Push LLM-visible state |
| `useStore(store)` | `{ state, dispatch }` for a store |

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

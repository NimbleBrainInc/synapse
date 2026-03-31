# RFC: `Synapse.connect()` — MCP Apps Client

## Problem

Every MCP App widget hand-rolls the MCP Apps protocol. The handshake is 4 messages in a specific order, content parsing has 3 formats, and resize needs to fire at the right time. We shipped 15 broken versions of a speaker widget because the protocol layer kept breaking while the rendering was fine.

The protocol and rendering are separate concerns. The SDK should own the protocol.

## Design Principles

1. **One interface that scales.** Simple widget → full app. No "which SDK do I pick" decision.
2. **The handshake is invisible.** `await connect()` resolves when ready. Developer never sees `ui/initialize`.
3. **Parsed data, not raw messages.** `on("tool-result")` delivers parsed objects, not JSON-RPC frames.
4. **Framework-agnostic core.** Vanilla JS runtime. React hooks are a wrapper, not the foundation.
5. **Impossible to get the handshake wrong.** The most common bug class is eliminated by construction.
6. **Emit everything, gate nothing.** No host detection. If a message arrives, fire the handler. If nobody's listening, it's a no-op.

## API

### Core: `Synapse.connect(options)`

```typescript
interface ConnectOptions {
  name: string;
  version: string;
  autoResize?: boolean;  // default: false — observe document.body and auto-send size-changed
}

interface App {
  // Context (available immediately after connect resolves)
  readonly theme: Theme;
  readonly hostInfo: { name: string; version: string };
  readonly toolInfo: { tool: Tool } | null;
  readonly containerDimensions: Dimensions | null;

  // Events — subscribe, returns unsubscribe function
  on(event: "tool-input", handler: (args: Record<string, unknown>) => void): () => void;
  on(event: "tool-result", handler: (data: ToolResultData) => void): () => void;
  on(event: "theme-changed", handler: (theme: Theme) => void): () => void;
  on(event: "teardown", handler: () => void): () => void;
  on(event: string, handler: (params: unknown) => void): () => void;  // any custom event

  // Actions
  resize(width?: number, height?: number): void;  // auto-measures document.body if no args
  openLink(url: string): void;
  updateModelContext(state: Record<string, unknown>, summary?: string): void;

  // Full app (progressive — only use if you need them)
  callTool(name: string, args?: Record<string, unknown>): Promise<ToolCallResult>;
  sendMessage(text: string, context?: { action?: string; entity?: string }): void;

  // Lifecycle
  destroy(): void;
}
```

### Types

```typescript
interface ToolResultData {
  content: unknown;              // parsed text content (JSON-parsed if valid, raw string otherwise)
  structuredContent: unknown;    // structuredContent if host sent it, null otherwise
  raw: ToolResultParams;         // original params for advanced use
}

interface Theme {
  mode: "light" | "dark";
  tokens: Record<string, string>;
}

interface Dimensions {
  width?: number;
  height?: number;
  maxWidth?: number;
  maxHeight?: number;
}

interface ToolCallResult<T = unknown> {
  data: T;
  isError: boolean;
}
```

### Usage: Simple Widget (vanilla JS)

```html
<script src="synapse.js"></script>
<div id="root">Loading...</div>
<script>
  Synapse.connect({
    name: "speaker-widget",
    version: "1.0.0",
    autoResize: true,
  }).then(app => {

    app.on("tool-result", (data) => {
      document.getElementById("root").innerHTML = renderSpeakers(data.content.results);
    });

  });

  function renderSpeakers(speakers) { /* ... */ }
</script>
```

No handshake code. No resize code. No content parsing. Just "give me the data, I'll render it."

### Usage: Full App (React)

```tsx
import { AppProvider, useToolResult, useTheme, useResize, useCallTool } from "@nimblebrain/synapse/react";

function SpeakerWidget() {
  const result = useToolResult();
  const theme = useTheme();
  const resize = useResize();

  useEffect(() => { if (result) resize(); }, [result, resize]);

  if (!result) return <p>Loading...</p>;
  return result.content.results.map(sp => <SpeakerCard key={sp.id} speaker={sp} />);
}

function ScheduleDashboard() {
  const { call, data, isPending } = useCallTool("get_day_schedule");

  useEffect(() => { call({ day: "2026-04-02" }); }, []);

  if (isPending) return <Skeleton />;
  return <ScheduleGrid slots={data.time_slots} />;
}

export default () => (
  <AppProvider name="mcp-dev-summit" version="1.0.0">
    <SpeakerWidget />
  </AppProvider>
);
```

## React Hooks

All hooks require `<AppProvider>` ancestor. Each is a thin wrapper over `connect()`.

| Hook | Returns | Subscribes to |
|------|---------|---------------|
| `useApp()` | `App` object | — |
| `useToolResult()` | `ToolResultData \| null` | `tool-result` event |
| `useToolInput()` | `Record<string, unknown> \| null` | `tool-input` event |
| `useTheme()` | `Theme` | `theme-changed` event |
| `useResize()` | `(w?, h?) => void` | — |
| `useCallTool(name)` | `{ call, data, isPending, error }` | — (existing, unchanged) |
| `useChat()` | `(msg, ctx?) => void` | — (existing, unchanged) |
| `useDataSync(cb)` | — | data-changed events |

`useToolResult`, `useToolInput`, `useResize`, and `useApp` are new. Everything else exists today.

`useToolResult()` re-renders on every `tool-result` event. React's reconciliation handles deduplication — no custom deep-equality needed.

## What `connect()` Does Internally

```
1. Set up message listener (window.addEventListener)
2. Send ui/notifications/size-changed (initial size from document.body)
3. Send ui/initialize request (JSON-RPC with auto-generated ID)
4. Wait for host response (Promise)
5. Extract theme, hostInfo, toolInfo, containerDimensions from hostContext
6. Inject host CSS variables into document.documentElement (theming)
7. Send ui/notifications/initialized
8. If autoResize: attach ResizeObserver on document.body
9. Subscribe to theme-changed — re-inject CSS variables on update
10. Resolve the promise with the App object
11. Route ALL incoming notifications to registered handlers by method name
```

Steps 2-7 are the exact handshake that broke 15 times. After this, it's written once.

## Theming

`connect()` owns theming. Widgets don't.

**How it works:**

1. The host sends `hostContext.styles.variables` in the `ui/initialize` response — a `Record<string, string>` of CSS custom properties (e.g., `{"--color-text-primary": "#1e293b"}`).
2. `connect()` applies them to `document.documentElement.style` immediately after handshake.
3. On `ui/notifications/host-context-changed`, `connect()` re-applies updated variables.
4. Widget CSS uses `var(--token, fallback)`. Host values always win. Fallbacks are a safety net for hosts that send nothing.

```javascript
// Inside connect(), after init response:
const vars = hostContext?.styles?.variables;
if (vars) {
  for (const [k, v] of Object.entries(vars)) {
    document.documentElement.style.setProperty(k, v);
  }
}

// On theme-changed:
app.on("theme-changed", () => {
  // Same injection — connect() handles this internally
});
```

**What this means for widget developers:**

- Use CSS custom properties with fallbacks: `color: var(--color-text-primary, #e2e8f0)`
- Never hardcode colors. Never detect light/dark mode. Never write `:root` theme blocks.
- The host decides the theme. `connect()` delivers it. Your CSS inherits it.

**Token contract:**

Widgets should use these standard tokens. Hosts that want consistent rendering should provide them:

| Token | Purpose | Dark fallback | Light fallback |
|---|---|---|---|
| `--color-text-primary` | Main text | `#e2e8f0` | `#1e293b` |
| `--color-text-secondary` | Supporting text | `#94a3b8` | `#475569` |
| `--color-text-tertiary` | Muted text | `#64748b` | `#94a3b8` |
| `--color-text-accent` | Links, highlights | `#818cf8` | `#6366f1` |
| `--color-background-tertiary` | Cards, tags | `#1e293b` | `#f1f5f9` |
| `--color-border-primary` | Borders, dividers | `#334155` | `#e2e8f0` |
| `--font-weight-semibold` | Headings | `600` | `600` |
| `--font-text-xs-size` | Small text | `12px` | `12px` |
| `--font-text-sm-size` | Body text | `13px` | `13px` |
| `--border-radius-xs` | Tag/badge radius | `4px` | `4px` |
| `--border-width-regular` | Border width | `1px` | `1px` |
| `--font-sans` | Font family | system stack | system stack |

Widgets pick ONE set of fallbacks (dark or light — dark is recommended since most AI hosts default dark). The host overrides all of them if it has a design system. If the host sends nothing, fallbacks ensure the widget is still readable.

Step 9: **no filtering, no gating.** Any `{method: "...", params: {...}}` message fires the handler registered for that method. The `on()` method maps event names to method names:

| `on()` event | Matches method |
|---|---|
| `"tool-result"` | `ui/notifications/tool-result` |
| `"tool-input"` | `ui/notifications/tool-input` |
| `"theme-changed"` | `ui/notifications/host-context-changed` |
| `"teardown"` | `ui/resource-teardown` |
| Any custom string | Passed through as-is (e.g., `"synapse/data-changed"`) |

Short names for spec events. Passthrough for extensions. No host detection needed.

## Content Parsing

The `tool-result` handler receives parsed data. The parsing logic (centralized, tested once):

```
1. If params.structuredContent exists → content = structuredContent
2. Else if params.content is array of {type:"text", text} → join texts, try JSON.parse
3. Else if params.content is string → try JSON.parse
4. If JSON.parse fails in steps 2-3 → deliver raw string
5. Return { content: parsed, structuredContent: params.structuredContent, raw: params }
```

## `resize()` Behavior

**Manual mode** (default, `autoResize: false`):
```
app.resize()        → measures document.body.scrollHeight, sends size-changed
app.resize(w, h)    → sends exact dimensions
```

**Auto mode** (`autoResize: true`):
- Attaches `ResizeObserver` on `document.body`
- On every observed resize, sends `size-changed` with current body dimensions
- Debounced (16ms / one animation frame) to avoid flooding
- `app.resize(w, h)` still works for explicit overrides
- `app.destroy()` disconnects the observer

Auto mode is the right default for simple widgets. Complex apps that animate or lazy-load should use manual.

## Spec Alignment

### What's in the MCP Apps spec that `connect()` implements

| Spec feature | `connect()` API |
|---|---|
| `ui/initialize` handshake | Handled internally by `connect()` |
| `ui/notifications/initialized` | Sent after host responds |
| `ui/notifications/tool-input` | `on("tool-input")` |
| `ui/notifications/tool-input-partial` | `on("tool-input-partial")` |
| `ui/notifications/tool-result` | `on("tool-result")` with parsed data |
| `ui/notifications/tool-cancelled` | `on("tool-cancelled")` |
| `ui/notifications/host-context-changed` | `on("theme-changed")` for theme; raw available via passthrough |
| `ui/notifications/size-changed` | `app.resize()` or `autoResize` |
| `ui/open-link` | `app.openLink(url)` |
| `ui/message` | `app.sendMessage(text, ctx)` |
| `ui/update-model-context` | `app.updateModelContext(state, summary)` |
| `ui/request-display-mode` | `app.requestDisplayMode(mode)` (future) |
| `ui/resource-teardown` | `on("teardown")` |
| `tools/call` (from view) | `app.callTool(name, args)` |
| `resources/read` (from view) | `app.readResource(uri)` (future) |

### Synapse extensions (beyond spec)

These are NimbleBrain-specific events. `connect()` doesn't special-case them — they flow through the generic `on()` handler like any other message.

| Extension | Usage |
|---|---|
| `synapse/data-changed` | `app.on("synapse/data-changed", cb)` |
| `synapse/action` | `app.on("synapse/action", cb)` |
| `synapse/save-file` | `app.saveFile(name, data, mime)` |
| `synapse/pick-file` | `app.pickFile(opts)` / `app.pickFiles(opts)` |
| `synapse/keydown` | Forwarded automatically (keyboard shortcuts) |

`synapse/theme-changed` is **removed** — redundant with the spec's `host-context-changed`.

## Package Structure

```
@nimblebrain/synapse
├── dist/
│   ├── connect.iife.js     ← 2-3KB, vanilla JS, window.Synapse global
│   ├── connect.esm.js      ← ES module for bundlers
│   ├── react/index.js      ← React hooks (AppProvider, useToolResult, etc.)
│   └── react/index.d.ts    ← TypeScript types
├── package.json
│   exports:
│     ".":        → connect.esm.js       (import Synapse from "@nimblebrain/synapse")
│     "./react":  → react/index.js       (import { useToolResult } from "@nimblebrain/synapse/react")
│     "./iife":   → connect.iife.js      (for <script> tags)
```

The existing `createSynapse()` and `SynapseProvider` remain as thin wrappers over `connect()` for backwards compatibility.

## Migration

### Existing Synapse React apps (sidebar dashboards)

No changes required. `SynapseProvider` + existing hooks continue to work. New hooks are additive.

### Hand-rolled widgets → `connect()`

Before (50+ lines of protocol code per widget):
```javascript
window.parent.postMessage({jsonrpc:'2.0',id:'__init',method:'ui/initialize',...},'*');
window.addEventListener('message', function(e) {
  if (e.data.id === '__init') {
    window.parent.postMessage({jsonrpc:'2.0',method:'ui/notifications/initialized',...},'*');
    resize();
  }
  if (e.data.method === 'ui/notifications/tool-result') {
    var content = e.data.params && e.data.params.content;
    // ... 15 lines of parsing ...
    render(parsed);
  }
});
resize();
```

After:
```javascript
Synapse.connect({ name: "widget", version: "1.0.0", autoResize: true }).then(app => {
  app.on("tool-result", (data) => render(data.content));
});
```

## What This Eliminates

| Bug class | Occurrences this session | How eliminated |
|---|---|---|
| Handshake ordering | 5 widgets × multiple versions | `connect()` owns it |
| Missing initial resize | 1 (blank screen) | `connect()` sends initial size at step 2 |
| Wrong content parsing | 3 iterations | Centralized in `ToolResultData` |
| Wrong field name (`capabilities` vs `appCapabilities`) | 2 iterations | `connect()` sends the right one |
| Missing `return` in tool function | 1 | `useToolResult()` makes null data immediately visible |
| Race conditions (server-side rendering attempts) | 4 versions | Eliminated — client-side rendering via events |

## Decisions Made

1. **`autoResize` defaults to `false`.** Simple widgets opt in. Complex apps keep control.
2. **Global is `window.Synapse`.** No known conflicts. Clean name wins.
3. **`useToolResult()` re-renders on every event.** React reconciles. No custom equality.
4. **`resize()` with no args measures `document.body`.** KISS. No root element parameter.
5. **No host detection.** Events flow through. Extensions are just event names.
6. **`synapse/theme-changed` dropped.** Redundant with spec's `host-context-changed`.

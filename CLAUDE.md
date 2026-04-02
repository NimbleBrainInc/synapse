# @nimblebrain/synapse

Agent-aware app SDK for the MCP ext-apps protocol (2026-01-26).

## Verification

```bash
npm run ci    # lint → typecheck → build → test (234 tests)
```

**Run `npm run ci` before declaring any change complete. No exceptions.**

## Hard Rules

1. **Never hand-type a method string.** Import constants from `@modelcontextprotocol/ext-apps`:
   ```typescript
   // WRONG — silent drift, undetectable at compile time
   transport.send("ui/initialize", params);
   
   // RIGHT — rename in spec → compile error
   import { INITIALIZE_METHOD } from "@modelcontextprotocol/ext-apps";
   transport.send(INITIALIZE_METHOD, params);
   ```

2. **Never hand-type message param shapes.** Use spec types to constrain params:
   ```typescript
   // WRONG — "clientInfo" typo shipped to production, caught only by manual testing
   const params = { clientInfo: { name, version }, capabilities: {} };
   
   // RIGHT — tsc rejects "clientInfo" immediately
   const params: McpUiInitializeRequest["params"] = {
     appInfo: { name, version },
     appCapabilities: {},
     protocolVersion: LATEST_PROTOCOL_VERSION,
   };
   ```

3. **Never use `as any` for content blocks.** `TextContent` from `@modelcontextprotocol/sdk/types.js` already has `_meta?: { [key: string]: unknown }`.

4. **Never weaken `__tests__/spec-compliance.test.ts`.** It enforces wire-format correctness at both compile time and runtime. If a test fails, fix the code, not the test.

5. **Test helpers must use spec field names.** `hostInfo` not `serverInfo`. `hostCapabilities` not `capabilities`. `hostContext.theme` is a string (`"dark"`), not an object. Tokens are at `hostContext.styles.variables`, not `hostContext.theme.tokens`.

## Where spec types are used

| File | Types |
|------|-------|
| `connect.ts` | `McpUiInitializeRequest`, `McpUiInitializeResult`, `McpUiHostContext`, `McpUiMessageRequest`, `McpUiOpenLinkRequest`, `McpUiUpdateModelContextRequest`, `TextContent`, `CallToolRequest` |
| `core.ts` | Same init types plus `McpUiHostContextChangedNotification` |
| `event-map.ts` | All `*_METHOD` constants |
| `detection.ts` | `McpUiInitializeResult`, `McpUiHostContext` |

## Two connection paths

- **`connect(options)`** — Async, returns `App`. Standalone widgets (mcp-dev-summit). Supports `options.on` for pre-registering handlers before `initialized`.
- **`createSynapse(options)`** — Sync, returns `Synapse` with `.ready`. NimbleBrain platform apps. Richer API (actions, file ops, visible state).

Both follow: size → `ui/initialize` request → await response → register handlers → `ui/notifications/initialized`.

## NimbleBrain extensions (`synapse/` prefix)

No spec equivalent — degrade to no-ops in other hosts:

`synapse/action`, `synapse/data-changed`, `synapse/persist-state`, `synapse/state-loaded`, `synapse/download-file`, `synapse/keydown`, `synapse/request-file`

## IIFE build for MCP server widgets

MCP servers embed synapse as a `<script>` in widget HTML. Build with esbuild + shims to avoid bundling Zod (~11KB vs ~400KB):

```bash
# Create entry
cat > src/_iife-entry.ts << 'EOF'
import { connect } from "./connect.ts";
import { createSynapse } from "./core.ts";
import { createStore } from "./store.ts";
(globalThis as any).Synapse = { connect, createSynapse, createStore };
EOF

# Create lightweight shim (string constants only, no Zod)
mkdir -p src/_shims
cat > src/_shims/ext-apps.ts << 'SHIM'
export const LATEST_PROTOCOL_VERSION = "2026-01-26";
export const INITIALIZE_METHOD = "ui/initialize";
export const INITIALIZED_METHOD = "ui/notifications/initialized";
export const OPEN_LINK_METHOD = "ui/open-link";
export const MESSAGE_METHOD = "ui/message";
export const SIZE_CHANGED_METHOD = "ui/notifications/size-changed";
export const TOOL_INPUT_METHOD = "ui/notifications/tool-input";
export const TOOL_INPUT_PARTIAL_METHOD = "ui/notifications/tool-input-partial";
export const TOOL_RESULT_METHOD = "ui/notifications/tool-result";
export const TOOL_CANCELLED_METHOD = "ui/notifications/tool-cancelled";
export const HOST_CONTEXT_CHANGED_METHOD = "ui/notifications/host-context-changed";
export const REQUEST_TEARDOWN_METHOD = "ui/notifications/request-teardown";
export const RESOURCE_TEARDOWN_METHOD = "ui/resource-teardown";
SHIM

# Build
bunx esbuild src/_iife-entry.ts \
  --bundle --format=iife --minify \
  --alias:@modelcontextprotocol/ext-apps=./src/_shims/ext-apps.ts \
  --alias:@modelcontextprotocol/sdk/types.js=./src/_shims/ext-apps.ts \
  --external:react --platform=browser \
  --outfile=<target>

# Clean up
rm -rf src/_iife-entry.ts src/_shims
```

**If the spec adds new constants, update the shim.** The shim must mirror every constant imported by source files.

# @nimblebrain/synapse

Agent-aware app SDK for the MCP ext-apps protocol (2026-01-26).

## Verification

```bash
npm run ci    # lint → typecheck → build → test
```

**Run `npm run ci` before declaring any change complete. No exceptions.**

## Releasing

`@nimblebrain/synapse` publishes to npm via **GitHub Actions trusted publishing** on `v*` tag push. There is no static npm token; auth is OIDC (`id-token: write`) under the `npm` environment. The workflow is `.github/workflows/publish.yml`.

To cut a release:

1. Bump `version` in `package.json` and add a CHANGELOG entry on the release branch.
   **A `### Breaking` entry means the minor moves.** Nothing enforces this: the workflow
   checks the tag matches `package.json` and that a `## [<version>]` heading exists, and
   neither tells a minor from a patch. Consumers pin caret on `0.x`, which does not cross a
   minor — so cutting a breaking change as a patch carries it to every pinned consumer
   silently, which is the opposite of what the CHANGELOG's migration note promises.
2. Merge the PR.
3. Tag the merge commit on `main` and push the tag:
   ```bash
   git checkout main && git pull
   git tag v<version> -m "v<version>"
   git push origin v<version>
   ```
4. Watch the **Publish to npm** workflow run. It re-runs lint/typecheck/build/test, then verifies the tag string matches `package.json` (catches a stale bump), then runs `npm publish --provenance --access public`, then creates a matching GitHub Release with the body extracted from the `## [<version>]` section of `CHANGELOG.md`.

The version-match check at workflow time is the load-bearing safety: a tag of `v0.8.0` against `package.json` at `0.7.0` aborts before publishing instead of publishing the wrong contents under a misleading tag. The CHANGELOG-extraction step is the second tripwire — it fails the workflow if the version has no `## [<version>]` heading, so a release can't ship without notes.

Releases are public and provenance-attested — published artifacts carry a signed link back to the workflow run that produced them. Don't run `npm publish` from a local machine; do it through tags so provenance is preserved. Don't create the GitHub Release by hand either; the workflow handles it (and skips cleanly if the Release already exists, so manual reruns are safe).

**Pre-releases.** A version with a pre-release suffix (e.g. `0.12.0-rc.0`) publishes under the npm `next` dist-tag, not `latest`, and the GitHub Release is marked prerelease with notes read from the target stable `## [<base>]` section (the rc rarely has its own). So `v0.12.0-rc.0` → `next`, soak, then `v0.12.0` → `latest`. `npm install @nimblebrain/synapse` still resolves to the last stable `latest` throughout.

**Downstream CI right after a publish (Python).** The `nimblebrain-synapse` PyPI package publishes on a `nimblebrain-synapse-v*` tag (`publish-python.yml`), independent of the npm cadence. When you bump a *consumer's* pin to the version you just released, its CI can fail to resolve for ~1–2 min — PyPI's JSON API reflects the new version before the simple index `uv`/`pip` actually resolve against. Confirm propagation before re-running the consumer's CI (`uv run --isolated --no-project --with "nimblebrain-synapse>=<v>" python -c ""`) rather than reading a red run as a real break.

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

## Cross-host UI client (`connectUI` / `src/host/`)

A third, **push-first** path that renders one Synapse component across hosts that
each speak a different bridge — ChatGPT (OpenAI Apps SDK), Claude (the **MCP Apps
standard**, SEP-1865), and standalone — behind `synapse.data()/onData()/theme()/
resize()/openLink()/sendPrompt()/callTool()`. It is deliberately **decoupled from
`@modelcontextprotocol/*`** (pure `window.openai` + JSON-RPC over `postMessage`), so
the `window.SynapseUI` IIFE a self-contained `ui://` component inlines stays small
(no Zod). This is additive — the ext-apps `connect`/`createSynapse` paths below are
unchanged.

- Adapters live in `src/host/adapters/` (`chatgpt`, `mcpapps`, `inline`); detection
  in `src/host/detect.ts`; the façade in `src/host/connect.ts`. Add a host by
  adding an adapter + a detection branch — apps never change.
- **`mcpapps` is the convergence adapter** (MCP Apps standard / SEP-1865): the `ui/*`
  JSON-RPC bridge — `ui/initialize` → `ui/notifications/initialized` → `tool-result`
  / `host-context-changed`, plus `size-changed`, `ui/open-link`, `ui/message`, and
  `tools/call` (pull). `claude` and `nimblebrain` both route through it; the legacy
  mcp-ui dialect is folded in as a compat shim, suppressed once the handshake
  confirms a standard host. A dedicated `nimblebrain` adapter over the
  `synapse/*` extension is still P3.
- **Gotchas.** A host keeps the iframe hidden until it receives `ui/initialize` **and**
  a `size-changed` — a spec-correct component that never runs the handshake renders
  blank (looks like "nothing happened"). And `ui/notifications/tool-result` `params`
  **is** the `CallToolResult` (data at `params.structuredContent`), not wrapped in
  `params.result`. Keep `synapse/*` NimbleBrain-private fields out of the
  chatgpt/mcpapps payloads. A component that renders in one host but shows a generic
  error in another ("There was a problem displaying content" on Claude) is usually a
  rejected `_meta.ui.*` field, not broken HTML — `_meta.ui.domain` is a *host-validated*
  sandbox origin (Claude derives `sha256(<connectorURL>)[:32] + ".claudemcpcontent.com"`
  and rejects any other value), so pass that exact value or omit it (the host then
  defaults the origin). Reproduce locally by loading the embedded resource top-level
  (`host=generic`) and in a sandboxed iframe (`host=claude`), reading the console.
- The server half is the Python `nimblebrain-synapse` package (`python/`). It registers
  the component as **two `ui://` resources** — `text/html+skybridge` (ChatGPT) and
  `text/html;profile=mcp-app` (Claude/MCP Apps) — emits the tool `_meta`
  (`openai/outputTemplate` + nested `ui.resourceUri`), the `<script>`-safe embed (XSS
  defense), and the quarantined `CallToolResult` injection. Its vendored client IIFE
  (`python/nimblebrain_synapse/_assets/synapse-ui.iife.js`) is regenerated from
  `dist/synapse-ui.iife.global.js` — rebuild and re-copy when the client changes (the
  CI freshness gate enforces the copy). A **version bump** to `package.json` also
  requires updating `python/nimblebrain_synapse/__init__.py` `__client_version__` to
  the new version — CI fails until it equals `package.json`.

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

// MCP 2025-11-25 tasks utility — mirrors `@modelcontextprotocol/sdk/types.js`
// constants. Method strings are frozen by the spec; keep these in lockstep
// with `src/task-handle.ts` (and any future `src/task-methods.ts`). The SDK
// publishes these only as Zod `z.literal(...)`s — our source files derive
// the constants via `const X: SomeRequest["method"] = "..."` so a spec
// rename trips tsc immediately.
export const RELATED_TASK_META_KEY = "io.modelcontextprotocol/related-task";
export const TOOLS_CALL_METHOD = "tools/call";
export const TASKS_GET_METHOD = "tasks/get";
export const TASKS_RESULT_METHOD = "tasks/result";
export const TASKS_CANCEL_METHOD = "tasks/cancel";
export const TASKS_LIST_METHOD = "tasks/list";
export const TASKS_STATUS_NOTIFICATION_METHOD = "notifications/tasks/status";
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

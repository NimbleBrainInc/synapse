# @nimblebrain/synapse

Agent-aware app SDK for the MCP ext-apps protocol (2026-01-26).

## Verification

```bash
npm run ci           # lint → typecheck → build → size budget → test
npm run conformance  # our wire behaviour, against the spec's own implementation
```

**Run `npm run ci` before declaring any change complete. No exceptions.**

`conformance` is deliberately **not** part of `npm run ci`: it drives real
Chromium, so folding it in would make the documented verification command fail
on a fresh clone until someone ran `npx playwright install chromium`. CI runs
both as separate jobs. Run it by hand whenever you touch a transport, a
handshake, an adapter, or the preview host — see `conformance/README.md` for
what it covers and how to add a row.

**Re-vendor the Python client asset whenever the build output moves.** The
trigger is not "a change under `src/host/`": the bundle reaches outside it —
`src/host/adapters/mcpapps.ts` imports `foldFontFaces` from `src/detection.ts` —
and esbuild assigns minified names across the whole output, so deleting an
unrelated export from a module it touches re-mangles the bundle at an unchanged
size. Diff it rather than reasoning about which files matter, and never take a
byte count as evidence the bundle is unchanged. The build writes
`dist/synapse-ui.iife.global.js`; the copy the Python package ships is a
committed file that nothing updates for you:

```bash
npm run build && cp dist/synapse-ui.iife.global.js python/nimblebrain_synapse/_assets/synapse-ui.iife.js
```

CI's `build` job diffs the two, and the conformance suite runs the *vendored*
copy — so a forgotten re-vendor shows up as a conformance failure describing
behaviour you already fixed.

### Testing UI components — what the test DOM cannot see

`happy-dom` **drops every CSS declaration whose value contains `var(...)`**, shorthand and
longhand alike. `background: var(--color-background-secondary, #fafafa)` leaves the element
with no background in the rendered `style` attribute, and so does
`border-bottom-color: var(--c, #eee)`. Vendor-prefixed properties (`-webkit-line-clamp`) are
dropped too, as are values it does not model (`display: -webkit-box`).

Every token in this kit is a `var()` reference. **So no token-driven style is observable in a
test** — an assertion that appears to check a colour, a radius, or a font is checking an empty
string against an empty string and passes whatever the component does.

What this leaves, in order of preference:

1. **Assert the injected stylesheet.** Rules that go through `ensureStyle` are readable as
   text: `document.getElementById("<STYLE_ID>")?.textContent`. This is the reason to prefer a
   rule over an inline style for anything vendor-prefixed or paired (`display: -webkit-box`
   with `-webkit-line-clamp` only works together, and a rule keeps them together).
2. **Assert CSS literals.** `display: block`, `overflow: hidden`, `table-layout: fixed` carry
   no token and survive intact — which is why the layout fixes in 0.16.0 are testable at all.
3. **Assert structure and ARIA.** Landmarks, roles, `tabIndex`, which element contains which.
4. **Assert custom properties the component sets** (`--nb-ph-desc-lines: 4`), which is how a
   caller's number is shown to actually reach the rule.

Anything left over is a review concern, and a test that pretends otherwise is worse than no
test — say so in the test rather than writing an assertion that cannot fail.

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
| `connect.ts` | The `App` class itself, plus `AppEventMap`, `AppRequest`, `AppNotification`, `McpUiHostCapabilities`, `McpUiHostContext`, `McpUiMessageRequest`, `McpUiOpenLinkRequest`, `McpUiUpdateModelContextRequest`, `TextContent`, `CallToolRequest`, `CallToolResultSchema`, `ResultSchema` |
| `download-file.ts` | `McpUiDownloadFileRequest`, `McpUiDownloadFileResult`, `EmbeddedResource` |
| `event-map.ts` | All `*_METHOD` constants, plus `ResourceListChangedNotification` |
| `task-handle.ts` | `McpUiHostCapabilities`, and every task request/result type |
| `detection.ts` | `McpUiHostContext` |

## Cross-host UI client (`connectUI` / `src/host/`)

A third, **push-first** path that renders one Synapse component in any host that
speaks the **MCP Apps standard** (SEP-1865) — ChatGPT, Claude and NimbleBrain all
do — and standalone, behind `synapse.data()/onData()/theme()/
resize()/openLink()/sendPrompt()/callTool()`. It is deliberately **decoupled from
`@modelcontextprotocol/*`** (hand-spoken JSON-RPC over `postMessage`), so
the `window.SynapseUI` IIFE a self-contained `ui://` component inlines stays small
(no Zod). This is additive — the ext-apps `connect` path below is unchanged.

- Two adapters live in `src/host/adapters/`: `mcpapps` for a framed component and
  `inline` for a standalone one. Detection (`src/host/detect.ts`) asks only whether
  the document is framed. **It must never key on `window.openai`**: ChatGPT injects
  it into every frame, spec-only components included, so it names no bridge.
- **`mcpapps` speaks the `ui/*` JSON-RPC bridge and nothing else**: `ui/initialize`
  → `ui/notifications/initialized` → `tool-result` / `host-context-changed`, plus
  `size-changed`, `ui/open-link`, `ui/message`, and `tools/call` (pull). Nothing
  goes out before `ui/initialize`, a size included, and no non-JSON-RPC frame goes
  out at all; the conformance suite asserts both.
- **`callTool` rejects with `ToolCallError` on an `isError` result**, in the
  façade rather than the adapter: MCP reports a failed or refused call inside the
  result, and ChatGPT reports a refusal that way.
- **Gotchas.** A host keeps the iframe hidden until it receives `ui/initialize` **and**
  a `size-changed` — a spec-correct component that never runs the handshake renders
  blank (looks like "nothing happened"). And `ui/notifications/tool-result` `params`
  **is** the `CallToolResult` (data at `params.structuredContent`), not wrapped in
  `params.result`. Keep `ai.nimblebrain/*` NimbleBrain-private fields out of the
  `mcpapps` payloads. A component that renders in one host but shows a generic
  error in another ("There was a problem displaying content" on Claude) is usually a
  rejected `_meta.ui.*` field, not broken HTML — `_meta.ui.domain` is a *host-validated*
  sandbox origin (Claude derives `sha256(<connectorURL>)[:32] + ".claudemcpcontent.com"`
  and rejects any other value), so pass that exact value or omit it (the host then
  defaults the origin). Reproduce locally by loading the embedded resource top-level
  (`host=generic`) and in a sandboxed iframe (`host=claude`), reading the console.
- The server half is the Python `nimblebrain-synapse` package (`python/`). `SynapseUI`
  is an MCP extension (SEP-2133): handed to `MCPServer(extensions=[...])`, it
  contributes the component as **one `ui://` resource** under
  `text/html;profile=mcp-app`, which every host renders (ChatGPT resolves
  `ui.resourceUri` itself), emits the tool `_meta` (`ui.resourceUri` and
  `ui.visibility`) and the resource `_meta` (`ui.csp`, `ui.prefersBorder`), each with
  ChatGPT's alias for it, kept in one marked section of `server.py` whose comment says
  why; plus the `<script>`-safe embed (XSS defense), and the `tools/call` interceptor
  that bakes the component into a bound tool's result when `embed_resource=True`.
  Never add a second copy of the resource under another MIME. **A host-specific key
  that mirrors a spec value is emitted always, derived from that value** — ChatGPT's
  documented default for a missing `openai/widgetAccessible` is *not app-accessible*,
  so an omitted alias is a silent change of behaviour rather than a fallback. OpenAI
  documents `ui.csp` as generally preferred for new UI and `openai/widgetCSP` as a
  legacy compatibility key, still the only way to declare `redirect_domains`, so emit
  both. **Neither is known to change what ChatGPT enforces**: measured 2026-09-18 in
  developer mode, a frame whose resource carried both dialects ran under ChatGPT's own
  default sandbox CSP — a boilerplate allowlist on the sandbox shell, inherited by the
  frame the component is injected into, which is what the `CSP off` badge reports. Emit
  them for the documented requirement, and state what was measured rather than a
  property of the host. A host-specific key carrying a **developer-declared
  input** (`widget_domain`, `invoking`/`invoked`) is emitted only when that input is
  given. Mind the dialects: `openai/widgetCSP` spells its origin lists
  `connect_domains`/`resource_domains`, and a camelCase alias is ignored exactly as a
  missing key is. `synapse check --target chatgpt` reports both, at `warn`. Its vendored client IIFE
  (`python/nimblebrain_synapse/_assets/synapse-ui.iife.js`) is regenerated from
  `dist/synapse-ui.iife.global.js` — rebuild and re-copy when the client changes (the CI
  freshness gate enforces the copy). A **version bump** to `package.json` also requires
  updating `python/nimblebrain_synapse/__init__.py` `__client_version__` to the new
  version — CI fails until it equals `package.json`.

## The connection

`await connect(options)` returns an `App`. It is the only entry point, and the
protocol underneath it is the spec's own client: `@modelcontextprotocol/ext-apps`'s
`App` owns the transport, the handshake and the wire schemas. This package is the
framework on top — theme injection, parsed payloads, multi-subscriber events,
resize, and the NimbleBrain extensions.

Four things about that seam are load-bearing:

- **Handlers are registered before `App.connect()`**, including everything in
  `options.on`, so a tool result the host sends in the same turn as `initialized`
  is not lost.
- **One `addEventListener` per mapped event**, with this SDK's own fan-out under
  it. A second registration for the same method through the `on*` setters throws,
  and `App` warns when a handler for a one-shot event is registered after the
  handshake — which is when every hook subscribes. Everything `App` does not
  model (the NimbleBrain host extensions, `notifications/resources/list_changed`,
  `notifications/tasks/status`) arrives through one `fallbackNotificationHandler`,
  for the same reason: a second handler for a method would silently replace the
  first.
- **Requests carry no deadline.** The SDK's default is 60 seconds; a file picker
  waits on a person and `tasks/result` blocks until a task ends. `Infinity` is not
  usable — `setTimeout` coerces it to `0` — so `NO_DEADLINE` is the longest timer
  a browser accepts.
- **`autoResize` belongs to `App`.** Ours never observes as well: two observers
  mean two `size-changed` streams for one document.

The returned object carries the ext-apps surface plus the handshake state, and
nothing else.
The NimbleBrain extensions (`action`, `pickFile`, `pickFiles`), the spec's
`ui/download-file` (`downloadFile`) and the MCP tasks utility (`callToolAsTask`)
are **functions over an `App`** in `src/extensions.ts`, `src/download-file.ts`
and `src/task-handle.ts`, reaching the transport through `internalsFor(app)`. Adding a capability means adding a function there, not a
method on the object — the whole point of collapsing the old two-API fork was a
smaller object, and it grows back one convenience method at a time.

## The portable-app contract

Every method on `App` and every helper beside it reads `hostCapabilities` from
the `ui/initialize` result before it sends, and does one documented thing when
the capability is absent:

- a request with an answer rejects with `HostCapabilityError` **without
  sending** — a host that does not implement it may never answer, and requests
  have no deadline;
- a fire-and-forget call sends nothing;
- a hook that waits for the host keeps its initial value.

The per-hook table is `web/src/content/docs/docs/concepts/degradation.mdx`; the
same rule is on each method's doc comment. A new method or helper picks one of
the three and says which. Nothing is gated on the host's name.

## NimbleBrain host extensions (`ai.nimblebrain/` prefix)

No spec equivalent. They are the NimbleBrain host's extensions, and this package
implements a client for them. `NIMBLEBRAIN_EXTENSIONS` in `src/event-map.ts` is
the complete list. Each has one name, used as its method and as the identifier a
host declares in `hostCapabilities.experimental` to offer it (`experimental` is
the one slot a spec client's handshake parse keeps):

- `ai.nimblebrain/action`
- `ai.nimblebrain/request-file`
- `ai.nimblebrain/keydown`

The chat context on `sendMessage` rides `_meta["ai.nimblebrain/context"]`.

An `ai.nimblebrain/` method constant without an entry fails `event-map.test.ts`.

## IIFE build for MCP server widgets

**This recipe is for the cross-host `SynapseUI` client only.** It replaces
`@modelcontextprotocol/*` with string constants, and `connect()` needs the real
`App` class — so a `connect()` bundle built this way has no client at all. The
`connect()` IIFE is built by `tsup` (`dist/connect.iife.global.js`) and bundles
ext-apps and Zod deliberately: about 117 KB gzipped, against 3.8 KB for the
`SynapseUI` bundle a self-contained `ui://` component inlines.

MCP servers embed synapse as a `<script>` in widget HTML. Build with esbuild + shims to avoid bundling Zod (~11KB vs ~400KB):

```bash
# Create entry
cat > src/_iife-entry.ts << 'EOF'
import { connect } from "./connect.ts";
import { downloadFile } from "./download-file.ts";
import { action, pickFile, pickFiles } from "./extensions.ts";
import { callToolAsTask } from "./task-handle.ts";
(globalThis as any).Synapse = {
  connect, callToolAsTask, action, downloadFile, pickFile, pickFiles,
};
EOF

# Create lightweight shim (string constants only, no Zod)
mkdir -p src/_shims
cat > src/_shims/ext-apps.ts << 'SHIM'
export const LATEST_PROTOCOL_VERSION = "2026-01-26";
export const INITIALIZE_METHOD = "ui/initialize";
export const INITIALIZED_METHOD = "ui/notifications/initialized";
export const OPEN_LINK_METHOD = "ui/open-link";
export const DOWNLOAD_FILE_METHOD = "ui/download-file";
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

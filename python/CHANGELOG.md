# Changelog

All notable changes to `nimblebrain-synapse` (the Python package) are documented here.
It versions **independently** of the `@nimblebrain/synapse` npm package — the two
meet only on the wire protocol, not on a shared version number.

This project adheres to [Semantic Versioning](https://semver.org/).

## [0.6.0]

Requires **mcp 2.x**. The Python API changed shape; the wire protocol and the
template contract did not, so a component's HTML and its client code are untouched.

### Breaking

- **`mcp>=2.0.0,<3`. mcp 1.x is no longer supported.** There is no compatibility
  layer: `SynapseUI` is now an `mcp.server.extension.Extension` and takes the MCP
  Apps identifier and MIME from `mcp.server.apps`, and neither module exists in 1.x.

- **`register(mcp)` is gone. Pass the instance to `MCPServer(extensions=[...])`.**
  The SDK fixes extensions at construction, so the resources are contributed from
  the extension rather than registered onto a live server.

- **`bind(mcp, tool="x", ...)` → `bind("x", ...)`.** The server argument is gone; the
  binding is recorded on the extension and applied by its `tools/call` interceptor.
  `should_render` and `embed_resource` are unchanged. Order no longer matters — the
  interceptor installs because the class overrides `intercept_tool_call`, not because
  a tool is bound — and binding the same tool twice now replaces its options instead
  of being ignored.

  Migrating a server is three lines:

  ```diff
  -from mcp.server.fastmcp import FastMCP
  +from mcp.server.mcpserver import MCPServer

  -mcp = FastMCP("bassethound")
   ui = SynapseUI(uri="ui://bassethound/report", template=TEMPLATE)
  -ui.register(mcp)
  +ui.bind("analyze_domain", should_render=lambda d: "domain" in d)
  +mcp = MCPServer("bassethound", extensions=[ui])

   @mcp.tool(meta=ui.tool_meta())
   async def analyze_domain(domain: str) -> Dossier: ...
  -ui.bind(mcp, tool="analyze_domain", should_render=lambda d: "domain" in d)
  ```

- **One `SynapseUI` per server.** It advertises the spec's MCP Apps identifier
  (`io.modelcontextprotocol/ui`), because that is the extension it implements, so a
  second instance — or the SDK's own `mcp.server.apps.Apps` alongside it — fails at
  construction with `Extension 'io.modelcontextprotocol/ui' is already registered`.
  Use `SynapseUI` instead of `Apps`: `Apps` serves only
  `text/html;profile=mcp-app` and cannot carry the ChatGPT skybridge resource.

### Removed

- **The FastMCP internals patch.** `bind` used to write into
  `mcp._mcp_server.request_handlers` to wrap the call-tool handler, quarantined
  behind a TODO to upstream a real result-transform hook. mcp 2.x ships that hook —
  `Extension.intercept_tool_call` (SEP-2133) — so the patch is deleted rather than
  ported, and this package no longer touches a private attribute of the SDK.

### Added

- **The extension is advertised** under `ServerCapabilities.extensions`, so a host
  that gates rendering on negotiating `io.modelcontextprotocol/ui` now sees it.

- **`resource_meta=`** on the constructor, carrying the extra `_meta` keys that
  `register(mcp, meta=...)` used to take.

## [0.5.1]

### Fixed

- **`mcp` is capped below 2, so a fresh install resolves an SDK this code runs on.**
  The dependency was `mcp>=1.26.0` with no upper bound, so a fresh install resolved
  mcp 2.x — where `FastMCP` is `mcp.server.mcpserver.MCPServer` and
  `mcp.server.fastmcp` raises `ModuleNotFoundError` on import.

  What that reaches, precisely: `SynapseUI`, `register()`, `tool_meta()` and the
  HTML/escaping surface all still work on mcp 2.x, because this package's `FastMCP`
  import is `TYPE_CHECKING`-only. **`bind()` is what breaks.** It writes into
  `mcp._mcp_server.request_handlers`, an attribute `MCPServer` does not have, so a
  server wired the documented way raises `AttributeError` while it is being built.
  `_attach` also reads `ServerResult.root`, and on 2.x `ServerResult` is a plain union
  rather than a `RootModel`.

  This was invisible for weeks because it is a RESOLUTION failure rather than a code
  change: nothing in this repo moved, the newest matching `mcp` did. CI would have
  caught it on the first run after mcp 2.0, and CI had not run since 2026-07-28.

  Superseded by 0.6.0, which moves to mcp 2.x rather than pinning away from it. The
  cap survives as the `<3` bound.

## [0.5.0]

The Python API is unchanged. This release ships the vendored UI client at
`@nimblebrain/synapse` 0.15.0, up from 0.14.0.

A minor, and read the first entry before bumping: the client **removes** two
tokens, so this is not a drop-in for every component.

### Changed

- **The `warm` tone and the `warm` / `warmLight` tokens are gone from the client.**
  `--nb-color-warm` was a second accent channel no host injects, so a component
  using it painted the SDK's own fallback — an orange from a retired brand
  generation — in every host. If your component markup or CSS references
  `tone="warm"`, `tokens.warm` or `tokens.warmLight`, move to `accent` /
  `infoLight` where it is informational, or the `warning` pair where it is a
  caution. A component that never used them is unaffected.

- **Heading tokens fall back to the body sans stack, not a display serif.** A host
  that injects no `--nb-font-heading` previously got `Georgia`; it now gets the
  same sans as body text, with hierarchy from weight and size.

### Fixed

- **A partial `document` no longer kills the connection.** Client 0.14.0 moved the
  neutral colour defaults into a `<style>` element, which silently required
  `getElementById`, `createElement`, `head.prepend` and `removeProperty`. A caller
  whose document supplied the previous envelope began throwing, and the throw
  unwound into the handshake — so the symptom was an app that never connected,
  with nothing pointing at theming. Those four are now feature-checked.

## [0.4.0]

The Python API is unchanged. This release exists to ship the vendored UI client,
which had fallen two npm minors behind: `__client_version__` moves `0.12.0` →
`0.14.0`, carrying four `@nimblebrain/synapse` releases (`0.12.1`, `0.12.2`,
`0.13.0`, `0.14.0`) into `_assets/synapse-ui.iife.js`.

A minor rather than a patch, because component CSS that declares one of the
SDK's backed color tokens changes behaviour — see the theming note below.

### Changed

- **The client's neutral color defaults no longer outrank your component's own
  CSS.** They ship in a `@layer synapse-defaults` stylesheet instead of as inline
  properties on `documentElement`, so a plain `:root` rule in your component now
  wins — previously that needed `!important`, or was impossible. A token nothing
  declares still resolves to a theme-correct neutral in both modes. If your
  component declares any of these tokens and relied on the client overriding it,
  that override stops.

  A host that delivers mode-varying tokens through a channel it cannot update
  after mount will now hold them at their mount-time values, where the client's
  inline defaults used to mask that by discarding them. See the
  `@nimblebrain/synapse` 0.14.0 entry in the root `CHANGELOG.md`.

- **Host typography reaches the component.** The client accepts `@font-face`
  descriptors over the `synapse/fontFaces` host-context extension, so a host that
  sends its faces alongside its tokens renders your component in its own
  typeface. Hosts that omit it are unaffected. The client ships no font data.

## [0.3.0]

### Changed

- **BREAKING:** `bind(...)` no longer embeds the component HTML into the tool
  result by default — the mcp-ui `EmbeddedResource` is now opt-in via
  `embed_resource=True`. By default `bind` emits only the `_meta` template pointer
  (`openai/outputTemplate` / `ui.resourceUri`), which is all a standard host needs
  to bind the registered `ui://` component and render it with the tool's
  `structuredContent`. The embedded copy was a legacy "render from the content
  block, no `resources/read` round-trip" affordance, but that HTML is
  `audience: ["user"]` UI, not model context: a client that can't render it (a
  plain MCP client, a terminal coding agent) has no way to negotiate it away on a
  stateless server, so the whole component — tens of KB per call — landed verbatim
  in the model's context. Migration: standard hosts (ChatGPT via
  `openai/outputTemplate`, Claude and other SEP-1865 hosts via `ui.resourceUri`,
  the NimbleBrain runtime) need no change; they already render off the pointer.
  Pass `embed_resource=True` only for a host that renders *solely* from the
  embedded copy and not the `ui.resourceUri` pointer.

## [0.2.0]

### Changed

- **BREAKING:** `SynapseUI(domain=…)` splits into two host-specific origins,
  `widget_domain` and `mcp_app_domain`. `domain` fed a single value to both
  `openai/widgetDomain` (ChatGPT) and `_meta.ui.domain` (ext-apps), but the two
  are not the same thing: `openai/widgetDomain` is a developer-declared origin,
  while the ext-apps `ui.domain` is a **host-validated sandbox origin** whose
  format is host-specific — Claude derives it from the connector URL and refuses
  to render the component when the supplied value differs. A component that set
  `domain` therefore rendered in ChatGPT but failed in Claude with *"There was a
  problem displaying content."* `widget_domain` now reaches only the ChatGPT
  resource; `mcp_app_domain` reaches only the ext-apps resource and is **omitted
  by default**, which the spec resolves to the host's own default sandbox origin
  (the correct choice for a self-contained component). Migration: rename
  `domain="…"` to `widget_domain="…"`. When a component genuinely needs a stable,
  dedicated ext-apps origin (OAuth callback / CORS / API-key allowlist), set
  `mcp_app_domain` to the value in the target host's format — e.g. Claude validates
  `_meta.ui.domain` against `sha256(<connector URL>)[:32] + ".claudemcpcontent.com"`.

## [0.1.0]

First published release to PyPI. The `SynapseUI` server descriptor previously
shipped only as source in this repo and vendored copies; it is now an installable
package so bundles depend on one source of truth instead of copying it.

### Added

- `SynapseUI` server descriptor: dual-MIME `ui://` registration (ChatGPT
  `text/html+skybridge` + MCP Apps `text/html;profile=mcp-app`), tool/result
  `_meta` in both dialects, widget CSP + domain, `<script>`-safe data embedding
  (the XSS defense), and the quarantined `CallToolResult` render injection.
- Bundled client IIFE (`window.SynapseUI`) from `@nimblebrain/synapse` 0.12.0,
  inlined so a component stays self-contained (CSP-safe, no CDN).

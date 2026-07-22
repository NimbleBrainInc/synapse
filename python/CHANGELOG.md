# Changelog

All notable changes to `nimblebrain-synapse` (the Python package) are documented here.
It versions **independently** of the `@nimblebrain/synapse` npm package — the two
meet only on the wire protocol, not on a shared version number.

This project adheres to [Semantic Versioning](https://semver.org/).

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

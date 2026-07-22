# Changelog

All notable changes to `nimblebrain-synapse` (the Python package) are documented here.
It versions **independently** of the `@nimblebrain/synapse` npm package — the two
meet only on the wire protocol, not on a shared version number.

This project adheres to [Semantic Versioning](https://semver.org/).

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

# Changelog

All notable changes to `nimblebrain-synapse` (the Python package) are documented here.
It versions **independently** of the `@nimblebrain/synapse` npm package — the two
meet only on the wire protocol, not on a shared version number.

This project adheres to [Semantic Versioning](https://semver.org/).

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

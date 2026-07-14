# synapse-ui (Python)

The **server half** of the Synapse cross-host UI framework. Pairs with the
`@nimblebrain/synapse` client (`connectUI` / `window.SynapseUI`).

```bash
pip install synapse-ui   # or: uv add synapse-ui
```

One `SynapseUI` declaration wires a self-contained HTML component into every host
bridge a Synapse app renders in — **ChatGPT** (OpenAI Apps SDK), **Claude** (MCP
Apps), and the **NimbleBrain** runtime — from a FastMCP server, replacing the
per-app hand-rolled shim.

```python
from mcp.server.fastmcp import FastMCP
from synapse_ui import SynapseUI

mcp = FastMCP("bassethound")

report_ui = SynapseUI(
    uri="ui://bassethound/report",
    template=load_template(),            # data-free HTML (carries the SDK + data markers)
    preferred_size=("100%", "auto"),
)
report_ui.register(mcp)                   # skybridge ui:// resource, SDK inlined

@mcp.tool(meta=report_ui.tool_meta(invoking="Picking up the scent…", invoked="Dossier ready"))
async def analyze_domain(domain: str) -> Dossier:
    ...

report_ui.bind(mcp, tool="analyze_domain", should_render=lambda d: "domain" in d)
```

`register` serves the ChatGPT-facing skybridge resource (data-free). `bind`
post-processes the `CallToolResult` for one tool: appends the mcp-ui embedded
`ui://` resource (dossier baked into a `<script>`) and mirrors the ChatGPT
`_meta`. Plain MCP clients ignore both and still read `structuredContent`.

## Template contract

The `template` is data-free HTML that carries two markers:

- `<!--__SYNAPSE_SDK__-->` — replaced with the inlined client SDK `<script>`.
- `<script type="application/json" id="synapse-ui-data">/*__SYNAPSE_DATA__*/</script>`
  — the data slot; `render_html(data)` substitutes the escaped payload here (the
  served copy leaves the marker, so the client reads `null` and falls back to the
  host's push).

`SynapseUI._safe_json` escapes the payload for `<script>` embedding (the XSS
defense) — framework-owned and on by default.

## Interface debt

`bind` wraps FastMCP's `CallToolRequest` handler — a leak into FastMCP internals,
quarantined in this one place. See the `# TODO: upstream a real FastMCP
result-transform hook` note in `server.py`.

## Client SDK asset

`synapse_ui/_assets/synapse-ui.iife.js` is the vendored client IIFE
(`window.SynapseUI`), regenerated from the JS build
(`dist/synapse-ui.iife.global.js`) and inlined at register time so a component
is fully self-contained (CSP-safe, no CDN). CI fails on drift from the build.
`synapse_ui.__client_version__` records which `@nimblebrain/synapse` release the
bundled IIFE was built from.

## Versioning & compatibility

`synapse-ui` (PyPI) versions **independently** of `@nimblebrain/synapse` (npm).
They change for different reasons at different cadences — the server descriptor is
thin and stable; the JS client evolves with host adapters and theming — so they do
not share a version number. What they share is the **wire protocol**: the `ui://`
resource MIMEs, the `_meta` dialects, and the data-element contract. Both sides
target the same named protocol versions.

| `synapse-ui` | Bundled client (`@nimblebrain/synapse`) | Wire protocols |
|---|---|---|
| 0.1.0 | 0.12.0 | ext-apps `2026-01-26` · MCP Apps (SEP-1865) · OpenAI Apps SDK |

Releases publish on a `synapse-ui-v*` tag (distinct from the npm `v*` tags).

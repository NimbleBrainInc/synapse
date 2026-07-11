# synapse-ui (Python)

The **server half** of the Synapse cross-host UI framework. Pairs with the
`@nimblebrain/synapse` client (`connectUI` / `window.SynapseUI`).

One `SynapseUI` declaration wires a self-contained HTML component into every host
bridge a Synapse app renders in — **ChatGPT** (OpenAI Apps SDK) and **Claude**
(mcp-ui) — from a FastMCP server, replacing the per-app hand-rolled shim.

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
(`dist/synapse-ui.iife.global.js`). Server and client ship together so their
versions stay coupled.

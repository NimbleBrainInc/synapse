# nimblebrain-synapse (Python)

The **server half** of the Synapse cross-host UI framework. Pairs with the
`@nimblebrain/synapse` client (`connectUI` / `window.SynapseUI`).

```bash
pip install nimblebrain-synapse   # or: uv add nimblebrain-synapse
```

One `SynapseUI` declaration wires a self-contained HTML component into every host
bridge a Synapse app renders in — **ChatGPT** (OpenAI Apps SDK), **Claude** (MCP
Apps), and the **NimbleBrain** runtime — from a FastMCP server, replacing the
per-app hand-rolled shim.

```python
from mcp.server.fastmcp import FastMCP
from nimblebrain_synapse import SynapseUI

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

`register` serves the host-facing `ui://` resources (data-free), and `tool_meta`
on the tool descriptor carries the binding pointers (`openai/outputTemplate` for
ChatGPT, `ui.resourceUri` for SEP-1865 hosts). `bind` post-processes the
`CallToolResult` for one tool: by default it mirrors the ChatGPT
`openai/outputTemplate` pointer into the result `_meta`, so a standard host
renders the registered component from `structuredContent` with no UI HTML in the
result content. Pass `embed_resource=True` to also bake the legacy mcp-ui embedded
copy (dossier in a `<script>`) into the content — off by default so that
`audience: ["user"]` HTML can't leak into a client that won't render it. Plain MCP
clients ignore the `_meta` and still read `structuredContent`.

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

`bind` wraps FastMCP's `CallToolRequest` handler by writing into
`mcp._mcp_server.request_handlers` — a leak into FastMCP internals, quarantined in
this one place so no app pokes them. mcp 1.x offers no result-transform hook to use
instead; mcp 2.x does (`Extension.intercept_tool_call`, SEP-2133), so this patch is
deleted rather than ported whenever the package moves. See MCP SDK compatibility
below.

## Client SDK asset

`nimblebrain_synapse/_assets/synapse-ui.iife.js` is the vendored client IIFE
(`window.SynapseUI`), regenerated from the JS build
(`dist/synapse-ui.iife.global.js`) and inlined at register time so a component
is fully self-contained (CSP-safe, no CDN). CI fails on drift from the build.
`nimblebrain_synapse.__client_version__` records which `@nimblebrain/synapse` release the
bundled IIFE was built from.

## Versioning & compatibility

`nimblebrain-synapse` (PyPI) versions **independently** of `@nimblebrain/synapse` (npm).
They change for different reasons at different cadences — the server descriptor is
thin and stable; the JS client evolves with host adapters and theming — so they do
not share a version number. The exact client build a given release bundles is
recorded in `nimblebrain_synapse.__client_version__` (and, per release, in the
[CHANGELOG](https://github.com/NimbleBrainInc/synapse/blob/main/python/CHANGELOG.md));
CI keeps it equal to the sibling `package.json` at HEAD.

What both halves share is the **wire protocol** — the `ui://` resource MIMEs, the
`_meta` dialects, and the data-element contract:

- ext-apps `2026-01-26`
- MCP Apps (SEP-1865)
- OpenAI Apps SDK

### MCP SDK compatibility

**This package targets mcp 1.x** (`mcp>=1.26.0,<2`). The cap is a statement of what
the code supports, not lag: `bind` writes into `mcp._mcp_server.request_handlers` and
`_attach` reads `ServerResult.root`, and mcp 2.x has neither — `MCPServer` keeps its
lowlevel server elsewhere, and `ServerResult` there is a plain union rather than a
`RootModel`. `mcp.server.fastmcp` itself raises `ModuleNotFoundError` on 2.x
(`FastMCP` is now `mcp.server.mcpserver.MCPServer`).

On 2.x the failure is late rather than loud: `SynapseUI`, `register`, `tool_meta` and
the HTML surface all still work, and a server breaks with an `AttributeError` at the
`bind` call while it is being wired.

Adopting 2.x is a migration, and it is breaking for every consumer on 1.x — which is
all of them, because a server using `SynapseUI` is a FastMCP server and carries its own
`mcp.server.fastmcp` import and its own `mcp<2` pin. So the cap moves when a consumer's
own server moves. What that migration costs, measured against 2.x rather than inferred,
is recorded in [#59](https://github.com/NimbleBrainInc/synapse/issues/59).

Releases publish on a `nimblebrain-synapse-v*` tag (distinct from the npm `v*` tags).

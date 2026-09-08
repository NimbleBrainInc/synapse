# nimblebrain-synapse (Python)

The **server half** of the Synapse cross-host UI framework. Pairs with the
`@nimblebrain/synapse` client (`connectUI` / `window.SynapseUI`).

```bash
pip install nimblebrain-synapse   # or: uv add nimblebrain-synapse
```

One `SynapseUI` declaration wires a self-contained HTML component into every host
bridge a Synapse app renders in — **ChatGPT** (OpenAI Apps SDK), **Claude** (MCP
Apps), and the **NimbleBrain** runtime — replacing the per-app hand-rolled shim.
It is an MCP extension (SEP-2133): hand the instance to `MCPServer` and it
contributes its resources and its result binding.

```python
from mcp.server.mcpserver import MCPServer
from nimblebrain_synapse import SynapseUI

report_ui = SynapseUI(
    uri="ui://bassethound/report",
    template=load_template(),            # data-free HTML (carries the SDK + data markers)
    preferred_size=("100%", "auto"),
)
report_ui.bind("analyze_domain", should_render=lambda d: "domain" in d)

mcp = MCPServer("bassethound", extensions=[report_ui])

@mcp.tool(meta=report_ui.tool_meta(invoking="Picking up the scent…", invoked="Dossier ready"))
async def analyze_domain(domain: str) -> Dossier:
    ...
```

Passing the instance in `extensions=` serves the host-facing `ui://` resources
(data-free) and installs the `tools/call` interceptor. `tool_meta` on the tool
descriptor carries the binding pointers (`openai/outputTemplate` for ChatGPT,
`ui.resourceUri` for SEP-1865 hosts). `bind` names a tool whose result carries the
binding: by default the interceptor mirrors the ChatGPT `openai/outputTemplate`
pointer into the result `_meta`, so a standard host renders the contributed
component from `structuredContent` with no UI HTML in the result content. Pass
`embed_resource=True` to also bake the legacy mcp-ui embedded copy (dossier in a
`<script>`) into the content — off by default so that `audience: ["user"]` HTML
can't leak into a client that won't render it. Plain MCP clients ignore the `_meta`
and still read `structuredContent`.

`bind` may be called before or after the server is constructed; the resources are
built at construction, so a `SynapseUI` is fully formed before `MCPServer` reads it.

## Template contract

The `template` is data-free HTML that carries two markers:

- `<!--__SYNAPSE_SDK__-->` — replaced with the inlined client SDK `<script>`.
- `<script type="application/json" id="synapse-ui-data">/*__SYNAPSE_DATA__*/</script>`
  — the data slot; `render_html(data)` substitutes the escaped payload here (the
  served copy leaves the marker, so the client reads `null` and falls back to the
  host's push).

`SynapseUI._safe_json` escapes the payload for `<script>` embedding (the XSS
defense) — framework-owned and on by default.

## Relationship to the SDK's own MCP Apps extension

`SynapseUI` advertises the spec's MCP Apps identifier, `io.modelcontextprotocol/ui`
— that *is* the extension it implements, and the ChatGPT dialect rides alongside in
`_meta` keys the spec does not claim. So a server uses `SynapseUI` **instead of**
`mcp.server.apps.Apps`, not next to it: two extensions cannot share an identifier,
and `Apps` serves only `text/html;profile=mcp-app`, so it cannot carry the
skybridge resource that makes the component render in ChatGPT.

One consequence: **one `SynapseUI` per server.** A second instance fails at server
construction with `Extension 'io.modelcontextprotocol/ui' is already registered`.

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

**This package requires mcp 2.x** (`mcp>=2.0.0,<3`) and does not run on 1.x. It is
built on two things that exist only in 2.x: the SEP-2133 extension interface
(`mcp.server.extension.Extension`), and `mcp.server.apps` for the MCP Apps
identifier and MIME. On 1.x the equivalent of `intercept_tool_call` did not exist,
and this package reached into `FastMCP`'s private handler registry to get one — so
there is no shape that serves both majors, and the range is a single major rather
than a span.

The upper bound is deliberate. `mcp` 2.0 reached fresh installs of this package
through an uncapped `>=` floor and broke them, which is what the cap prevents from
happening again at 3.0.

Releases publish on a `nimblebrain-synapse-v*` tag (distinct from the npm `v*` tags).

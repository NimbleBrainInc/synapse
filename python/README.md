# nimblebrain-synapse (Python)

The **server half** of the Synapse cross-host UI framework. Pairs with the
`@nimblebrain/synapse` client (`connectUI` / `window.SynapseUI`).

```bash
pip install nimblebrain-synapse   # or: uv add nimblebrain-synapse
```

One `SynapseUI` declaration serves a self-contained HTML component to every MCP
Apps host — **ChatGPT**, **Claude**, and the **NimbleBrain** runtime — replacing the
per-app hand-rolled shim.
It is an MCP extension (SEP-2133): hand the instance to `MCPServer` and it
contributes its `ui://` resource and its `tools/call` interceptor.

```python
from mcp.server.mcpserver import MCPServer
from nimblebrain_synapse import SynapseUI

report_ui = SynapseUI(
    uri="ui://bassethound/report",
    template=load_template(),            # data-free HTML (carries the SDK + data markers)
    preferred_size=("100%", "auto"),
)
mcp = MCPServer("bassethound", extensions=[report_ui])

@mcp.tool(meta=report_ui.tool_meta(invoking="Picking up the scent…", invoked="Dossier ready"))
async def analyze_domain(domain: str) -> Dossier:
    ...
```

Passing the instance in `extensions=` serves one data-free `ui://` resource under
`text/html;profile=mcp-app` and installs the `tools/call` interceptor. `tool_meta` on
the tool descriptor carries the binding, `ui.resourceUri`; ChatGPT and Claude both
resolve it, read the resource and render the component from the result's
`structuredContent`, with no UI HTML in the result content. Plain MCP clients ignore
the `_meta` and still read `structuredContent`.

`bind(tool, embed_resource=True)` additionally bakes the rendered component (dossier
in a `<script>`) into that tool's result content, for a host that renders solely
from an embedded copy. It is off by default so that `audience: ["user"]` HTML can't
leak into a client that won't render it. `bind` may be called before or after the
server is constructed; the resource is built at construction, so a `SynapseUI` is
fully formed before `MCPServer` reads it.

## The keys each input reaches

Each input is declared once. The ext-apps `ui.*` key is the one the spec defines, and
the one every host reads.

| Input | ext-apps key | ChatGPT key |
|---|---|---|
| the component | tool `ui.resourceUri` | — |
| `tool_meta(visibility=)` | tool `ui.visibility` | `openai/widgetAccessible`; `openai/visibility: "private"` when `"model"` is absent |
| `connect_domains`, `resource_domains` | resource `ui.csp` | — |
| always `true` | resource `ui.prefersBorder` | — |
| `mcp_app_domain` | resource `ui.domain` | — |
| `widget_domain` | — | resource `openai/widgetDomain`, only when given |
| `tool_meta(invoking=, invoked=)` | — | tool `openai/toolInvocation/*`, only when given |

ChatGPT enforces `ui.visibility` in developer mode. The visibility aliases stay
because whether a reviewed, directory-listed app enforces it the same way has not
been measured, and they are derived from `ui.visibility`, so they cannot disagree
with it.

The two origins stay separate inputs because the hosts disagree on the value:
ChatGPT takes an origin the developer declares, while Claude derives
`sha256(<connector URL>)[:32] + ".claudemcpcontent.com"` and rejects anything else.
Leave both unset unless the component needs a stable origin. Every host reads
`ui.domain` from the one resource, so `mcp_app_domain` reaches ChatGPT too: set it
only when each host the server targets accepts that value.

`tool_meta(widget_accessible=)` still works and warns: it is
`visibility=["model", "app"]` or `visibility=["model"]`.

## Sign-in

A server that requires auth declares it on each tool, and answers a call it cannot
authorize with a result carrying the challenge. ChatGPT needs both to offer sign-in
mid-conversation ([Apps SDK auth guide](https://developers.openai.com/apps-sdk/build/auth)).

```python
from typing import Annotated

from mcp.types import CallToolResult
from nimblebrain_synapse import auth_error_result

@mcp.tool(meta=report_ui.tool_meta(security_schemes=[{"type": "oauth2", "scopes": ["report.read"]}]))
async def analyze_domain(domain: str) -> Annotated[CallToolResult, Dossier]:
    if not signed_in():
        return auth_error_result(
            resource_metadata="https://example.com/.well-known/oauth-protected-resource",
            error="insufficient_scope",
            description="Sign in to analyze a domain",
        )
    return build_dossier(domain)  # a Dossier still becomes structuredContent
```

`securitySchemes` rides the tool's `_meta`, which ChatGPT documents as the mirror for
clients that read only `_meta`. The MCP SDK builds a tool descriptor from a fixed set
of fields, so the top-level form cannot be emitted through it.

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
— that *is* the extension it implements, and the few ChatGPT keys above ride
alongside in `_meta` keys the spec does not claim. So a server uses `SynapseUI`
**instead of** `mcp.server.apps.Apps`, not next to it: two extensions cannot share
an identifier.

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

What both halves share is the **wire protocol** — the `ui://` resource MIME, the
`_meta` keys, and the data-element contract:

- ext-apps `2026-01-26`
- MCP Apps (SEP-1865)

### MCP SDK compatibility

**This package requires mcp 2.x from 2.1** (`mcp>=2.1.0,<3`) and does not run on 1.x. It is
built on two things that exist only in 2.x: the SEP-2133 extension interface
(`mcp.server.extension.Extension`), and `mcp.server.apps` for the MCP Apps
identifier and MIME. On 1.x the equivalent of `intercept_tool_call` did not exist,
and this package reached into `FastMCP`'s private handler registry to get one — so
there is no shape that serves both majors, and the range is a single major rather
than a span.

The floor is 2.1.0 because 2.0.0 validates an error result from a tool with
structured output against its output schema and replaces it, dropping the challenge
`auth_error_result` carries.

The upper bound is deliberate. `mcp` 2.0 reached fresh installs of this package
through an uncapped `>=` floor and broke them, which is what the cap prevents from
happening again at 3.0.

Releases publish on a `nimblebrain-synapse-v*` tag (distinct from the npm `v*` tags).

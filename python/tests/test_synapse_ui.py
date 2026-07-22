"""Tests for the SynapseUI server helper — no network.

Covers HTML preparation (SDK inlining + data baking), the `<script>`-safe escape
(the XSS defense), the mcp-ui embedded resource, the `_meta` emitters, and the
FastMCP wiring (dual-MIME registration + the bound CallToolResult injection).
"""

from __future__ import annotations

from mcp import types
from mcp.server.fastmcp import FastMCP
from pydantic import BaseModel

from nimblebrain_synapse import SynapseUI
from nimblebrain_synapse.server import DATA_MARKER, SDK_MARKER

UI_URI = "ui://test/report"


class _IntegrationReport(BaseModel):
    """Module-level model so FastMCP can resolve the tool's return annotation
    and populate structuredContent in the real-FastMCP integration test."""

    domain: str
    company: dict


TEMPLATE = f"""<!DOCTYPE html>
<html><head><title>t</title></head><body>
<script type="application/json" id="synapse-ui-data">{DATA_MARKER}</script>
<div id="app"></div>
{SDK_MARKER}
<script>var s = window.SynapseUI.connect(); s.onData(function(){{}});</script>
</body></html>"""


def _ui() -> SynapseUI:
    return SynapseUI(uri=UI_URI, template=TEMPLATE)


def _dossier() -> dict:
    return {"domain": "example.com", "company": {"name": "Example Co"}}


def test_template_inlines_sdk_and_keeps_data_marker():
    html = _ui().template_html()
    assert SDK_MARKER not in html  # marker replaced
    assert "window.SynapseUI" in html  # SDK inlined
    assert DATA_MARKER in html  # served template stays data-free


def test_render_bakes_data_and_removes_marker():
    html = _ui().render_html(_dossier())
    assert DATA_MARKER not in html
    assert '"example.com"' in html
    assert "window.SynapseUI" in html  # SDK still present in embedded copy


def test_safe_json_escapes_script_breakout_but_keeps_spaces():
    out = SynapseUI._safe_json({"x": "</script><img onerror=1>", "y": "two words"})
    assert "</script>" not in out
    assert "\\u003c" in out and "\\u003e" in out
    assert "two words" in out  # ordinary spaces preserved


def test_xss_probe_hostile_company_name_stays_inert():
    """A hostile value in the payload cannot close the <script> or inject markup."""
    hostile = "</script><script>alert('xss')</script>"
    html = _ui().render_html({"domain": "evil.test", "company": {"name": hostile}})
    # The raw breakout sequence must not appear in the rendered HTML.
    assert "</script><script>alert" not in html
    # It survives as escaped, inert JSON.
    assert "\\u003c/script\\u003e" in html


def test_embedded_resource_shape():
    res = _ui().embedded_resource(_dossier())
    assert res.type == "resource"
    rc = res.resource
    assert isinstance(rc, types.TextResourceContents)
    assert str(rc.uri) == UI_URI
    assert rc.mimeType == "text/html"
    assert "example.com" in rc.text
    assert res.meta == {"mcpui.dev/ui-preferred-frame-size": ["100%", "auto"]}


def test_tool_and_result_meta():
    ui = _ui()
    tm = ui.tool_meta(invoking="Working…", invoked="Done")
    assert tm["openai/outputTemplate"] == UI_URI
    assert tm["openai/widgetAccessible"] is True
    assert tm["openai/toolInvocation/invoking"] == "Working…"
    assert tm["openai/toolInvocation/invoked"] == "Done"
    # MCP Apps standard: nested resourceUri points at the sibling mcp-app resource.
    assert tm["ui"] == {"resourceUri": f"{UI_URI}-mcp-app"}
    assert ui.result_meta() == {"openai/outputTemplate": UI_URI}


def test_register_installs_both_host_resources():
    mcp = FastMCP("test")
    _ui().register(mcp)
    resources = {str(r.uri): r.mime_type for r in mcp._resource_manager.list_resources()}
    # ChatGPT skybridge (unchanged) + the MCP Apps standard resource for Claude.
    assert resources.get(UI_URI) == "text/html+skybridge"
    assert resources.get(f"{UI_URI}-mcp-app") == "text/html;profile=mcp-app"


class _CapturingMCP:
    """Records the ``meta`` each ``@mcp.resource(...)`` registration carries."""

    def __init__(self) -> None:
        self.registered: dict[str, dict] = {}

    def resource(self, uri: str, *, mime_type: str, meta: dict):
        self.registered[uri] = {"mime_type": mime_type, "meta": meta}
        return lambda fn: fn


def test_register_routes_each_origin_to_its_own_host_dialect():
    """The two origins are distinct host fields: the OpenAI widget domain reaches
    only ``openai/widgetDomain``, the ext-apps origin only ``ui.domain`` — never
    the same value fed to both (an OpenAI origin in ``ui.domain`` fails a Claude
    host's validation and the component does not render)."""
    mcp = _CapturingMCP()
    SynapseUI(
        uri=UI_URI,
        template=TEMPLATE,
        widget_domain="https://example.com",
        mcp_app_domain="abc123.claudemcpcontent.com",
    ).register(mcp)

    # ChatGPT (skybridge) — flat openai/* dialect, snake_case CSP.
    sky = mcp.registered[UI_URI]["meta"]
    assert sky["openai/widgetPrefersBorder"] is True
    assert sky["openai/widgetDomain"] == "https://example.com"
    assert sky["openai/widgetCSP"] == {"connect_domains": [], "resource_domains": []}

    # MCP Apps standard — nested ui.* dialect, camelCase CSP.
    app = mcp.registered[f"{UI_URI}-mcp-app"]["meta"]["ui"]
    assert app["prefersBorder"] is True
    assert app["domain"] == "abc123.claudemcpcontent.com"
    assert app["csp"] == {"connectDomains": [], "resourceDomains": []}


def test_widget_domain_never_leaks_into_ext_apps_ui_domain():
    """Regression: `widget_domain` alone must not populate `ui.domain`. The OpenAI
    origin is not a valid ext-apps sandbox origin, so an ext-apps host would reject
    it — the omission lets the host default the origin instead."""
    mcp = _CapturingMCP()
    SynapseUI(uri=UI_URI, template=TEMPLATE, widget_domain="https://example.com").register(mcp)

    assert mcp.registered[UI_URI]["meta"]["openai/widgetDomain"] == "https://example.com"
    assert "domain" not in mcp.registered[f"{UI_URI}-mcp-app"]["meta"]["ui"]


def test_register_carries_non_empty_allowlists_and_omits_domains_when_unset():
    mcp = _CapturingMCP()
    SynapseUI(
        uri=UI_URI,
        template=TEMPLATE,
        connect_domains=["https://api.example.com"],
        resource_domains=["https://cdn.example.com"],
    ).register(mcp)

    sky = mcp.registered[UI_URI]["meta"]
    # CSP is always present (a self-contained default); each origin only when provided.
    assert sky["openai/widgetCSP"]["connect_domains"] == ["https://api.example.com"]
    assert sky["openai/widgetCSP"]["resource_domains"] == ["https://cdn.example.com"]
    assert "openai/widgetDomain" not in sky
    assert "domain" not in mcp.registered[f"{UI_URI}-mcp-app"]["meta"]["ui"]


def test_bind_injects_embedded_resource_and_result_meta():
    mcp = FastMCP("test")
    ui = _ui()
    ui.bind(mcp, tool="analyze")

    ctr = types.CallToolResult(
        content=[types.TextContent(type="text", text="{}")],
        structuredContent=_dossier(),
        isError=False,
    )
    # Drive the bound handler by calling the wrapped request handler directly is
    # heavy; instead exercise the attach path the handler delegates to.
    out = ui._attach(types.ServerResult(ctr), lambda d: bool(d)).root
    assert isinstance(out, types.CallToolResult)
    assert out.meta is not None
    assert out.meta["openai/outputTemplate"] == UI_URI
    embedded = [c for c in out.content if isinstance(c, types.EmbeddedResource)]
    assert len(embedded) == 1
    assert "example.com" in embedded[0].resource.text


def test_bind_skips_errors_and_empty_results():
    ui = _ui()
    err = types.ServerResult(types.CallToolResult(content=[], isError=True))
    err_root = err.root
    assert ui._attach(err, lambda d: bool(d)).root is err_root
    assert err_root.meta is None

    empty = types.ServerResult(
        types.CallToolResult(content=[], structuredContent=None, isError=False)
    )
    out = ui._attach(empty, lambda d: bool(d)).root
    assert out.meta is None
    assert all(not isinstance(c, types.EmbeddedResource) for c in out.content)


def test_bind_respects_should_render_predicate():
    ui = _ui()
    ctr = types.CallToolResult(content=[], structuredContent={"unrelated": True}, isError=False)
    out = ui._attach(types.ServerResult(ctr), lambda d: "domain" in d).root
    # Predicate rejects → no injection.
    assert out.meta is None
    assert all(not isinstance(c, types.EmbeddedResource) for c in out.content)


class _FakeServer:
    """Minimal stand-in for FastMCP's low-level server: just the handler registry."""

    def __init__(self, prev):
        self.request_handlers = {types.CallToolRequest: prev}


class _FakeMcp:
    def __init__(self, prev):
        self._mcp_server = _FakeServer(prev)


def _call_tool_request(name: str) -> types.CallToolRequest:
    return types.CallToolRequest(
        method="tools/call",
        params=types.CallToolRequestParams(name=name, arguments={}),
    )


async def test_bind_dispatches_by_tool_name():
    """The installed wrapper injects for the bound tool and passes others through."""
    ui = _ui()

    async def prev(req: types.CallToolRequest) -> types.ServerResult:
        return types.ServerResult(
            types.CallToolResult(
                content=[types.TextContent(type="text", text="{}")],
                structuredContent=_dossier(),
                isError=False,
            )
        )

    mcp = _FakeMcp(prev)
    ui.bind(mcp, tool="analyze")
    handler = mcp._mcp_server.request_handlers[types.CallToolRequest]

    # Bound tool → embedded resource + result meta injected.
    hit = (await handler(_call_tool_request("analyze"))).root
    assert hit.meta is not None and hit.meta["openai/outputTemplate"] == UI_URI
    assert any(isinstance(c, types.EmbeddedResource) for c in hit.content)

    # Other tool → passed through untouched.
    miss = (await handler(_call_tool_request("other"))).root
    assert miss.meta is None
    assert all(not isinstance(c, types.EmbeddedResource) for c in miss.content)


async def test_bind_against_real_fastmcp_drives_installed_handler():
    """Bind against a real FastMCP and drive a real CallToolRequest through the
    installed handler. The _FakeMcp tests can't catch drift in mcp's internal
    request-handler registry — exactly the risk the bind() monkey-patch carries."""
    mcp = FastMCP("test")

    @mcp.tool()
    def analyze(domain: str) -> _IntegrationReport:
        return _IntegrationReport(domain=domain, company={"name": "Example Co"})

    ui = _ui()
    ui.register(mcp)
    ui.bind(mcp, tool="analyze")

    handler = mcp._mcp_server.request_handlers[types.CallToolRequest]
    result = await handler(
        types.CallToolRequest(
            method="tools/call",
            params=types.CallToolRequestParams(name="analyze", arguments={"domain": "example.com"}),
        )
    )
    root = result.root
    assert isinstance(root, types.CallToolResult)
    assert not root.isError
    # FastMCP built structuredContent the real way; the patch appended the UI + meta.
    assert root.meta is not None
    assert root.meta["openai/outputTemplate"] == UI_URI
    embedded = [c for c in root.content if isinstance(c, types.EmbeddedResource)]
    assert len(embedded) == 1
    assert "example.com" in embedded[0].resource.text


async def test_bind_is_idempotent_per_tool():
    """Binding the same tool twice must not chain two wrappers (double-inject)."""
    ui = _ui()

    async def prev(req: types.CallToolRequest) -> types.ServerResult:
        return types.ServerResult(
            types.CallToolResult(
                content=[types.TextContent(type="text", text="{}")],
                structuredContent=_dossier(),
                isError=False,
            )
        )

    mcp = _FakeMcp(prev)
    ui.bind(mcp, tool="analyze")
    ui.bind(mcp, tool="analyze")  # second bind is a no-op

    handler = mcp._mcp_server.request_handlers[types.CallToolRequest]
    root = (await handler(_call_tool_request("analyze"))).root
    embedded = [c for c in root.content if isinstance(c, types.EmbeddedResource)]
    assert len(embedded) == 1  # injected exactly once, not twice

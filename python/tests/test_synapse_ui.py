"""Tests for the SynapseUI server helper — no network.

Covers HTML preparation (SDK inlining + data baking), the `<script>`-safe escape
(the XSS defense), the mcp-ui embedded resource, the `_meta` emitters, and the
extension wiring (dual-MIME resource contribution + the bound `tools/call`
interception).
"""

from __future__ import annotations

from typing import Any

import pytest
from mcp import Client, types
from mcp.server.apps import EXTENSION_ID
from mcp.server.mcpserver import MCPServer
from pydantic import BaseModel

from nimblebrain_synapse import SynapseUI
from nimblebrain_synapse.server import DATA_MARKER, SDK_MARKER

UI_URI = "ui://test/report"


class _IntegrationReport(BaseModel):
    """Module-level model so MCPServer can resolve the tool's return annotation
    and populate structuredContent in the real-server integration test."""

    domain: str
    company: dict


TEMPLATE = f"""<!DOCTYPE html>
<html><head><title>t</title></head><body>
<script type="application/json" id="synapse-ui-data">{DATA_MARKER}</script>
<div id="app"></div>
{SDK_MARKER}
<script>var s = window.SynapseUI.connect(); s.onData(function(){{}});</script>
</body></html>"""


def _ui(**kwargs: Any) -> SynapseUI:
    return SynapseUI(uri=UI_URI, template=TEMPLATE, **kwargs)


def _dossier() -> dict:
    return {"domain": "example.com", "company": {"name": "Example Co"}}


def _result(data: dict | None = None, *, is_error: bool = False) -> types.CallToolResult:
    return types.CallToolResult(
        content=[types.TextContent(type="text", text="{}")],
        structured_content=data,
        is_error=is_error,
    )


def _contributed(ui: SynapseUI) -> dict[str, Any]:
    """The two resources the extension contributes, keyed by URI."""
    return {str(binding.resource.uri): binding.resource for binding in ui.resources()}


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
    assert rc.mime_type == "text/html"
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


def test_advertises_the_mcp_apps_extension_identifier():
    """The extension is the spec's MCP Apps one, not a NimbleBrain-private id — a
    host gating on `io.modelcontextprotocol/ui` must see it advertised."""
    assert SynapseUI.identifier == EXTENSION_ID == "io.modelcontextprotocol/ui"


def test_contributes_both_host_resources():
    contributed = _contributed(_ui())
    # ChatGPT skybridge + the MCP Apps standard resource for Claude, same HTML.
    assert contributed[UI_URI].mime_type == "text/html+skybridge"
    assert contributed[f"{UI_URI}-mcp-app"].mime_type == "text/html;profile=mcp-app"
    assert contributed[UI_URI].text == contributed[f"{UI_URI}-mcp-app"].text
    assert "window.SynapseUI" in contributed[UI_URI].text


def test_each_origin_routes_to_its_own_host_dialect():
    """The two origins are distinct host fields: the OpenAI widget domain reaches
    only ``openai/widgetDomain``, the ext-apps origin only ``ui.domain`` — never
    the same value fed to both (an OpenAI origin in ``ui.domain`` fails a Claude
    host's validation and the component does not render)."""
    contributed = _contributed(
        _ui(widget_domain="https://example.com", mcp_app_domain="abc123.claudemcpcontent.com")
    )

    # ChatGPT (skybridge) — flat openai/* dialect, snake_case CSP.
    sky = contributed[UI_URI].meta
    assert sky is not None
    assert sky["openai/widgetPrefersBorder"] is True
    assert sky["openai/widgetDomain"] == "https://example.com"
    assert sky["openai/widgetCSP"] == {"connect_domains": [], "resource_domains": []}

    # MCP Apps standard — nested ui.* dialect, camelCase CSP.
    app_meta = contributed[f"{UI_URI}-mcp-app"].meta
    assert app_meta is not None
    app = app_meta["ui"]
    assert app["prefersBorder"] is True
    assert app["domain"] == "abc123.claudemcpcontent.com"
    assert app["csp"] == {"connectDomains": [], "resourceDomains": []}


def test_widget_domain_never_leaks_into_ext_apps_ui_domain():
    """Regression: `widget_domain` alone must not populate `ui.domain`. The OpenAI
    origin is not a valid ext-apps sandbox origin, so an ext-apps host would reject
    it — the omission lets the host default the origin instead."""
    contributed = _contributed(_ui(widget_domain="https://example.com"))

    sky = contributed[UI_URI].meta
    app_meta = contributed[f"{UI_URI}-mcp-app"].meta
    assert sky is not None and app_meta is not None
    assert sky["openai/widgetDomain"] == "https://example.com"
    assert "domain" not in app_meta["ui"]


def test_carries_non_empty_allowlists_and_omits_domains_when_unset():
    contributed = _contributed(
        _ui(
            connect_domains=["https://api.example.com"],
            resource_domains=["https://cdn.example.com"],
        )
    )

    sky = contributed[UI_URI].meta
    app_meta = contributed[f"{UI_URI}-mcp-app"].meta
    assert sky is not None and app_meta is not None
    # CSP is always present (a self-contained default); each origin only when provided.
    assert sky["openai/widgetCSP"]["connect_domains"] == ["https://api.example.com"]
    assert sky["openai/widgetCSP"]["resource_domains"] == ["https://cdn.example.com"]
    assert "openai/widgetDomain" not in sky
    assert "domain" not in app_meta["ui"]


def test_resource_meta_merges_onto_the_skybridge_resource():
    """Host keys this class does not model still reach the ChatGPT resource."""
    contributed = _contributed(_ui(resource_meta={"openai/widgetDescription": "A report"}))
    sky = contributed[UI_URI].meta
    assert sky is not None
    assert sky["openai/widgetDescription"] == "A report"
    assert sky["openai/widgetPrefersBorder"] is True  # modelled keys survive the merge


def test_attach_default_is_pointer_only_no_embedded():
    """Default (no embed): the result carries the `_meta` template pointer so a
    standard host renders the contributed component, but NO embedded UI HTML rides
    in the content — that `audience: ["user"]` blob must not reach a plain client's
    model context."""
    ui = _ui()
    ui.bind("analyze")
    out = ui._attach(_result(_dossier()), ui._bound["analyze"])
    assert out.meta is not None
    assert out.meta["openai/outputTemplate"] == UI_URI  # pointer emitted
    assert all(not isinstance(c, types.EmbeddedResource) for c in out.content)  # no blob


def test_attach_embed_resource_injects_embedded_and_meta():
    """Opt-in (embed=True): the legacy mcp-ui copy is baked into the content in
    addition to the `_meta` pointer."""
    ui = _ui()
    ui.bind("analyze", embed_resource=True)
    out = ui._attach(_result(_dossier()), ui._bound["analyze"])
    assert out.meta is not None
    assert out.meta["openai/outputTemplate"] == UI_URI
    embedded = [c for c in out.content if isinstance(c, types.EmbeddedResource)]
    assert len(embedded) == 1
    assert "example.com" in embedded[0].resource.text


def test_attach_skips_errors_and_empty_results():
    ui = _ui()
    ui.bind("analyze")
    binding = ui._bound["analyze"]

    err = _result(None, is_error=True)
    assert ui._attach(err, binding) is err
    assert err.meta is None

    empty = ui._attach(_result(None), binding)
    assert empty.meta is None
    assert all(not isinstance(c, types.EmbeddedResource) for c in empty.content)


def test_attach_respects_should_render_predicate():
    ui = _ui()
    ui.bind("analyze", should_render=lambda d: "domain" in d)
    out = ui._attach(_result({"unrelated": True}), ui._bound["analyze"])
    # Predicate rejects → no injection.
    assert out.meta is None
    assert all(not isinstance(c, types.EmbeddedResource) for c in out.content)


def test_rebinding_a_tool_replaces_its_options():
    ui = _ui()
    ui.bind("analyze", embed_resource=True)
    ui.bind("analyze")  # same tool, new options
    out = ui._attach(_result(_dossier()), ui._bound["analyze"])
    assert out.meta is not None
    assert all(not isinstance(c, types.EmbeddedResource) for c in out.content)


async def test_interceptor_dispatches_by_tool_name():
    """The interceptor injects for a bound tool and passes others through, without
    ever reaching into the server. Bound with embed_resource=True, so a hit carries
    the embedded copy — proving the flag threads through into `_attach`."""
    ui = _ui()
    ui.bind("analyze", embed_resource=True)

    async def call_next(_ctx: Any) -> types.CallToolResult:
        return _result(_dossier())

    async def call(name: str) -> types.CallToolResult:
        out = await ui.intercept_tool_call(
            types.CallToolRequestParams(name=name, arguments={}), None, call_next
        )
        assert isinstance(out, types.CallToolResult)
        return out

    hit = await call("analyze")
    assert hit.meta is not None and hit.meta["openai/outputTemplate"] == UI_URI
    assert any(isinstance(c, types.EmbeddedResource) for c in hit.content)

    miss = await call("other")
    assert miss.meta is None
    assert all(not isinstance(c, types.EmbeddedResource) for c in miss.content)


async def test_interceptor_passes_through_non_call_tool_results():
    """`tools/call` can resolve to an InputRequiredResult rather than a
    CallToolResult; the interceptor must hand that back untouched."""
    ui = _ui()
    ui.bind("analyze")
    sentinel = types.InputRequiredResult(request_state="s1")

    async def call_next(_ctx: Any) -> types.InputRequiredResult:
        return sentinel

    out = await ui.intercept_tool_call(
        types.CallToolRequestParams(name="analyze", arguments={}), None, call_next
    )
    assert out is sentinel


async def test_against_a_real_server_over_a_real_client():
    """Wire a real MCPServer with the extension and drive real `tools/call` requests
    through an in-process client. A hand-rolled `call_next` cannot catch drift in how
    the SDK composes and installs interceptors, nor in how it serializes what one
    returns — exactly the seam this package now depends on.

    Covers both the shipped default (pointer only) and the embed_resource opt-in on
    the same server, so the production path is anchored end-to-end — not just the
    opt-in — and the per-tool flag is proven to survive the composed chain.

    The two binds straddle `MCPServer(...)` on purpose: `bind` is documented to work
    on either side of construction, and only `resources()` is read at construction,
    so nothing but this test stops a later refactor from snapshotting `_bound` too
    and silently dropping the after case."""
    ui = _ui()
    ui.bind("analyze")  # shipped default: pointer only — bound BEFORE construction
    mcp = MCPServer("test", extensions=[ui])

    @mcp.tool(meta=ui.tool_meta())
    def analyze(domain: str) -> _IntegrationReport:
        return _IntegrationReport(domain=domain, company={"name": "Example Co"})

    @mcp.tool(meta=ui.tool_meta())
    def analyze_embed(domain: str) -> _IntegrationReport:
        return _IntegrationReport(domain=domain, company={"name": "Example Co"})

    @mcp.tool()
    def plain(domain: str) -> _IntegrationReport:
        return _IntegrationReport(domain=domain, company={})

    # Opt-in legacy embed — bound AFTER construction, and after the tools exist.
    ui.bind("analyze_embed", embed_resource=True)

    async with Client(mcp) as client:
        # The extension's resources reached the server through `extensions=[...]`.
        served = {str(r.uri): r.mime_type for r in (await client.list_resources()).resources}
        assert served[UI_URI] == "text/html+skybridge"
        assert served[f"{UI_URI}-mcp-app"] == "text/html;profile=mcp-app"

        # The descriptor `_meta` a host binds on rode `tools/list` intact.
        listed = {t.name: t.meta for t in (await client.list_tools()).tools}
        assert listed["analyze"] is not None
        assert listed["analyze"]["ui"] == {"resourceUri": f"{UI_URI}-mcp-app"}

        async def call(name: str) -> types.CallToolResult:
            result = await client.call_tool(name, {"domain": "example.com"})
            assert not result.is_error
            return result

        # Shipped default: the server built structuredContent the real way; the
        # interceptor mirrored the pointer and appended NO UI blob.
        default = await call("analyze")
        assert default.meta is not None
        assert default.meta["openai/outputTemplate"] == UI_URI
        assert all(not isinstance(c, types.EmbeddedResource) for c in default.content)

        # Opt-in: the same pointer, plus the embedded copy carrying the server-built data.
        embed = await call("analyze_embed")
        assert embed.meta is not None
        assert embed.meta["openai/outputTemplate"] == UI_URI
        embedded = [c for c in embed.content if isinstance(c, types.EmbeddedResource)]
        assert len(embedded) == 1
        assert "example.com" in embedded[0].resource.text

        # An unbound tool on the same server is untouched by the interceptor.
        unbound = (await call("plain")).meta or {}
        assert "openai/outputTemplate" not in unbound


def test_two_synapse_uis_cannot_share_one_server():
    """Both instances advertise the MCP Apps identifier, so the SDK rejects the
    second. One component per server is the supported shape; the failure is loud."""
    with pytest.raises(ValueError, match="already registered"):
        MCPServer("test", extensions=[_ui(), SynapseUI(uri="ui://test/other", template=TEMPLATE)])

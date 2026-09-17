"""Tests for the SynapseUI server helper — no network.

Covers HTML preparation (SDK inlining + data baking), the `<script>`-safe escape
(the XSS defense), the mcp-ui embedded resource, the `_meta` emitters, the
extension wiring (the one resource it contributes + the bound `tools/call`
interception), and the sign-in error result.
"""

from __future__ import annotations

from typing import Annotated, Any

import pytest
from mcp import Client, types
from mcp.server.apps import EXTENSION_ID
from mcp.server.mcpserver import MCPServer
from pydantic import BaseModel

from nimblebrain_synapse import SynapseUI, auth_error_result
from nimblebrain_synapse.server import DATA_MARKER, SDK_MARKER

UI_URI = "ui://test/report"
RESOURCE_METADATA = "https://example.com/.well-known/oauth-protected-resource"
_CHALLENGE = (
    f'Bearer resource_metadata="{RESOURCE_METADATA}", '
    'error="insufficient_scope", error_description="Sign in to continue"'
)


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
    """The resources the extension contributes, keyed by URI."""
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


def test_tool_meta():
    ui = _ui()
    tm = ui.tool_meta(invoking="Working…", invoked="Done")
    # MCP Apps standard: nested resourceUri points at the one resource, and
    # visibility is explicit at the spec's own default.
    assert tm["ui"] == {"resourceUri": UI_URI, "visibility": ["model", "app"]}
    # ChatGPT resolves ui.resourceUri itself, so no template alias is emitted.
    assert "openai/outputTemplate" not in tm
    assert tm["openai/widgetAccessible"] is True
    assert "openai/visibility" not in tm
    assert tm["openai/toolInvocation/invoking"] == "Working…"
    assert tm["openai/toolInvocation/invoked"] == "Done"
    # No auth declared, so none emitted.
    assert "securitySchemes" not in tm


def test_status_text_is_emitted_only_when_declared():
    assert not any(key.startswith("openai/toolInvocation/") for key in _ui().tool_meta())


@pytest.mark.parametrize(
    ("visibility", "widget_accessible", "openai_visibility"),
    [
        (["model", "app"], True, None),
        (["model"], False, None),
        (["app"], True, "private"),
    ],
)
def test_one_visibility_reaches_the_spec_key_and_both_chatgpt_aliases(
    visibility: list[str], widget_accessible: bool, openai_visibility: str | None
):
    """The caller states who may call the tool once; the spec key and both ChatGPT
    aliases agree with it, so no host is left reading a stale default."""
    tm = _ui().tool_meta(visibility=visibility)  # ty: ignore[invalid-argument-type]
    assert tm["ui"]["visibility"] == visibility
    assert tm["openai/widgetAccessible"] is widget_accessible
    assert tm.get("openai/visibility") == openai_visibility


def test_widget_accessible_is_a_deprecated_spelling_of_visibility():
    ui = _ui()
    with pytest.warns(DeprecationWarning, match="visibility"):
        tm = ui.tool_meta(widget_accessible=False)
    assert tm["ui"]["visibility"] == ["model"]
    assert tm["openai/widgetAccessible"] is False

    with pytest.raises(TypeError, match="not both"):
        ui.tool_meta(visibility=["model"], widget_accessible=True)


@pytest.mark.parametrize("visibility", [[], ["user"], ["model", "everyone"]])
def test_rejects_a_visibility_no_host_can_honour(visibility: list[str]):
    with pytest.raises(ValueError, match="visibility"):
        _ui().tool_meta(visibility=visibility)  # ty: ignore[invalid-argument-type]


def test_repeated_visibility_entries_collapse():
    assert _ui().tool_meta(visibility=["app", "app"])["ui"]["visibility"] == ["app"]


def test_security_schemes_ride_the_tool_descriptor_meta():
    schemes = [{"type": "noauth"}, {"type": "oauth2", "scopes": ["report.read"]}]
    tm = _ui().tool_meta(security_schemes=schemes)
    assert tm["securitySchemes"] == schemes


def test_advertises_the_mcp_apps_extension_identifier():
    """The extension is the spec's MCP Apps one, not a NimbleBrain-private id — a
    host gating on `io.modelcontextprotocol/ui` must see it advertised."""
    assert SynapseUI.identifier == EXTENSION_ID == "io.modelcontextprotocol/ui"


def test_contributes_one_resource_under_the_mcp_apps_mime():
    contributed = _contributed(_ui())
    assert list(contributed) == [UI_URI]
    resource = contributed[UI_URI]
    assert resource.mime_type == "text/html;profile=mcp-app"
    assert "window.SynapseUI" in resource.text
    assert resource.meta == {
        "ui": {"prefersBorder": True, "csp": {"connectDomains": [], "resourceDomains": []}},
        "openai/widgetCSP": {"connect_domains": [], "resource_domains": []},
        "openai/widgetPrefersBorder": True,
    }


def test_each_origin_reaches_only_its_own_key():
    """The two origins are distinct inputs: the OpenAI widget domain reaches only
    ``openai/widgetDomain``, the ext-apps origin only ``ui.domain`` — never the same
    value fed to both (an OpenAI origin in a Claude-read ``ui.domain`` fails the
    host's validation and the component does not render)."""
    meta = _contributed(
        _ui(widget_domain="https://example.com", mcp_app_domain="abc123.claudemcpcontent.com")
    )[UI_URI].meta
    assert meta == {
        "ui": {
            "prefersBorder": True,
            "domain": "abc123.claudemcpcontent.com",
            "csp": {"connectDomains": [], "resourceDomains": []},
        },
        "openai/widgetCSP": {"connect_domains": [], "resource_domains": []},
        "openai/widgetPrefersBorder": True,
        "openai/widgetDomain": "https://example.com",
    }


def test_widget_domain_never_leaks_into_ui_domain():
    """Regression: `widget_domain` alone must not populate `ui.domain`. The OpenAI
    origin is not a valid sandbox origin there, so an ext-apps host would reject it —
    the omission lets the host default the origin."""
    meta = _contributed(_ui(widget_domain="https://example.com"))[UI_URI].meta
    assert meta is not None
    assert meta["openai/widgetDomain"] == "https://example.com"
    assert "domain" not in meta["ui"]


def test_one_allowlist_reaches_ui_csp():
    meta = _contributed(
        _ui(
            connect_domains=["https://api.example.com"],
            resource_domains=["https://cdn.example.com"],
        )
    )[UI_URI].meta
    assert meta is not None
    assert meta["ui"]["csp"] == {
        "connectDomains": ["https://api.example.com"],
        "resourceDomains": ["https://cdn.example.com"],
    }
    # CSP is always present (a self-contained default); each origin only when provided.
    assert "domain" not in meta["ui"]
    assert "openai/widgetDomain" not in meta


def test_one_allowlist_reaches_both_csp_dialects():
    """ChatGPT was measured (2026-09-17, developer mode) applying no policy at all to a
    frame whose resource carried `ui.csp` alone; the key it read is `openai/widgetCSP`.
    Both are derived from the one pair of attributes, so they cannot name different
    origins."""
    meta = _contributed(
        _ui(
            connect_domains=["https://api.example.com"],
            resource_domains=["https://cdn.example.com", "data:"],
        )
    )[UI_URI].meta
    assert meta is not None
    assert meta["ui"]["csp"] == {
        "connectDomains": ["https://api.example.com"],
        "resourceDomains": ["https://cdn.example.com", "data:"],
    }
    assert meta["openai/widgetCSP"] == {
        "connect_domains": ["https://api.example.com"],
        "resource_domains": ["https://cdn.example.com", "data:"],
    }


def test_the_chatgpt_csp_alias_is_snake_case():
    """The spelling is the whole point: ChatGPT reads `connect_domains` /
    `resource_domains`, and a camelCase alias is ignored exactly as a missing key is —
    silently, with the frame then running under no policy."""
    alias = _contributed(_ui(connect_domains=["https://api.example.com"]))[UI_URI].meta[
        "openai/widgetCSP"
    ]
    assert sorted(alias) == ["connect_domains", "resource_domains"]


def test_the_border_preference_reaches_both_dialects():
    meta = _contributed(_ui())[UI_URI].meta
    assert meta is not None
    assert meta["ui"]["prefersBorder"] is True
    assert meta["openai/widgetPrefersBorder"] is True


def test_auth_error_result_carries_the_challenge_chatgpt_reads():
    result = auth_error_result(
        resource_metadata=RESOURCE_METADATA,
        error="insufficient_scope",
        description="Sign in to continue",
    )
    assert result.is_error is True
    assert result.meta == {"mcp/www_authenticate": [_CHALLENGE]}
    # A client that ignores the challenge still shows why the call failed.
    assert result.content == [types.TextContent(type="text", text="Sign in to continue")]


def test_auth_error_result_quotes_cannot_end_a_parameter_early():
    """A `"` in the description would otherwise close `error_description` and let
    the rest parse as a new challenge parameter."""
    result = auth_error_result(
        resource_metadata=RESOURCE_METADATA,
        error="invalid_token",
        description='expired", error="invalid_request \\',
    )
    assert result.meta is not None
    (challenge,) = result.meta["mcp/www_authenticate"]
    assert challenge.endswith('error_description="expired\\", error=\\"invalid_request \\\\"')


def test_attach_default_leaves_the_result_alone():
    """Default (no embed): a host renders from the descriptor binding, so the result
    gains nothing — no `_meta`, and NO embedded UI HTML in the content, where that
    `audience: ["user"]` blob would reach a plain client's model context."""
    ui = _ui()
    ui.bind("analyze")
    out = ui._attach(_result(_dossier()), ui._bound["analyze"])
    assert out.meta is None
    assert all(not isinstance(c, types.EmbeddedResource) for c in out.content)


def test_attach_embed_resource_injects_embedded():
    """Opt-in (embed=True): the mcp-ui copy is baked into the content."""
    ui = _ui()
    ui.bind("analyze", embed_resource=True)
    out = ui._attach(_result(_dossier()), ui._bound["analyze"])
    assert out.meta is None
    embedded = [c for c in out.content if isinstance(c, types.EmbeddedResource)]
    assert len(embedded) == 1
    assert "example.com" in embedded[0].resource.text


def test_attach_skips_errors_and_empty_results():
    ui = _ui()
    ui.bind("analyze", embed_resource=True)
    binding = ui._bound["analyze"]

    err = _result(None, is_error=True)
    assert ui._attach(err, binding) is err
    assert err.meta is None

    empty = ui._attach(_result(None), binding)
    assert empty.meta is None
    assert all(not isinstance(c, types.EmbeddedResource) for c in empty.content)


def test_attach_respects_should_render_predicate():
    ui = _ui()
    ui.bind("analyze", should_render=lambda d: "domain" in d, embed_resource=True)
    out = ui._attach(_result({"unrelated": True}), ui._bound["analyze"])
    # Predicate rejects → no injection.
    assert out.meta is None
    assert all(not isinstance(c, types.EmbeddedResource) for c in out.content)


def test_rebinding_a_tool_replaces_its_options():
    ui = _ui()
    ui.bind("analyze", embed_resource=True)
    ui.bind("analyze")  # same tool, new options
    out = ui._attach(_result(_dossier()), ui._bound["analyze"])
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
    assert any(isinstance(c, types.EmbeddedResource) for c in hit.content)

    miss = await call("other")
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

    Covers both the shipped default (nothing added) and the embed_resource opt-in on
    the same server, so the production path is anchored end-to-end — not just the
    opt-in — and the per-tool flag is proven to survive the composed chain.

    The two binds straddle `MCPServer(...)` on purpose: `bind` is documented to work
    on either side of construction, and only `resources()` is read at construction,
    so nothing but this test stops a later refactor from snapshotting `_bound` too
    and silently dropping the after case."""
    ui = _ui()
    ui.bind("analyze")  # shipped default: nothing added — bound BEFORE construction
    mcp = MCPServer("test", extensions=[ui])
    schemes = [{"type": "oauth2", "scopes": ["report.read"]}]

    @mcp.tool(meta=ui.tool_meta(security_schemes=schemes))
    def analyze(domain: str) -> _IntegrationReport:
        return _IntegrationReport(domain=domain, company={"name": "Example Co"})

    @mcp.tool(meta=ui.tool_meta())
    def analyze_embed(domain: str) -> _IntegrationReport:
        return _IntegrationReport(domain=domain, company={"name": "Example Co"})

    @mcp.tool()
    def plain(domain: str) -> _IntegrationReport:
        return _IntegrationReport(domain=domain, company={})

    # Opt-in embed — bound AFTER construction, and after the tools exist.
    ui.bind("analyze_embed", embed_resource=True)

    async with Client(mcp) as client:
        # The extension's one resource reached the server through `extensions=[...]`,
        # with its MIME and its `_meta`, and reads back as the inlined component.
        (served,) = (await client.list_resources()).resources
        assert str(served.uri) == UI_URI
        assert served.mime_type == "text/html;profile=mcp-app"
        assert served.meta == {
            "ui": {"prefersBorder": True, "csp": {"connectDomains": [], "resourceDomains": []}},
            "openai/widgetCSP": {"connect_domains": [], "resource_domains": []},
            "openai/widgetPrefersBorder": True,
        }
        (read,) = (await client.read_resource(UI_URI)).contents
        assert isinstance(read, types.TextResourceContents)
        assert read.mime_type == "text/html;profile=mcp-app"
        assert "window.SynapseUI" in read.text

        # The descriptor `_meta` a host binds on rode `tools/list` intact.
        listed = {t.name: t.meta for t in (await client.list_tools()).tools}
        assert listed["analyze"] is not None
        assert listed["analyze"]["ui"] == {"resourceUri": UI_URI, "visibility": ["model", "app"]}
        assert listed["analyze"]["openai/widgetAccessible"] is True
        assert "openai/outputTemplate" not in listed["analyze"]
        assert listed["analyze"]["securitySchemes"] == schemes

        async def call(name: str) -> types.CallToolResult:
            result = await client.call_tool(name, {"domain": "example.com"})
            assert not result.is_error
            return result

        # Shipped default: the server built structuredContent the real way, and the
        # interceptor added no `_meta` and NO UI blob.
        default = await call("analyze")
        assert default.structured_content == {
            "domain": "example.com",
            "company": {"name": "Example Co"},
        }
        assert all(not isinstance(c, types.EmbeddedResource) for c in default.content)

        # Opt-in: the embedded copy carrying the server-built data.
        embed = await call("analyze_embed")
        embedded = [c for c in embed.content if isinstance(c, types.EmbeddedResource)]
        assert len(embedded) == 1
        assert "example.com" in embedded[0].resource.text

        # An unbound tool on the same server is untouched by the interceptor.
        unbound = await call("plain")
        assert all(not isinstance(c, types.EmbeddedResource) for c in unbound.content)


async def test_auth_error_result_reaches_the_client_through_a_real_server():
    """The challenge survives the SDK's result handling and the interceptor on a
    bound tool, at every supported mcp version."""
    ui = _ui()
    ui.bind("analyze")
    mcp = MCPServer("test", extensions=[ui])

    @mcp.tool(meta=ui.tool_meta(security_schemes=[{"type": "oauth2", "scopes": []}]))
    def analyze(domain: str) -> types.CallToolResult:
        return auth_error_result(
            resource_metadata=RESOURCE_METADATA,
            error="insufficient_scope",
            description="Sign in to continue",
        )

    async with Client(mcp) as client:
        refused = await client.call_tool("analyze", {"domain": "example.com"})
        assert refused.is_error
        assert refused.meta is not None
        assert refused.meta["mcp/www_authenticate"] == [_CHALLENGE]


async def test_auth_error_result_from_a_structured_tool():
    """On a tool that declares structured output, the error result skips output
    validation, and a successful call on the same tool still builds
    structuredContent."""
    ui = _ui()
    ui.bind("analyze")
    mcp = MCPServer("test", extensions=[ui])

    @mcp.tool(meta=ui.tool_meta(security_schemes=[{"type": "oauth2", "scopes": []}]))
    def analyze(domain: str) -> Annotated[types.CallToolResult, _IntegrationReport]:
        if domain == "signed-out.example":
            return auth_error_result(
                resource_metadata=RESOURCE_METADATA,
                error="insufficient_scope",
                description="Sign in to continue",
            )
        return _IntegrationReport(domain=domain, company={})  # ty: ignore[invalid-return-type]

    async with Client(mcp) as client:
        refused = await client.call_tool("analyze", {"domain": "signed-out.example"})
        assert refused.is_error
        assert refused.meta is not None
        assert refused.meta["mcp/www_authenticate"] == [_CHALLENGE]

        allowed = await client.call_tool("analyze", {"domain": "example.com"})
        assert not allowed.is_error
        assert allowed.structured_content == {"domain": "example.com", "company": {}}


def test_two_synapse_uis_cannot_share_one_server():
    """Both instances advertise the MCP Apps identifier, so the SDK rejects the
    second. One component per server is the supported shape; the failure is loud."""
    with pytest.raises(ValueError, match="already registered"):
        MCPServer("test", extensions=[_ui(), SynapseUI(uri="ui://test/other", template=TEMPLATE)])

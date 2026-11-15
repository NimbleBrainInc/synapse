"""`FastMCPSynapseUI` on a real FastMCP server, driven by FastMCP's own client.

Each wire test runs once per protocol era: ``mode="auto"`` negotiates the modern
era over ``server/discover`` and ``mode="legacy"`` runs the initialize handshake.
A host on either must read the same resource and the same tool binding.

The module skips without FastMCP, which the ``mcp``-floor run does not install
(FastMCP 4 needs a newer ``mcp`` than that floor). CI's main run sets
``REQUIRE_FASTMCP`` so a missing FastMCP fails there instead of skipping.
"""

from __future__ import annotations

import os
from typing import Any, Literal

import pytest
from mcp.server.mcpserver import MCPServer
from mcp.types import TextResourceContents
from pydantic import BaseModel

from nimblebrain_synapse import SynapseComponent, SynapseUI
from nimblebrain_synapse.server import DATA_MARKER, SDK_MARKER

if os.environ.get("REQUIRE_FASTMCP"):
    import fastmcp
else:
    fastmcp = pytest.importorskip("fastmcp")

from fastmcp import Client, FastMCP  # noqa: E402

from nimblebrain_synapse.fastmcp import FastMCPSynapseUI  # noqa: E402

UI_URI = "ui://test/report"
MIME = "text/html;profile=mcp-app"
RESOURCE_META = {
    "ui": {"prefersBorder": True, "csp": {"connectDomains": [], "resourceDomains": []}},
    "openai/widgetCSP": {"connect_domains": [], "resource_domains": []},
    "openai/widgetPrefersBorder": True,
}
TEMPLATE = f"""<!DOCTYPE html>
<html><head><title>t</title></head><body>
<script type="application/json" id="synapse-ui-data">{DATA_MARKER}</script>
<div id="app"></div>
{SDK_MARKER}
</body></html>"""

Mode = Literal["auto", "legacy"]
# The protocol version each mode must land on, so a test cannot pass on the wrong era.
ERAS: list[tuple[Mode, str]] = [("auto", "2026-07-28"), ("legacy", "2025-11-25")]
both_eras = pytest.mark.parametrize(("mode", "protocol_version"), ERAS, ids=["modern", "legacy"])


class _Report(BaseModel):
    domain: str


def _ui(**kwargs: Any) -> FastMCPSynapseUI:
    return FastMCPSynapseUI(uri=UI_URI, template=TEMPLATE, **kwargs)


def _server(ui: FastMCPSynapseUI) -> FastMCP:
    mcp = FastMCP("test")
    mcp.add_extension(ui)
    return mcp


def _synapse_keys(meta: dict[str, Any] | None) -> dict[str, Any]:
    """`_meta` without the ``fastmcp`` key FastMCP adds to every listed component."""
    assert meta is not None
    return {key: value for key, value in meta.items() if key != "fastmcp"}


@both_eras
async def test_serves_the_ui_resource_with_its_mime_and_meta(mode: Mode, protocol_version: str):
    ui = _ui()
    async with Client(_server(ui), mode=mode) as client:
        assert client.protocol_version == protocol_version

        (listed,) = await client.list_resources()
        assert str(listed.uri) == UI_URI
        assert listed.mime_type == MIME
        assert _synapse_keys(listed.meta) == RESOURCE_META

        (read,) = await client.read_resource(UI_URI)
        assert isinstance(read, TextResourceContents)
        assert read.mime_type == MIME
        # A host builds the frame's policy from the content it read.
        assert read.meta == RESOURCE_META
        assert read.text == ui.template_html()
        assert "SynapseUI={connect" in read.text  # the client SDK is inlined


@both_eras
async def test_a_client_lists_the_tool_with_its_binding(mode: Mode, protocol_version: str):
    ui = _ui()
    mcp = _server(ui)
    schemes = [{"type": "oauth2", "scopes": ["report.read"]}]

    @mcp.tool(meta=ui.tool_meta(invoking="Working…", security_schemes=schemes))
    def analyze(domain: str) -> _Report:
        return _Report(domain=domain)

    async with Client(mcp, mode=mode) as client:
        assert client.protocol_version == protocol_version

        (tool,) = await client.list_tools()
        assert _synapse_keys(tool.meta) == {
            "ui": {"resourceUri": UI_URI, "visibility": ["model", "app"]},
            "openai/widgetAccessible": True,
            "openai/toolInvocation/invoking": "Working…",
            "securitySchemes": schemes,
        }
        # The binding names the resource the same server serves.
        (listed,) = await client.list_resources()
        assert str(listed.uri) == tool.meta["ui"]["resourceUri"]

        result = await client.call_tool("analyze", {"domain": "example.com"})
        assert result.structured_content == {"domain": "example.com"}


@both_eras
async def test_every_resource_input_reaches_the_wire(mode: Mode, protocol_version: str):
    ui = _ui(
        widget_domain="https://example.com",
        mcp_app_domain="abc123.claudemcpcontent.com",
        connect_domains=["https://api.example.com"],
        resource_domains=["data:"],
    )
    async with Client(_server(ui), mode=mode) as client:
        (read,) = await client.read_resource(UI_URI)
        assert read.meta == {
            "ui": {
                "prefersBorder": True,
                "domain": "abc123.claudemcpcontent.com",
                "csp": {
                    "connectDomains": ["https://api.example.com"],
                    "resourceDomains": ["data:"],
                },
            },
            "openai/widgetCSP": {
                "connect_domains": ["https://api.example.com"],
                "resource_domains": ["data:"],
            },
            "openai/widgetPrefersBorder": True,
            "openai/widgetDomain": "https://example.com",
        }


async def test_advertises_the_mcp_apps_extension():
    """Only the modern era carries ``capabilities.extensions`` to the client."""
    async with Client(_server(_ui())) as client:
        capabilities = client.server_capabilities
        assert capabilities is not None
        assert capabilities.extensions is not None
        assert FastMCPSynapseUI.identifier == "io.modelcontextprotocol/ui"
        assert FastMCPSynapseUI.identifier in capabilities.extensions


async def test_both_frameworks_put_the_same_resource_and_binding_on_the_wire():
    """One declaration, either framework: a host cannot tell which served it."""
    import mcp as mcp_sdk

    kwargs: dict[str, Any] = {
        "uri": UI_URI,
        "template": TEMPLATE,
        "connect_domains": ["https://api.example.com"],
    }
    for_fastmcp, for_mcpserver = FastMCPSynapseUI(**kwargs), SynapseUI(**kwargs)
    assert for_fastmcp.tool_meta() == for_mcpserver.tool_meta()

    async with Client(_server(for_fastmcp)) as client:
        (from_fastmcp,) = await client.read_resource(UI_URI)
    async with mcp_sdk.Client(MCPServer("test", extensions=[for_mcpserver])) as client:
        (from_mcpserver,) = (await client.read_resource(UI_URI)).contents

    assert isinstance(from_fastmcp, TextResourceContents)
    assert isinstance(from_mcpserver, TextResourceContents)
    assert from_fastmcp.model_dump(by_alias=True) == from_mcpserver.model_dump(by_alias=True)


def test_two_components_cannot_share_one_server():
    mcp = _server(_ui())
    with pytest.raises(ValueError, match="already registered"):
        mcp.add_extension(FastMCPSynapseUI(uri="ui://test/other", template=TEMPLATE))


def test_the_mcpserver_extension_is_not_a_fastmcp_extension():
    """`SynapseUI` is the `mcp` SDK's extension type; FastMCP takes its own, so the
    two classes share `SynapseComponent` and nothing of either framework."""
    from fastmcp.server.extensions import ServerExtension

    assert issubclass(FastMCPSynapseUI, SynapseComponent)
    assert issubclass(SynapseUI, SynapseComponent)
    assert not issubclass(SynapseUI, ServerExtension)


def test_a_synapse_ui_on_a_fastmcp_server_names_the_class_to_use():
    """The mistake a server moving to FastMCP makes; the error has to say what to
    change, since FastMCP's own is an ``AttributeError`` about a private name."""
    mcp = FastMCP("test")
    with pytest.raises(
        TypeError, match=r"nimblebrain_synapse\.fastmcp\.FastMCPSynapseUI"
    ) as raised:
        mcp.add_extension(SynapseUI(uri=UI_URI, template=TEMPLATE))  # ty: ignore[invalid-argument-type]
    assert "MCPServer" in str(raised.value)


def test_a_fastmcp_synapse_ui_on_an_mcpserver_names_the_class_to_use():
    with pytest.raises(TypeError, match=r"nimblebrain_synapse\.SynapseUI") as raised:
        MCPServer("test", extensions=[_ui()])  # ty: ignore[invalid-argument-type]
    assert "FastMCP" in str(raised.value)


def test_an_extension_that_was_never_bound_refuses_to_register():
    """The resource is registered from FastMCP's bind hook; if a FastMCP release
    stops calling it, registration fails instead of serving a tool with no resource."""
    with pytest.raises(RuntimeError, match="not bound"):
        _ui().methods()

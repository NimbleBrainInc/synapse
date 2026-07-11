"""SynapseUI — the server (Python) half of the Synapse cross-host UI framework.

One declaration wires a self-contained HTML component into every host bridge a
Synapse app can render in, replacing the hand-rolled per-app shim:

- **register** the `ui://` resource with the ChatGPT-facing skybridge MIME
  (`text/html+skybridge`), SDK inlined, data-free — so ChatGPT reads the template
  and feeds the tool's ``structuredContent`` to it on ``window.openai.toolOutput``.
- **tool_meta / result_meta** emit the `_meta` a host binds an output template
  with (``openai/outputTemplate`` etc.).
- **bind** installs the ``CallToolResult`` post-process that, for one tool, appends
  the mcp-ui embedded resource (``text/html``, dossier baked into a ``<script>``)
  and mirrors the result ``_meta`` — so Claude / mcp-ui render with no round-trip.

The client SDK (`window.SynapseUI`) is inlined into the served + embedded HTML so
the component is fully self-contained (no CDN, CSP-safe). Plain MCP clients ignore
the UI pieces and still read ``structuredContent``, so degradation is graceful.

The payload is escaped for `<script>` embedding (the XSS defense) in one place
here, framework-owned and on by default.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from importlib import resources
from typing import Any

from mcp import types

__all__ = ["SynapseUI"]

# ChatGPT requires this exact MIME to render an Apps SDK widget template.
SKYBRIDGE_MIME = "text/html+skybridge"
# mcp-ui renders a ui:// resource whose content is raw HTML as text/html.
MCPUI_MIME = "text/html"

# The client reads pushed data from this element by id (mcp-ui / SSR path). Keep
# in lockstep with the SDK's SYNAPSE_DATA_ELEMENT_ID.
DEFAULT_DATA_ELEMENT_ID = "synapse-ui-data"

# Markers the template carries; substituted at render time.
DATA_MARKER = "/*__SYNAPSE_DATA__*/"  # inside the JSON <script>; unreplaced → client reads null
SDK_MARKER = "<!--__SYNAPSE_SDK__-->"  # replaced with the inlined client SDK <script>

# The bundled client SDK IIFE (`window.SynapseUI`). Vendored from the JS build
# (`dist/synapse-ui.iife.global.js`) so the server and client ship together.
_SDK_ASSET = "synapse-ui.iife.js"


def _load_bundled_sdk() -> str:
    return (resources.files("synapse_ui") / "_assets" / _SDK_ASSET).read_text(encoding="utf-8")


class SynapseUI:
    """A cross-host `ui://` component declared once and wired into every bridge.

    Args:
        uri: The single ``ui://`` resource URI both hosts point at.
        template: The data-free component HTML. Should carry {@link SDK_MARKER}
            (where the client SDK is inlined) and a JSON ``<script>`` holding
            {@link DATA_MARKER} with ``id`` = ``data_element_id``.
        preferred_size: mcp-ui preferred frame size, emitted on the embedded
            resource as ``mcpui.dev/ui-preferred-frame-size``.
        data_element_id: ``id`` of the JSON ``<script>`` the client reads.
        inline_sdk: Inline the bundled client SDK into the HTML (default). Set
            ``False`` if the template already carries the SDK.
        sdk_source: Override the inlined SDK source (defaults to the bundled IIFE).
    """

    def __init__(
        self,
        *,
        uri: str,
        template: str,
        preferred_size: tuple[str, str] = ("100%", "auto"),
        data_element_id: str = DEFAULT_DATA_ELEMENT_ID,
        inline_sdk: bool = True,
        sdk_source: str | None = None,
        skybridge_mime: str = SKYBRIDGE_MIME,
        mcpui_mime: str = MCPUI_MIME,
    ) -> None:
        self.uri = uri
        self.data_element_id = data_element_id
        self.preferred_size = preferred_size
        self._skybridge_mime = skybridge_mime
        self._mcpui_mime = mcpui_mime
        self._template = self._inline_sdk(template, sdk_source) if inline_sdk else template

    # -- HTML -------------------------------------------------------------

    @staticmethod
    def _inline_sdk(template: str, sdk_source: str | None) -> str:
        sdk = sdk_source if sdk_source is not None else _load_bundled_sdk()
        script = f"<script>{sdk}</script>"
        if SDK_MARKER in template:
            return template.replace(SDK_MARKER, script, 1)
        # Fallback: inject before </body> (or </html>) so the component still loads.
        for close in ("</body>", "</html>"):
            if close in template:
                return template.replace(close, script + close, 1)
        return template + script

    def template_html(self) -> str:
        """Data-free HTML (served resource / ChatGPT): SDK inlined, data marker intact."""
        return self._template

    @staticmethod
    def _safe_json(data: Any) -> str:
        """JSON safe to embed inside a ``<script>`` element.

        Escapes ``<``/``>``/``&`` and the U+2028/U+2029 separators so a value in
        the payload can neither close the script tag (``</script>``) nor break the
        surrounding HTML/JS — the JSON stays valid and inert. This is the XSS
        defense, framework-owned and on by default.
        """
        raw = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
        return (
            raw.replace("<", "\\u003c")
            .replace(">", "\\u003e")
            .replace("&", "\\u0026")
            .replace(" ", "\\u2028")
            .replace(" ", "\\u2029")
        )

    def render_html(self, data: Any) -> str:
        """HTML with ``data`` baked into the JSON ``<script>`` (mcp-ui embedded copy)."""
        return self._template.replace(DATA_MARKER, self._safe_json(data), 1)

    # -- MCP wiring -------------------------------------------------------

    def embedded_resource(self, data: Any) -> types.EmbeddedResource:
        """The mcp-ui content block: a ``ui://`` resource carrying ``data`` inline."""
        return types.EmbeddedResource(
            type="resource",
            resource=types.TextResourceContents(
                uri=self.uri,
                mimeType=self._mcpui_mime,
                text=self.render_html(data),
            ),
            annotations=types.Annotations(audience=["user"]),
            _meta={"mcpui.dev/ui-preferred-frame-size": list(self.preferred_size)},
        )

    def tool_meta(
        self,
        *,
        invoking: str | None = None,
        invoked: str | None = None,
        widget_accessible: bool = True,
    ) -> dict[str, Any]:
        """`_meta` for the tool descriptor — how ChatGPT binds the output template."""
        meta: dict[str, Any] = {
            "openai/outputTemplate": self.uri,
            "openai/widgetAccessible": widget_accessible,
        }
        if invoking is not None:
            meta["openai/toolInvocation/invoking"] = invoking
        if invoked is not None:
            meta["openai/toolInvocation/invoked"] = invoked
        return meta

    def result_meta(self) -> dict[str, Any]:
        """`_meta` for the tool *result* — mirrors the template pointer per call."""
        return {"openai/outputTemplate": self.uri}

    def register(self, mcp: Any, *, meta: dict[str, Any] | None = None) -> None:
        """Register the ChatGPT-facing skybridge ``ui://`` resource (data-free, SDK inlined)."""
        html = self.template_html()
        resource_meta = {"openai/widgetPrefersBorder": True, **(meta or {})}

        @mcp.resource(self.uri, mime_type=self._skybridge_mime, meta=resource_meta)
        def _synapse_ui_resource() -> str:
            return html

    def bind(
        self,
        mcp: Any,
        *,
        tool: str,
        should_render: Callable[[Any], bool] | None = None,
    ) -> None:
        """Install the ``CallToolResult`` post-process that renders `tool`'s output.

        For a successful, non-error result of ``tool`` that carries
        ``structuredContent`` (and passes ``should_render``), appends the mcp-ui
        embedded resource and mirrors the ChatGPT ``_meta``. Plain clients ignore
        both and still read the structured JSON.

        Quarantine note: this wraps FastMCP's ``CallToolRequest`` handler — a leak
        into FastMCP internals kept in this one place so no app pokes them.

        # TODO: upstream a real FastMCP result-transform hook and drop this patch.
        """
        predicate = should_render if should_render is not None else (lambda data: bool(data))
        prev = mcp._mcp_server.request_handlers[types.CallToolRequest]

        async def _handler(req: types.CallToolRequest) -> types.ServerResult:
            result = await prev(req)
            if req.params.name == tool:
                return self._attach(result, predicate)
            return result

        mcp._mcp_server.request_handlers[types.CallToolRequest] = _handler

    def _attach(
        self,
        result: types.ServerResult,
        predicate: Callable[[Any], bool],
    ) -> types.ServerResult:
        root = result.root
        if not isinstance(root, types.CallToolResult) or root.isError:
            return result
        data = root.structuredContent
        if not data or not predicate(data):
            return result
        root.content.append(self.embedded_resource(data))
        root.meta = {**(root.meta or {}), **self.result_meta()}
        return result

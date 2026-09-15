"""SynapseUI — the server (Python) half of the Synapse cross-host UI framework.

One declaration wires a self-contained HTML component into every host bridge a
Synapse app can render in, replacing the hand-rolled per-app shim. `SynapseUI` is
an MCP **extension** (SEP-2133): hand the instance to
``MCPServer(..., extensions=[ui])`` and it contributes everything below.

- Two data-free ``ui://`` **resources** (SDK inlined): the ChatGPT skybridge MIME
  (``text/html+skybridge``) and the MCP Apps standard MIME
  (``text/html;profile=mcp-app``, Claude Desktop et al.) — so each host reads the
  template and feeds it the tool's ``structuredContent``.
- **tool_meta / result_meta** emit the `_meta` a host binds an output template
  with. Each input is declared once and emitted under the ext-apps ``ui.*`` key
  and ChatGPT's ``openai/*`` alias for it, so a caller never picks a host's key.
- **bind** names the tools whose results carry the binding. For each, the
  extension's ``tools/call`` interceptor mirrors the ChatGPT
  ``openai/outputTemplate`` pointer into the result ``_meta`` (the SEP-1865
  ``ui.resourceUri`` binding rides the descriptor ``_meta`` from ``tool_meta``).
  Opt into ``embed_resource=True`` to also bake the component HTML into the result
  ``content`` (the legacy mcp-ui no-round-trip copy) — off by default so that
  ``audience: ["user"]`` HTML can't leak into a client that won't render it.

The extension is advertised under the spec's MCP Apps identifier
(``io.modelcontextprotocol/ui``), because that is the extension this implements:
the ChatGPT dialect rides alongside in `_meta` keys the spec does not claim. A
server therefore uses `SynapseUI` *instead of* the SDK's own ``mcp.server.apps.Apps``
— two extensions cannot share an identifier, and ``Apps`` serves only the
``text/html;profile=mcp-app`` MIME, so it cannot carry the skybridge resource.

The client SDK (`window.SynapseUI`) is inlined into the served + embedded HTML so
the component is fully self-contained (no CDN, CSP-safe). Plain MCP clients ignore
the UI pieces and still read ``structuredContent``, so degradation is graceful.

The payload is escaped for `<script>` embedding (the XSS defense) in one place
here, framework-owned and on by default.
"""

from __future__ import annotations

import json
import warnings
from dataclasses import dataclass
from importlib import resources
from typing import TYPE_CHECKING, Any

from mcp import types
from mcp.server.apps import APP_MIME_TYPE, EXTENSION_ID, Visibility
from mcp.server.extension import Extension, ResourceBinding
from mcp.server.mcpserver.resources import TextResource

if TYPE_CHECKING:
    from collections.abc import Callable, Mapping, Sequence

    from mcp.server.context import CallNext, HandlerResult, ServerRequestContext

__all__ = ["SynapseUI"]

# Every audience a tool can be visible to, which is also the spec's default.
_ALL_AUDIENCES: tuple[Visibility, ...] = ("model", "app")

# ChatGPT requires this exact MIME to render an Apps SDK widget template.
SKYBRIDGE_MIME = "text/html+skybridge"
# mcp-ui renders a ui:// resource whose content is raw HTML as text/html.
MCPUI_MIME = "text/html"
# MCP Apps standard (SEP-1865): a host mounts the component in an iframe only when
# the resource is served under this exact MIME (Claude Desktop and other MCP Apps
# hosts). Taken from the SDK rather than spelled again here, so it cannot drift
# from the MIME the SDK's own resource validation enforces.
MCPAPP_MIME = APP_MIME_TYPE

# The client reads pushed data from this element by id (mcp-ui / SSR path). Keep
# in lockstep with the SDK's SYNAPSE_DATA_ELEMENT_ID.
DEFAULT_DATA_ELEMENT_ID = "synapse-ui-data"

# Markers the template carries; substituted at render time.
# Server↔client template placeholders — the SDK's test fixtures embed the same
# literals; keep in lockstep (like DEFAULT_DATA_ELEMENT_ID above).
DATA_MARKER = "/*__SYNAPSE_DATA__*/"  # inside the JSON <script>; unreplaced → client reads null
SDK_MARKER = "<!--__SYNAPSE_SDK__-->"  # replaced with the inlined client SDK <script>

# The bundled client SDK IIFE (`window.SynapseUI`). Vendored from the JS build
# (`dist/synapse-ui.iife.global.js`) so the server and client ship together.
_SDK_ASSET = "synapse-ui.iife.js"


def _load_bundled_sdk() -> str:
    # `__package__ or __name__` is always this package (never None for an imported
    # submodule) and carries no hardcoded name to update on a rename.
    return (resources.files(__package__ or __name__) / "_assets" / _SDK_ASSET).read_text(
        encoding="utf-8"
    )


@dataclass(frozen=True)
class _Binding:
    """The per-tool render decision `bind` records, read by the interceptor."""

    should_render: Callable[[Any], bool]
    embed_resource: bool


class SynapseUI(Extension):
    """A cross-host `ui://` component declared once and wired into every bridge.

    Pass the instance to ``MCPServer(..., extensions=[ui])``. The component's two
    resources are built here, at construction, and contributed from
    :meth:`resources`; :meth:`bind` names the tools whose results carry the
    binding and may be called before or after the server is constructed.

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
        widget_domain: The ChatGPT origin, emitted on the ChatGPT (skybridge) resource
            as ``ui.domain`` and its ``openai/widgetDomain`` alias. A developer-declared
            origin ChatGPT keys the hosted component to (rendered under
            ``<slug>.web-sandbox.oaiusercontent.com``); required to submit an Apps SDK
            app. It is *not* a valid origin for other MCP Apps hosts, so it never
            reaches the MCP Apps resource (see ``mcp_app_domain``).
        mcp_app_domain: The ext-apps sandbox origin, emitted as ``_meta.ui.domain`` on
            the MCP Apps (``text/html;profile=mcp-app``) resource. The spec makes this
            value host-validated and its format host-specific (Claude, for one, derives
            it as ``sha256(<connector URL>)[:32] + ".claudemcpcontent.com"`` and rejects
            any other value), so one value cannot satisfy every host: supply it only
            when the component needs a stable, dedicated origin (OAuth callback / CORS /
            API-key allowlist) on a known target host, computed in that host's format.
            Left unset by default, which the spec resolves to the host's own default
            sandbox origin — the correct choice for a self-contained component.
        connect_domains: Origins the component may reach via fetch/XHR (widget CSP
            ``connect_domains``). Empty for a self-contained component.
        resource_domains: Origins the component may load static assets from (widget
            CSP ``resource_domains``). Empty for a self-contained component.
        resource_meta: Extra ``_meta`` keys merged onto the ChatGPT (skybridge)
            resource, for host keys this class does not model.
    """

    #: The MCP Apps extension this implements, advertised under
    #: ``ServerCapabilities.extensions``. Taken from the SDK so it cannot drift.
    identifier = EXTENSION_ID

    def __init__(
        self,
        *,
        uri: str,
        template: str,
        preferred_size: tuple[str, str] = ("100%", "auto"),
        data_element_id: str = DEFAULT_DATA_ELEMENT_ID,
        inline_sdk: bool = True,
        sdk_source: str | None = None,
        widget_domain: str | None = None,
        mcp_app_domain: str | None = None,
        connect_domains: list[str] | None = None,
        resource_domains: list[str] | None = None,
        resource_meta: dict[str, Any] | None = None,
    ) -> None:
        self.uri = uri
        # The MCP Apps standard resource is a sibling URI: a resource carries a
        # single MIME, and Claude (text/html;profile=mcp-app) and ChatGPT
        # (text/html+skybridge) require different ones — so self.uri stays the
        # skybridge resource and the standard resource lives alongside it.
        self.mcp_app_uri = f"{uri}-mcp-app"
        self.data_element_id = data_element_id
        self.preferred_size = preferred_size
        # The sandbox origin is host-owned, and the two hosts model it differently:
        # `openai/widgetDomain` is a developer-declared origin (ChatGPT), while the
        # ext-apps `ui.domain` is host-validated (Claude derives it and rejects a
        # mismatch). They are distinct fields with distinct values — never one
        # value fed to both — so each rides its own attribute.
        self.widget_domain = widget_domain
        self.mcp_app_domain = mcp_app_domain
        self.connect_domains = connect_domains or []
        self.resource_domains = resource_domains or []
        self._bound: dict[str, _Binding] = {}
        self._template = self._inline_sdk(template, sdk_source) if inline_sdk else template
        self._resources = self._build_resources(resource_meta)

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
                mime_type=MCPUI_MIME,
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
        visibility: Sequence[Visibility] | None = None,
        security_schemes: Sequence[Mapping[str, Any]] | None = None,
        widget_accessible: bool | None = None,
    ) -> dict[str, Any]:
        """`_meta` for the tool descriptor — how a host binds the output template.

        Each input is declared once and emitted under every key a host reads it
        from: the ext-apps ``ui.*`` key, plus ChatGPT's alias for it (see
        ``_chatgpt_tool_aliases``). The binding is ``ui.resourceUri``; the flat
        ``_meta["ui/resourceUri"]`` form is deprecated in the spec and not emitted.

        Args:
            invoking: Status text ChatGPT shows while the tool runs.
            invoked: Status text ChatGPT shows once the tool has run.
            visibility: Who may call the tool, emitted as ``ui.visibility``:
                ``"model"`` (the agent) and ``"app"`` (the component, over
                ``tools/call``). Defaults to both, the spec's own default.
            security_schemes: The auth the tool accepts, e.g.
                ``[{"type": "oauth2", "scopes": ["report.read"]}]``, with
                ``{"type": "noauth"}`` beside it when signing in is optional. ChatGPT
                reads this to offer sign-in mid-conversation; pair it with
                :func:`nimblebrain_synapse.auth_error_result`. Omit it on a server
                without auth. It rides ``_meta``, the mirror ChatGPT documents for
                clients that read only ``_meta``: the MCP SDK builds a tool
                descriptor from a fixed set of fields, so a top-level
                ``securitySchemes`` cannot reach the wire through it.
            widget_accessible: Deprecated spelling of ``visibility``: ``True`` is
                ``["model", "app"]`` and ``False`` is ``["model"]``.

        Raises:
            ValueError: ``visibility`` is empty or names an unknown audience.
            TypeError: Both ``visibility`` and ``widget_accessible`` were given.
        """
        if widget_accessible is not None:
            if visibility is not None:
                raise TypeError("pass visibility or widget_accessible, not both")
            warnings.warn(
                "widget_accessible is deprecated; pass visibility=['model', 'app'] "
                "or visibility=['model'] instead",
                DeprecationWarning,
                stacklevel=2,
            )
            visibility = ("model", "app") if widget_accessible else ("model",)
        audiences = (
            list(dict.fromkeys(visibility)) if visibility is not None else list(_ALL_AUDIENCES)
        )
        if not audiences or not set(audiences) <= set(_ALL_AUDIENCES):
            raise ValueError(
                f"visibility must be a non-empty subset of {list(_ALL_AUDIENCES)}, "
                f"got {audiences!r}"
            )

        meta: dict[str, Any] = {
            "ui": {"resourceUri": self.mcp_app_uri, "visibility": audiences},
            **_chatgpt_tool_aliases(self.uri, audiences),
        }
        if security_schemes is not None:
            meta["securitySchemes"] = [dict(scheme) for scheme in security_schemes]
        # ChatGPT-only status text with no ext-apps counterpart, so not an alias.
        if invoking is not None:
            meta["openai/toolInvocation/invoking"] = invoking
        if invoked is not None:
            meta["openai/toolInvocation/invoked"] = invoked
        return meta

    def result_meta(self) -> dict[str, Any]:
        """`_meta` for the tool *result* — mirrors the template pointer per call."""
        return _chatgpt_result_aliases(self.uri)

    # -- Extension contributions ------------------------------------------

    def _ui_resource_meta(self, domain: str | None) -> dict[str, Any]:
        """The ext-apps ``ui.*`` keys for one copy of the component, camelCase.

        ``domain`` is omitted unless a stable origin was supplied — the host then
        falls back to its own default sandbox origin (the correct, portable default;
        a host that derives its own origin rejects a foreign value).
        """
        ui: dict[str, Any] = {
            "prefersBorder": True,
            "csp": {
                "connectDomains": list(self.connect_domains),
                "resourceDomains": list(self.resource_domains),
            },
        }
        if domain is not None:
            ui["domain"] = domain
        return ui

    def _build_resources(self, resource_meta: dict[str, Any] | None) -> list[ResourceBinding]:
        """Both host-facing ``ui://`` resources (data-free, SDK inlined).

        The same component is served twice because a resource carries one MIME and
        the hosts disagree: ``self.uri`` under ``text/html+skybridge`` for ChatGPT,
        and ``self.mcp_app_uri`` under ``text/html;profile=mcp-app`` for Claude and
        other MCP Apps hosts. Both point at the same inlined HTML and carry the same
        ``ui.*`` keys, except ``ui.domain``: each copy takes its own host's origin,
        because the hosts disagree on what that value is.
        """
        html = self.template_html()
        return [
            _chatgpt_resource(
                self.uri, html, self._ui_resource_meta(self.widget_domain), resource_meta
            ),
            ResourceBinding(
                resource=TextResource(
                    uri=self.mcp_app_uri,
                    name=self.mcp_app_uri,
                    mime_type=MCPAPP_MIME,
                    meta={"ui": self._ui_resource_meta(self.mcp_app_domain)},
                    text=html,
                )
            ),
        ]

    def resources(self) -> Sequence[ResourceBinding]:
        """The two host-facing ``ui://`` resources, consumed at server construction."""
        return self._resources

    def bind(
        self,
        tool: str,
        *,
        should_render: Callable[[Any], bool] | None = None,
        embed_resource: bool = False,
    ) -> None:
        """Render `tool`'s output through this component.

        For a successful, non-error result of ``tool`` that carries
        ``structuredContent`` (and passes ``should_render``), the extension's
        ``tools/call`` interceptor mirrors the ChatGPT ``openai/outputTemplate``
        pointer into the result ``_meta`` per call. That, the descriptor ``_meta``
        from ``tool_meta`` (which also carries the SEP-1865 ``ui.resourceUri`` for
        Claude and other MCP Apps hosts), and the contributed ``ui://`` resource are
        what let a standard host bind the component and render it with the
        ``structuredContent``. A plain client ignores the ``_meta`` and still reads
        the structured JSON.

        ``embed_resource`` (default ``False``) additionally bakes the fully rendered
        component HTML into the result ``content`` as an mcp-ui ``EmbeddedResource``
        — the legacy "render from the content block, no ``resources/read``
        round-trip" path. It is off by default because that HTML is
        ``audience: ["user"]`` UI, not model context: a client that can't render it
        (a plain MCP client, a terminal agent) cannot negotiate it away on a
        stateless server, so the whole component — tens of KB per call — lands
        verbatim in the model's context. The pointer path above already reaches
        every standard host, so enable this only for a host that renders *solely*
        from the embedded copy and not the ``ui.resourceUri`` pointer.

        Order does not matter: the interceptor is installed because this class
        overrides :meth:`intercept_tool_call`, not because a tool is bound, so this
        may be called before or after the server is constructed. Binding the same
        tool again replaces its options.
        """
        self._bound[tool] = _Binding(
            should_render=should_render if should_render is not None else (lambda data: bool(data)),
            embed_resource=embed_resource,
        )

    async def intercept_tool_call(
        self,
        params: types.CallToolRequestParams,
        ctx: ServerRequestContext[Any, Any],
        call_next: CallNext,
    ) -> HandlerResult:
        """Attach the component binding to a bound tool's result (SEP-2133 hook)."""
        result = await call_next(ctx)
        binding = self._bound.get(params.name)
        if binding is None or not isinstance(result, types.CallToolResult):
            return result
        return self._attach(result, binding)

    def _attach(self, result: types.CallToolResult, binding: _Binding) -> types.CallToolResult:
        if result.is_error:
            return result
        data = result.structured_content
        if not data or not binding.should_render(data):
            return result
        # The `_meta` pointer alone is enough for a standard host: it fetches the
        # contributed ui:// component and renders it with the structuredContent, so
        # no UI HTML rides in the model-facing content. `embed_resource` adds the
        # legacy mcp-ui copy (see bind) — off by default so it can't leak into a
        # client that won't render it.
        if binding.embed_resource:
            result.content.append(self.embedded_resource(data))
        result.meta = {**(result.meta or {}), **self.result_meta()}
        return result


# -- ChatGPT (OpenAI Apps SDK) compatibility ------------------------------------
#
# ChatGPT documents the ext-apps `ui.*` keys as preferred and each `openai/*` key
# below as a compatibility alias for one of them. Both are emitted until ChatGPT is
# confirmed to render the `text/html;profile=mcp-app` copy. This section is what
# goes then: the skybridge resource and every alias. Delete it and `ty` names each
# call site left behind (`tool_meta`, `result_meta`, `_build_resources`); with them
# go the `uri`/`mcp_app_uri` split, `resource_meta` (it merges onto the skybridge
# copy only), `widget_domain`, and the exported `SKYBRIDGE_MIME`.
#
# Not in this section, because they are not aliases: `openai/toolInvocation/*` (no
# ext-apps counterpart) and `securitySchemes` (ChatGPT reads it whichever copy
# renders).


def _chatgpt_tool_aliases(template_uri: str, visibility: Sequence[Visibility]) -> dict[str, Any]:
    """ChatGPT's aliases for the tool descriptor's ``ui.resourceUri`` and ``ui.visibility``.

    ``openai/outputTemplate`` names the skybridge copy, the one served under the MIME
    that alias expects. ``openai/widgetAccessible`` defaults to ``false`` in ChatGPT,
    so it is always emitted rather than left to disagree with ``ui.visibility``.
    """
    aliases: dict[str, Any] = {
        "openai/outputTemplate": template_uri,
        "openai/widgetAccessible": "app" in visibility,
    }
    if "model" not in visibility:
        aliases["openai/visibility"] = "private"
    return aliases


def _chatgpt_result_aliases(template_uri: str) -> dict[str, Any]:
    """The template pointer ChatGPT reads from a tool *result*'s ``_meta``."""
    return {"openai/outputTemplate": template_uri}


def _chatgpt_resource(
    uri: str, html: str, ui_meta: dict[str, Any], resource_meta: dict[str, Any] | None
) -> ResourceBinding:
    """The component under ``text/html+skybridge``: the ``ui.*`` keys beside their aliases.

    A CSP and the widget domain are required to submit an app; without them ChatGPT's
    dev view flags the template as submission-incomplete.
    """
    csp = ui_meta["csp"]
    meta: dict[str, Any] = {
        "ui": ui_meta,
        "openai/widgetPrefersBorder": ui_meta["prefersBorder"],
        "openai/widgetCSP": {
            "connect_domains": list(csp["connectDomains"]),
            "resource_domains": list(csp["resourceDomains"]),
        },
    }
    if "domain" in ui_meta:
        meta["openai/widgetDomain"] = ui_meta["domain"]
    meta.update(resource_meta or {})
    return ResourceBinding(
        resource=TextResource(uri=uri, name=uri, mime_type=SKYBRIDGE_MIME, meta=meta, text=html)
    )

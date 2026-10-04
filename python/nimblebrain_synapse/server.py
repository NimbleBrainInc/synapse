"""SynapseUI — the server (Python) half of the Synapse cross-host UI framework.

One declaration wires a self-contained HTML component into every host bridge a
Synapse app can render in, replacing the hand-rolled per-app shim. `SynapseUI` is
an MCP **extension** (SEP-2133): hand the instance to
``MCPServer(..., extensions=[ui])`` and it contributes everything below.

- One data-free ``ui://`` **resource** (SDK inlined) under the MCP Apps MIME
  (``text/html;profile=mcp-app``). Every host reads it — ChatGPT and Claude both
  resolve ``ui.resourceUri`` and render this MIME — and feeds it the tool's
  ``structuredContent``. Its ``_meta`` carries the frame's security policy in both
  dialects, ``ui.csp`` and ChatGPT's ``openai/widgetCSP`` (see
  ``_chatgpt_resource_aliases``).
- **tool_meta** emits the `_meta` a host binds the component with: the ext-apps
  ``ui.resourceUri`` and ``ui.visibility``, plus ChatGPT's visibility aliases
  (see ``_chatgpt_tool_aliases``).
- **render_html** returns the component with a payload baked into its JSON
  ``<script>``, for a page rendered outside a host (a test or a sample harness).

The extension is advertised under the spec's MCP Apps identifier
(``io.modelcontextprotocol/ui``), because that is the extension this implements;
the few ChatGPT keys it emits ride alongside in `_meta` keys the spec does not
claim. A server therefore uses `SynapseUI` *instead of* the SDK's own
``mcp.server.apps.Apps`` — two extensions cannot share an identifier.

The client SDK (`window.SynapseUI`) is inlined into the served HTML so
the component is fully self-contained (no CDN, CSP-safe). Plain MCP clients ignore
the UI pieces and still read ``structuredContent``, so degradation is graceful.

The payload is escaped for `<script>` embedding (the XSS defense) in one place
here, framework-owned and on by default.
"""

from __future__ import annotations

import json
from importlib import resources
from typing import TYPE_CHECKING, Any

from mcp.server.apps import APP_MIME_TYPE, EXTENSION_ID, Visibility
from mcp.server.extension import Extension, ResourceBinding
from mcp.server.mcpserver.resources import TextResource

if TYPE_CHECKING:
    from collections.abc import Mapping, Sequence

__all__ = ["SynapseUI"]

# Every audience a tool can be visible to, which is also the spec's default.
_ALL_AUDIENCES: tuple[Visibility, ...] = ("model", "app")

# MCP Apps standard (SEP-1865): a host mounts the component in an iframe only when
# the resource is served under this exact MIME. Taken from the SDK rather than
# spelled again here, so it cannot drift from the MIME the SDK's own resource
# validation enforces.
MCPAPP_MIME = APP_MIME_TYPE

# The client reads baked-in data from this element by id (`render_html`). Keep
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


class SynapseUI(Extension):
    """A cross-host `ui://` component declared once and wired into every bridge.

    Pass the instance to ``MCPServer(..., extensions=[ui])``. The component's
    resource is built here, at construction, and contributed from
    :meth:`resources`. A tool binds to it through :meth:`tool_meta`.

    Args:
        uri: The ``ui://`` resource URI every host reads.
        template: The data-free component HTML. It carries ``SDK_MARKER`` (where
            the client SDK is inlined) unless ``inline_sdk`` is ``False``, and a
            JSON ``<script>`` holding ``DATA_MARKER`` with ``id`` = ``data_element_id``.
        data_element_id: ``id`` of the JSON ``<script>`` the client reads.
        inline_sdk: Inline the bundled client SDK into the HTML (default). Set
            ``False`` if the template already carries the SDK.
        sdk_source: Override the inlined SDK source (defaults to the bundled IIFE).
        widget_domain: The ChatGPT origin, emitted on the resource as
            ``openai/widgetDomain`` and only when given. A developer-declared origin
            ChatGPT keys the hosted component to (rendered under
            ``<slug>.web-sandbox.oaiusercontent.com``), which ChatGPT asks for to
            submit an app. It is *not* a valid ``ui.domain`` for other MCP Apps hosts,
            so it never reaches that key (see ``mcp_app_domain``).
        mcp_app_domain: The ext-apps sandbox origin, emitted as ``_meta.ui.domain`` on
            the resource. The spec makes this
            value host-validated and its format host-specific (Claude, for one, derives
            it as ``sha256(<connector URL>)[:32] + ".claudemcpcontent.com"`` and rejects
            any other value), so one value cannot satisfy every host: supply it only
            when the component needs a stable, dedicated origin (OAuth callback / CORS /
            API-key allowlist) on a known target host, computed in that host's format.
            Left unset by default, which the spec resolves to the host's own default
            sandbox origin — the correct choice for a self-contained component.
        connect_domains: Origins the component may reach via fetch/XHR, emitted as
            ``ui.csp.connectDomains`` and ``openai/widgetCSP.connect_domains``. Empty
            for a self-contained component, which is a policy of "reach nothing" in
            every host that reads one.
        resource_domains: Origins the component may load static assets from, emitted as
            ``ui.csp.resourceDomains`` and ``openai/widgetCSP.resource_domains``. A
            component with a ``data:``-URL font declares ``"data:"`` here.
    """

    #: The MCP Apps extension this implements, advertised under
    #: ``ServerCapabilities.extensions``. Taken from the SDK so it cannot drift.
    identifier = EXTENSION_ID

    def __init__(
        self,
        *,
        uri: str,
        template: str,
        data_element_id: str = DEFAULT_DATA_ELEMENT_ID,
        inline_sdk: bool = True,
        sdk_source: str | None = None,
        widget_domain: str | None = None,
        mcp_app_domain: str | None = None,
        connect_domains: list[str] | None = None,
        resource_domains: list[str] | None = None,
    ) -> None:
        self.uri = uri
        self.data_element_id = data_element_id
        # The sandbox origin is host-owned, and the hosts model it differently:
        # `openai/widgetDomain` is a developer-declared origin (ChatGPT), while the
        # ext-apps `ui.domain` is host-validated (Claude derives it and rejects a
        # mismatch). They are distinct keys with distinct values — never one
        # value fed to both — so each rides its own attribute.
        self.widget_domain = widget_domain
        self.mcp_app_domain = mcp_app_domain
        self.connect_domains = connect_domains or []
        self.resource_domains = resource_domains or []
        self._template = self._inline_sdk(template, sdk_source) if inline_sdk else template
        self._resources = [self._build_resource()]

    # -- HTML -------------------------------------------------------------

    @staticmethod
    def _inline_sdk(template: str, sdk_source: str | None) -> str:
        sdk = sdk_source if sdk_source is not None else _load_bundled_sdk()
        script = f"<script>{sdk}</script>"
        if SDK_MARKER not in template:
            raise ValueError(
                f"template has no {SDK_MARKER} marker: place it where the client SDK "
                "<script> goes, or pass inline_sdk=False if the template carries the SDK"
            )
        return template.replace(SDK_MARKER, script, 1)

    def template_html(self) -> str:
        """Data-free HTML (the served resource): SDK inlined, data marker intact."""
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
        """HTML with ``data`` baked into the JSON ``<script>``, escaped for it.

        For a page rendered outside a host, such as a test or a sample harness. A
        host renders the data-free resource and feeds it the result's
        ``structuredContent``.
        """
        return self._template.replace(DATA_MARKER, self._safe_json(data), 1)

    # -- MCP wiring -------------------------------------------------------

    def tool_meta(
        self,
        *,
        invoking: str | None = None,
        invoked: str | None = None,
        visibility: Sequence[Visibility] | None = None,
        security_schemes: Sequence[Mapping[str, Any]] | None = None,
    ) -> dict[str, Any]:
        """`_meta` for the tool descriptor — how a host binds the component.

        The binding is ``ui.resourceUri``; the flat ``_meta["ui/resourceUri"]`` form
        is deprecated in the spec and not emitted. Visibility is declared once and
        emitted as ``ui.visibility`` and ChatGPT's aliases for it (see
        ``_chatgpt_tool_aliases``).

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

        Raises:
            ValueError: ``visibility`` is empty or names an unknown audience.
        """
        audiences = (
            list(dict.fromkeys(visibility)) if visibility is not None else list(_ALL_AUDIENCES)
        )
        if not audiences or not set(audiences) <= set(_ALL_AUDIENCES):
            raise ValueError(
                f"visibility must be a non-empty subset of {list(_ALL_AUDIENCES)}, "
                f"got {audiences!r}"
            )

        meta: dict[str, Any] = {
            "ui": {"resourceUri": self.uri, "visibility": audiences},
            **_chatgpt_tool_aliases(audiences),
        }
        if security_schemes is not None:
            meta["securitySchemes"] = [dict(scheme) for scheme in security_schemes]
        # ChatGPT-only status text with no ext-apps counterpart, so not an alias.
        if invoking is not None:
            meta["openai/toolInvocation/invoking"] = invoking
        if invoked is not None:
            meta["openai/toolInvocation/invoked"] = invoked
        return meta

    # -- Extension contributions ------------------------------------------

    def _ui_resource_meta(self) -> dict[str, Any]:
        """The ext-apps ``ui.*`` keys for the resource, camelCase.

        The one place the frame's policy and border preference are built;
        ``_chatgpt_resource_aliases`` mirrors this mapping into ChatGPT's dialect.

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
        if self.mcp_app_domain is not None:
            ui["domain"] = self.mcp_app_domain
        return ui

    def _build_resource(self) -> ResourceBinding:
        """The ``ui://`` resource (data-free, SDK inlined) every host reads."""
        ui = self._ui_resource_meta()
        meta: dict[str, Any] = {"ui": ui, **_chatgpt_resource_aliases(ui)}
        if self.widget_domain is not None:
            meta["openai/widgetDomain"] = self.widget_domain
        return ResourceBinding(
            resource=TextResource(
                uri=self.uri,
                name=self.uri,
                mime_type=MCPAPP_MIME,
                meta=meta,
                text=self.template_html(),
            )
        )

    def resources(self) -> Sequence[ResourceBinding]:
        """The ``ui://`` resource, consumed at server construction."""
        return self._resources


# -- ChatGPT (OpenAI Apps SDK) compatibility ------------------------------------
#
# ChatGPT renders the one `text/html;profile=mcp-app` resource from `ui.resourceUri`
# and enforces `ui.visibility` — measured in developer mode. OpenAI documents
# `ui.csp` as generally preferred for new UI and `openai/widgetCSP` as a legacy
# compatibility key, still the only way to declare `redirect_domains`, so both are
# emitted, each derived from the `ui.*` value it mirrors. Neither has been observed
# to change what ChatGPT enforces: measured 2026-09-18, a frame whose resource
# carried both ran under ChatGPT's own default sandbox policy.
#
# `openai/widgetDomain` (the resource, when `widget_domain` is given) and
# `openai/toolInvocation/*` (the tool, when given) are developer-declared values,
# emitted only when supplied.


def _chatgpt_resource_aliases(ui: Mapping[str, Any]) -> dict[str, Any]:
    """ChatGPT's aliases for the resource's ``ui.csp`` and ``ui.prefersBorder``.

    OpenAI documents ``openai/widgetCSP``, so the alias is always emitted rather than
    left to the host. The dialects differ in spelling
    (``connect_domains``/``resource_domains`` against the spec's camelCase), and
    OpenAI documents only the snake_case keys, so both are derived here from the one
    ``ui`` mapping.

    **Both dialects carry only the two origin lists ``SynapseUI`` takes.** The spec's
    ``ui.csp`` also defines ``frameDomains`` and ``baseUriDomains``, and
    ``openai/widgetCSP`` also defines ``frame_domains`` and ``redirect_domains`` —
    the latter being the only way to allowlist a ``window.openai.openExternal()``
    target, with no ``ui.csp`` equivalent. ``SynapseUI`` has never exposed any of the
    four, in either dialect. That costs nothing for a self-contained component, which
    frames nothing and opens nothing; a component that does either cannot declare it
    here. What a host does with an omitted list is **unmeasured** — the spec's own
    reading is a secure default (``frame-src 'none'``), and OpenAI documents neither.
    """
    csp = ui["csp"]
    return {
        "openai/widgetCSP": {
            "connect_domains": list(csp["connectDomains"]),
            "resource_domains": list(csp["resourceDomains"]),
        },
        "openai/widgetPrefersBorder": ui["prefersBorder"],
    }


def _chatgpt_tool_aliases(visibility: Sequence[Visibility]) -> dict[str, Any]:
    """ChatGPT's aliases for the tool descriptor's ``ui.visibility``.

    ``openai/widgetAccessible`` defaults to ``false`` in ChatGPT, so it is always
    emitted rather than left to disagree with ``ui.visibility``.
    """
    aliases: dict[str, Any] = {"openai/widgetAccessible": "app" in visibility}
    if "model" not in visibility:
        aliases["openai/visibility"] = "private"
    return aliases

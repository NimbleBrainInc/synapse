"""`FastMCPSynapseUI`: a Synapse component registered on a FastMCP server.

FastMCP's ``add_extension`` takes a ``fastmcp.server.extensions.ServerExtension``,
a different type from the ``mcp.server.extension.Extension`` that
``MCPServer(extensions=[...])`` takes, so each framework has its own class and
`SynapseComponent` holds what they share: the HTML, the resource `_meta` and
``tool_meta``.

```python
from fastmcp import FastMCP
from nimblebrain_synapse.fastmcp import FastMCPSynapseUI

ui = FastMCPSynapseUI(uri="ui://notes/main", template=TEMPLATE)
mcp = FastMCP("notes")
mcp.add_extension(ui)


@mcp.tool(meta=ui.tool_meta())
def list_notes() -> dict[str, list[str]]:
    return {"notes": []}
```

Importing this module needs FastMCP 4, which the ``fastmcp`` extra installs
(``nimblebrain-synapse[fastmcp]``); the rest of the package does not import it.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, NoReturn

from fastmcp.resources import TextResource
from fastmcp.server.extensions import ServerExtension
from mcp.server.apps import EXTENSION_ID
from pydantic import AnyUrl

from .server import MCPAPP_MIME, SynapseComponent

if TYPE_CHECKING:
    from collections.abc import Sequence

    from fastmcp import FastMCP
    from fastmcp.server.extensions import MethodBinding

__all__ = ["FastMCPSynapseUI"]


class FastMCPSynapseUI(SynapseComponent, ServerExtension):
    """A `SynapseComponent` for a FastMCP server.

    Pass the instance to ``mcp.add_extension(ui)``, which serves the component's
    one ``ui://`` resource under the MCP Apps MIME. A tool binds to it through
    :meth:`tool_meta`. The arguments are `SynapseComponent`'s.

    One per server, as with `SynapseUI`: a second instance fails in
    ``add_extension`` because both advertise the MCP Apps identifier.
    """

    #: The MCP Apps extension this implements, advertised under
    #: ``ServerCapabilities.extensions``. Taken from the SDK so it cannot drift.
    identifier = EXTENSION_ID

    # The resource this extension registered on its server; None until bound.
    _resource: TextResource | None = None

    def _bind(self, server: FastMCP) -> None:
        # FastMCP's `ServerExtension` has no resource contribution, and the
        # resource must exist exactly when the extension does, so it is registered
        # as the server binds the extension (`add_extension`). A second bind to the
        # same server reuses the resource already registered there.
        already_bound = self._server_ref is not None and self._server_ref() is server
        super()._bind(server)
        if already_bound and self._resource is not None:
            return
        resource = TextResource(
            uri=AnyUrl(self.uri),
            name=self.uri,
            mime_type=MCPAPP_MIME,
            meta=self.resource_meta(),
            text=self.template_html(),
        )
        server.add_resource(resource)
        self._resource = resource

    def tools(self) -> NoReturn:
        # ``MCPServer(extensions=[...])`` takes the ``mcp`` SDK's ``Extension`` and
        # reads its ``tools()`` first, which FastMCP's ``ServerExtension`` does not
        # define, so this class handed to it would fail with an ``AttributeError``
        # naming neither class. FastMCP never calls ``tools()`` on an extension.
        raise TypeError(
            "FastMCPSynapseUI is the extension for a FastMCP server "
            "(mcp.add_extension(ui)). On the mcp SDK's MCPServer, declare the component "
            "with nimblebrain_synapse.SynapseUI, which takes the same arguments, and "
            "pass that in extensions=[...]."
        )

    def methods(self) -> Sequence[MethodBinding]:
        # `add_extension` binds before it reads the methods. `_bind` is
        # FastMCP-private, so if a FastMCP release stops calling it the tool would
        # name a resource the server does not serve; fail registration instead.
        if self._resource is None:
            raise RuntimeError(
                "FastMCPSynapseUI was not bound before its methods were read; "
                "this FastMCP version is not supported"
            )
        return ()

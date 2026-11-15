"""nimblebrain-synapse — the server (Python) half of the Synapse cross-host UI framework.

Pairs with the `@nimblebrain/synapse` client (`connectUI` / `window.SynapseUI`).
`SynapseUI` registers a component on the `mcp` SDK's `MCPServer`;
`nimblebrain_synapse.fastmcp.FastMCPSynapseUI` registers one on a FastMCP server
and is imported from its own module, the only one that needs FastMCP installed.
"""

from __future__ import annotations

from importlib.metadata import version

from .auth import BearerError, auth_error_result
from .server import (
    DEFAULT_DATA_ELEMENT_ID,
    MCPAPP_MIME,
    SynapseComponent,
    SynapseUI,
)

__all__ = [
    "SynapseUI",
    "SynapseComponent",
    "auth_error_result",
    "BearerError",
    "MCPAPP_MIME",
    "DEFAULT_DATA_ELEMENT_ID",
]

# Derived from the installed distribution metadata, so it can't drift from
# pyproject's version.
__version__ = version("nimblebrain-synapse")

# The `@nimblebrain/synapse` npm release the vendored client IIFE
# (`_assets/synapse-ui.iife.js`) was built from. This package versions
# independently of the JS one (different cadence, different consumers); the two
# meet only on the wire protocol. CI keeps this equal to the sibling package.json
# version (ci.yml build job), so the pin can't silently go stale.
__client_version__ = "0.39.0"

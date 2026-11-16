"""nimblebrain-synapse — the server (Python) half of the Synapse cross-host UI framework.

Pairs with the `@nimblebrain/synapse` client (`connectUI` / `window.SynapseUI`).
`SynapseUI` registers a component on the `mcp` SDK's `MCPServer`;
`nimblebrain_synapse.fastmcp.FastMCPSynapseUI` registers one on a FastMCP server
and is imported from its own module, the only one that needs FastMCP installed.

Deprecated: FastMCP 4 serves MCP Apps UIs natively (``fastmcp.apps``), so this package
receives no further releases. Importing it raises a ``DeprecationWarning`` naming the
replacement.
"""

from __future__ import annotations

import warnings
from importlib.metadata import version

from .auth import BearerError, auth_error_result
from .server import (
    DEFAULT_DATA_ELEMENT_ID,
    MCPAPP_MIME,
    SynapseComponent,
    SynapseUI,
)

#: What the import warning says. Kept as a constant so a test can hold it to the pages it names.
DEPRECATION_MESSAGE = (
    "nimblebrain-synapse is deprecated and receives no further releases. FastMCP 4 serves "
    "MCP Apps UIs natively: serve the ui:// resource and bind tools with fastmcp.apps.AppConfig, "
    "and keep @nimblebrain/synapse in the browser. "
    "See https://synapse.nimblebrain.ai/docs/quickstart-python/ and, for ChatGPT, "
    "https://synapse.nimblebrain.ai/docs/guides/chatgpt/"
)

# stacklevel=2 names the import that triggered it rather than this line.
warnings.warn(DEPRECATION_MESSAGE, DeprecationWarning, stacklevel=2)

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

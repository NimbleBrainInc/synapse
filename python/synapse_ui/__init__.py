"""synapse-ui — the server (Python) half of the Synapse cross-host UI framework.

Pairs with the `@nimblebrain/synapse` client (`connectUI` / `window.SynapseUI`).
See `SynapseUI` in `synapse_ui.server`.
"""

from __future__ import annotations

from .server import (
    DEFAULT_DATA_ELEMENT_ID,
    MCPUI_MIME,
    SKYBRIDGE_MIME,
    SynapseUI,
)

__all__ = ["SynapseUI", "SKYBRIDGE_MIME", "MCPUI_MIME", "DEFAULT_DATA_ELEMENT_ID"]

__version__ = "0.1.0"

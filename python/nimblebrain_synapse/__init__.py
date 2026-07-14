"""nimblebrain-synapse — the server (Python) half of the Synapse cross-host UI framework.

Pairs with the `@nimblebrain/synapse` client (`connectUI` / `window.SynapseUI`).
See `SynapseUI` in `nimblebrain_synapse.server`.
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

# The `@nimblebrain/synapse` npm release the vendored client IIFE
# (`_assets/synapse-ui.iife.js`) was built from. This package versions
# independently of the JS one (different cadence, different consumers); the two
# meet only on the wire protocol. Bump this whenever the IIFE is re-vendored.
__client_version__ = "0.12.0"

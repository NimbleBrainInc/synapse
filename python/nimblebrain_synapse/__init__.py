"""nimblebrain-synapse — the server (Python) half of the Synapse cross-host UI framework.

Pairs with the `@nimblebrain/synapse` client (`connectUI` / `window.SynapseUI`).
See `SynapseUI` in `nimblebrain_synapse.server`.
"""

from __future__ import annotations

from importlib.metadata import PackageNotFoundError, version

from .server import (
    DEFAULT_DATA_ELEMENT_ID,
    MCPAPP_MIME,
    MCPUI_MIME,
    SKYBRIDGE_MIME,
    SynapseUI,
)

__all__ = ["SynapseUI", "SKYBRIDGE_MIME", "MCPUI_MIME", "MCPAPP_MIME", "DEFAULT_DATA_ELEMENT_ID"]

# Derived from the installed distribution metadata, so it can't drift from
# pyproject's version. Falls back only when imported from an uninstalled source
# tree — the vendoring pattern this package exists to retire.
try:
    __version__ = version("nimblebrain-synapse")
except PackageNotFoundError:
    __version__ = "0.0.0+unknown"

# The `@nimblebrain/synapse` npm release the vendored client IIFE
# (`_assets/synapse-ui.iife.js`) was built from. This package versions
# independently of the JS one (different cadence, different consumers); the two
# meet only on the wire protocol. CI keeps this equal to the sibling package.json
# version (ci.yml build job), so the pin can't silently go stale.
__client_version__ = "0.12.0"

"""Importing the package warns that it is deprecated, and names the replacement."""

from __future__ import annotations

import importlib
import warnings

import nimblebrain_synapse


def test_import_raises_a_deprecation_warning_naming_the_replacement() -> None:
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        importlib.reload(nimblebrain_synapse)

    deprecations = [w for w in caught if issubclass(w.category, DeprecationWarning)]
    assert len(deprecations) == 1
    message = str(deprecations[0].message)
    assert message == nimblebrain_synapse.DEPRECATION_MESSAGE
    assert "fastmcp.apps.AppConfig" in message
    assert "https://synapse.nimblebrain.ai/docs/quickstart-python/" in message
    assert "https://synapse.nimblebrain.ai/docs/guides/chatgpt/" in message


def test_the_api_still_imports() -> None:
    """The last release deprecates; it removes nothing a consumer imports."""
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", DeprecationWarning)
        from nimblebrain_synapse import SynapseUI, auth_error_result

    assert SynapseUI is not None
    assert auth_error_result is not None

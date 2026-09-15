"""The tool-result half of a server's mid-conversation sign-in prompt.

A server that requires auth declares it on each tool (``securitySchemes``, emitted
by ``SynapseUI.tool_meta``) and answers a call it cannot authorize with the error
result built here. ChatGPT needs both to offer sign-in in the middle of a
conversation instead of failing the call; see the OpenAI Apps SDK authentication
guide (https://developers.openai.com/apps-sdk/build/auth).
"""

from __future__ import annotations

from typing import Literal

from mcp import types

__all__ = ["BearerError", "auth_error_result"]

BearerError = Literal["invalid_request", "invalid_token", "insufficient_scope"]
"""The error codes a ``Bearer`` challenge carries (RFC 6750 §3.1)."""


def _quoted(value: str) -> str:
    """An RFC 9110 quoted-string: a ``"`` or ``\\`` in ``value`` cannot end it early."""
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


def auth_error_result(
    *, resource_metadata: str, error: BearerError, description: str
) -> types.CallToolResult:
    """A failed tool result carrying a ``WWW-Authenticate`` challenge in ``_meta``.

    The challenge is the one an HTTP ``401`` would carry, moved into
    ``_meta["mcp/www_authenticate"]`` (a list of challenge strings) because a tool
    call that cannot be authorized still completes as a JSON-RPC result. The
    ``description`` is also the result's text content, so a client that does not
    read the challenge still shows why the call failed.

    A tool that declares structured output can return this too, annotated as
    ``Annotated[CallToolResult, Model]``: the SDK does not validate an error result
    against the output schema, and still builds ``structuredContent`` from a
    ``Model`` returned on the success path.

    Args:
        resource_metadata: URL of the server's OAuth protected-resource metadata
            (RFC 9728), e.g. ``https://example.com/.well-known/oauth-protected-resource``.
        error: Why the call was refused. ChatGPT's guide uses
            ``insufficient_scope`` for a call that arrived with no token.
        description: A human-readable reason, sent as ``error_description``.
    """
    challenge = (
        f"Bearer resource_metadata={_quoted(resource_metadata)}, "
        f"error={_quoted(error)}, error_description={_quoted(description)}"
    )
    return types.CallToolResult(
        content=[types.TextContent(type="text", text=description)],
        is_error=True,
        _meta={"mcp/www_authenticate": [challenge]},
    )

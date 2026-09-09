"""Minimal OpenRouter client wrapper.

Sends chat-completion requests to OpenRouter and returns the assistant text.
The model and base URL are configurable via env for future parts.
"""
import os

import httpx

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
TIMEOUT_SECONDS = 60.0


def api_key() -> str | None:
    """Return the configured OpenRouter API key, if present."""
    return os.environ.get("OPENROUTER_API_KEY")


def default_model() -> str:
    """Return the configured OpenRouter model, re-read from env on each call."""
    return os.environ.get("OPENROUTER_MODEL", "openai/gpt-oss-120b")


class OpenRouterError(RuntimeError):
    """Raised when the OpenRouter call fails (network, auth, or upstream)."""


def chat(
    messages: list[dict[str, str]],
    *,
    model: str | None = None,
    response_format: dict | None = None,
) -> str:
    """Send a chat request and return the assistant's text reply.

    `messages` follows the standard OpenAI shape, e.g.
    `[{"role": "user", "content": "What is 2+2?"}]`.
    """
    key = api_key()
    if not key:
        raise OpenRouterError("OPENROUTER_API_KEY is not set")

    headers = {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }
    payload: dict = {
        "model": model or default_model(),
        "messages": messages,
    }
    if response_format is not None:
        payload["response_format"] = response_format

    try:
        response = httpx.post(
            OPENROUTER_URL, headers=headers, json=payload, timeout=TIMEOUT_SECONDS
        )
    except httpx.HTTPError as exc:  # network errors, timeouts
        raise OpenRouterError(f"OpenRouter request failed: {exc}") from exc

    if response.status_code != 200:
        raise OpenRouterError(
            f"OpenRouter returned {response.status_code}: {response.text[:500]}"
        )

    body = response.json()
    try:
        content = body["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        raise OpenRouterError(f"Unexpected OpenRouter response: {body}") from exc

    # Guard against null/empty content (some models emit a null content field).
    if content is None:
        return ""
    return str(content)

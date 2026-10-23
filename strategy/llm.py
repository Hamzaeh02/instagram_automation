from __future__ import annotations

import json
import re

from common.config import settings
from common.logging import get_logger

logger = get_logger(__name__)

# Streaming, so a big batch of fully-written posts never hits an HTTP
# timeout or gets cut off mid-JSON.
MAX_TOKENS = 64000



class LLMError(RuntimeError):
    pass


def extract_json_object(text: str) -> dict:
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        raise ValueError(f"No JSON object found in model response:\n{text[:500]}")
    return json.loads(match.group(0))


def extract_json_array(text: str) -> list[dict]:
    match = re.search(r"\[.*\]", text, re.DOTALL)
    if not match:
        raise ValueError(f"No JSON array found in model response:\n{text[:500]}")
    return json.loads(match.group(0))


def _client():
    from anthropic import Anthropic

    if not settings.anthropic_api_key:
        raise LLMError("ANTHROPIC_API_KEY isn't set - add your Anthropic API key to .env and restart the server")
    return Anthropic(api_key=settings.anthropic_api_key)


def generate_text(prompt: str, *, effort: str = "medium", system: str | None = None) -> str:
    """One Claude call. No web search - content comes from the brand profile
    and Claude's own knowledge, which keeps every call cheap."""
    client = _client()
    model = settings.anthropic_model
    params = dict(
        model=model,
        max_tokens=MAX_TOKENS,
        thinking={"type": "adaptive"},
        output_config={"effort": effort},
        messages=[{"role": "user", "content": prompt}],
        **({"system": system} if system else {}),
    )
    if "haiku" in model:
        stream_ctx = client.messages.stream(**params)
    else:
        # If a safety classifier declines, the API retries on a fallback
        # model inside the same call instead of returning nothing (not
        # offered for Haiku).
        stream_ctx = client.beta.messages.stream(
            betas=["server-side-fallback-2026-07-01"], fallbacks="default", **params
        )
    with stream_ctx as stream:
        response = stream.get_final_message()

    if response.stop_reason == "refusal":
        raise LLMError("Claude declined to write this content - try rephrasing the brief")
    if response.stop_reason == "max_tokens":
        raise LLMError("The response was too long and got cut off - try fewer days or a narrower brief")
    logger.info("Claude call done (in=%s out=%s tokens)", response.usage.input_tokens, response.usage.output_tokens)
    return "".join(b.text for b in response.content if b.type == "text")

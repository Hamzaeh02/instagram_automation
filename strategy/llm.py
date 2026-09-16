from __future__ import annotations

import json
import re

from common.config import settings
from common.logging import get_logger

logger = get_logger(__name__)

# A batch of BATCH_SIZE=10 Reels, each needing a full 30-60s voiceover
# script plus hook/caption/hashtags/etc, comfortably exceeds 4096 tokens -
# that limit was causing the model's JSON response to get cut off mid-field,
# which _extract_json_array/_extract_json_object then correctly rejected as
# malformed (rather than silently accepting truncated content), failing the
# whole batch. Every brand-new signup hit this on their very first calendar
# generation. Raised with headroom for the largest realistic batch.
MAX_TOKENS = 8192


def extract_json_object(text: str) -> dict:
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        raise ValueError(f"No JSON object found in model response:\n{text[:500]}")
    return json.loads(match.group(0))


def _call_anthropic(prompt: str) -> str:
    from anthropic import Anthropic

    client = Anthropic(api_key=settings.anthropic_api_key)
    response = client.messages.create(
        model=settings.anthropic_model,
        max_tokens=MAX_TOKENS,
        messages=[{"role": "user", "content": prompt}],
    )
    return "".join(block.text for block in response.content if block.type == "text")


def _call_groq(prompt: str) -> str:
    from groq import Groq

    client = Groq(api_key=settings.groq_api_key)
    response = client.chat.completions.create(
        model=settings.groq_model,
        max_tokens=MAX_TOKENS,
        messages=[{"role": "user", "content": prompt}],
    )
    return response.choices[0].message.content or ""


def generate_text(prompt: str) -> str:
    """Dispatches to whichever LLM provider is active (LLM_PROVIDER=anthropic|groq)."""
    provider = settings.llm_provider
    if provider == "anthropic":
        return _call_anthropic(prompt)
    if provider == "groq":
        return _call_groq(prompt)
    raise ValueError(f"Unknown LLM_PROVIDER '{provider}' (expected 'anthropic' or 'groq')")

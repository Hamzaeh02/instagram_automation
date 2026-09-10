from __future__ import annotations

from common.config import settings
from common.logging import get_logger

logger = get_logger(__name__)

MAX_TOKENS = 4096


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

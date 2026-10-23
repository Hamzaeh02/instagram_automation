"""Gemini image generation (Interactions API) - one image per call, with
optional reference photos (the creator's face, real products)."""

from __future__ import annotations

import base64

import httpx

from common.config import settings

ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions"


class GeminiImageError(RuntimeError):
    pass


def _find_image(node) -> str | None:
    """Base64 data of the last image anywhere in the response - covers both
    the top-level output_image and images inside steps' content blocks."""
    found = None
    if isinstance(node, dict):
        if node.get("type") == "image" and isinstance(node.get("data"), str):
            found = node["data"]
        out = node.get("output_image")
        if isinstance(out, dict) and isinstance(out.get("data"), str):
            found = out["data"]
        for value in node.values():
            inner = _find_image(value)
            if inner:
                found = inner
    elif isinstance(node, list):
        for value in node:
            inner = _find_image(value)
            if inner:
                found = inner
    return found


def generate_image(
    prompt: str, aspect_ratio: str, references: list[tuple[bytes, str]] | None = None, size: str | None = None
) -> bytes:
    """Returns JPEG bytes. `references` are (image bytes, mime type) pairs."""
    if not settings.gemini_api_key:
        raise GeminiImageError("GEMINI_API_KEY isn't set - add it to .env and restart the server")
    inputs: list[dict] = [{"type": "text", "text": prompt}]
    for data, mime in references or []:
        inputs.append({"type": "image", "mime_type": mime, "data": base64.b64encode(data).decode()})
    resp = httpx.post(
        ENDPOINT,
        headers={"x-goog-api-key": settings.gemini_api_key, "Content-Type": "application/json"},
        json={
            "model": settings.gemini_image_model,
            "input": inputs,
            "response_format": {
                "type": "image",
                "mime_type": "image/jpeg",
                "aspect_ratio": aspect_ratio,
                "image_size": size or settings.gemini_image_size,
            },
        },
        timeout=180,
    )
    if resp.status_code >= 400:
        raise GeminiImageError(f"Gemini returned {resp.status_code}: {resp.text[:400]}")
    data = _find_image(resp.json())
    if not data:
        raise GeminiImageError("Gemini didn't return an image - it may have declined this prompt")
    return base64.b64decode(data)

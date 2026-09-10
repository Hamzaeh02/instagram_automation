from __future__ import annotations

import asyncio

import edge_tts

DEFAULT_VOICE = "en-US-GuyNeural"


async def _synthesize(text: str, voice: str, dest_path: str) -> None:
    communicate = edge_tts.Communicate(text, voice)
    await communicate.save(dest_path)


def generate_voiceover(script: str, dest_path: str, voice: str = DEFAULT_VOICE) -> str:
    """Free neural TTS via edge-tts (no API key). Unofficial API — if Microsoft
    changes it and this starts failing, swap in Coqui TTS (self-hosted) instead."""
    asyncio.run(_synthesize(script, voice, dest_path))
    return dest_path

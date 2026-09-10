from __future__ import annotations

import os

from common.logging import get_logger
from video.assemble import build_broll_background, combine_final_video, ffprobe_duration
from video.captions import transcribe, write_ass
from video.tts import generate_voiceover

logger = get_logger(__name__)


def generate_video_for_post(post, dest_dir: str, tts_voice: str) -> str:
    """End to end: script -> voiceover -> matching broll -> burned captions ->
    final 1080x1920 mp4 on disk, already Reels-ready. Returns local file path."""
    os.makedirs(dest_dir, exist_ok=True)
    workdir = f"{dest_dir}/post_{post.id}_work"
    os.makedirs(workdir, exist_ok=True)

    audio_path = f"{workdir}/voiceover.mp3"
    logger.info("Post %s: generating voiceover", post.id)
    generate_voiceover(post.script, audio_path, voice=tts_voice)
    duration = ffprobe_duration(audio_path)

    keywords = [k.strip() for k in (post.broll_keywords or "").split(",") if k.strip()]
    if not keywords:
        keywords = [post.pillar or "lifestyle"]
    logger.info("Post %s: fetching broll for keywords %s (%.1fs)", post.id, keywords, duration)
    background_path = build_broll_background(keywords, duration, workdir)

    logger.info("Post %s: transcribing for captions", post.id)
    captions = transcribe(audio_path)
    subs_path = f"{workdir}/captions.ass"
    write_ass(captions, subs_path)

    final_path = f"{dest_dir}/post_{post.id}_final.mp4"
    logger.info("Post %s: assembling final video", post.id)
    combine_final_video(background_path, audio_path, subs_path, final_path)
    return final_path

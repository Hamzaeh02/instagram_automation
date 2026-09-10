from __future__ import annotations

import os
import subprocess

from common.logging import get_logger
from video.broll import PexelsClient

logger = get_logger(__name__)

WIDTH, HEIGHT = 1080, 1920
MAX_CLIP_FETCH_ATTEMPTS = 20


def ffprobe_duration(path: str) -> float:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
        check=True,
        capture_output=True,
        text=True,
    )
    return float(out.stdout.strip())


def build_broll_background(keywords: list[str], target_duration: float, workdir: str) -> str:
    """Search Pexels for the given keywords, download clips until their total
    duration covers target_duration, normalize each to 1080x1920, concat, trim."""
    os.makedirs(workdir, exist_ok=True)
    client = PexelsClient()
    kw_cycle = keywords or ["lifestyle"]

    clip_paths: list[str] = []
    total = 0.0
    idx = 0
    attempts = 0
    while total < target_duration + 2 and attempts < MAX_CLIP_FETCH_ATTEMPTS:
        query = kw_cycle[attempts % len(kw_cycle)]
        attempts += 1
        try:
            results = client.search(query, per_page=4)
        except Exception:
            logger.exception("Pexels search failed for '%s'", query)
            continue

        for video in results:
            file = client.pick_best_file(video)
            if not file:
                continue
            dest = f"{workdir}/clip_{idx}.mp4"
            idx += 1
            try:
                client.download(file["link"], dest)
                dur = ffprobe_duration(dest)
            except Exception:
                logger.exception("Failed to download/probe clip %s", file.get("link"))
                continue
            clip_paths.append(dest)
            total += dur
            if total >= target_duration + 2:
                break

    if not clip_paths:
        raise RuntimeError(f"Could not fetch any broll footage for keywords: {keywords}")

    normalized: list[str] = []
    for i, clip in enumerate(clip_paths):
        norm_path = f"{workdir}/norm_{i}.mp4"
        vf = f"scale={WIDTH}:{HEIGHT}:force_original_aspect_ratio=increase,crop={WIDTH}:{HEIGHT}"
        subprocess.run(
            [
                "ffmpeg", "-y", "-i", clip,
                "-vf", vf, "-an",
                "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
                norm_path,
            ],
            check=True,
            capture_output=True,
        )
        normalized.append(norm_path)

    concat_list_path = f"{workdir}/concat_list.txt"
    with open(concat_list_path, "w") as f:
        for p in normalized:
            f.write(f"file '{os.path.abspath(p)}'\n")

    concat_path = f"{workdir}/background_concat.mp4"
    subprocess.run(
        ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", concat_list_path, "-c", "copy", concat_path],
        check=True,
        capture_output=True,
    )

    trimmed_path = f"{workdir}/background_final.mp4"
    subprocess.run(
        ["ffmpeg", "-y", "-i", concat_path, "-t", str(target_duration), "-c", "copy", trimmed_path],
        check=True,
        capture_output=True,
    )
    return trimmed_path


def combine_final_video(background_path: str, audio_path: str, subtitles_path: str, dest_path: str) -> str:
    escaped_subs = os.path.abspath(subtitles_path).replace("\\", "\\\\").replace(":", "\\:").replace("'", "\\'")
    vf = f"subtitles='{escaped_subs}'"
    subprocess.run(
        [
            "ffmpeg", "-y",
            "-i", background_path,
            "-i", audio_path,
            "-vf", vf,
            "-map", "0:v:0", "-map", "1:a:0",
            "-c:v", "libx264", "-preset", "medium", "-crf", "20",
            "-c:a", "aac", "-b:a", "128k",
            "-shortest",
            dest_path,
        ],
        check=True,
        capture_output=True,
    )
    return dest_path

from __future__ import annotations

from dataclasses import dataclass

from common.logging import get_logger

logger = get_logger(__name__)

MAX_WORDS_PER_CAPTION = 6


@dataclass
class Caption:
    start: float
    end: float
    text: str


def transcribe(audio_path: str, model_size: str = "small") -> list[Caption]:
    """Free, local, open-source transcription (faster-whisper, CPU). Splits
    each whisper segment into short chunks so captions read Reels-style."""
    from faster_whisper import WhisperModel

    model = WhisperModel(model_size, device="cpu", compute_type="int8")
    segments, _ = model.transcribe(audio_path)

    captions: list[Caption] = []
    for seg in segments:
        words = seg.text.strip().split()
        if not words:
            continue
        chunk_count = max(1, (len(words) + MAX_WORDS_PER_CAPTION - 1) // MAX_WORDS_PER_CAPTION)
        chunk_size = len(words) / chunk_count
        duration = seg.end - seg.start
        for i in range(chunk_count):
            start_i = int(round(i * chunk_size))
            end_i = int(round((i + 1) * chunk_size))
            chunk_words = words[start_i:end_i]
            if not chunk_words:
                continue
            captions.append(
                Caption(
                    start=seg.start + (start_i / len(words)) * duration,
                    end=seg.start + (end_i / len(words)) * duration,
                    text=" ".join(chunk_words),
                )
            )
    return captions


def _format_ass_time(t: float) -> str:
    h = int(t // 3600)
    m = int((t % 3600) // 60)
    s = t % 60
    return f"{h:d}:{m:02d}:{s:05.2f}"


ASS_HEADER = """[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV
Style: Default,Arial,72,&H00FFFFFF,&H00000000,&H00000000,1,1,4,0,2,60,60,220

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""


def write_ass(captions: list[Caption], dest_path: str) -> str:
    lines = [ASS_HEADER]
    for c in captions:
        text = c.text.replace("\n", " ").replace(",", "\\,")
        lines.append(
            f"Dialogue: 0,{_format_ass_time(c.start)},{_format_ass_time(c.end)},Default,,0,0,0,,{text}\n"
        )
    with open(dest_path, "w") as f:
        f.writelines(lines)
    return dest_path

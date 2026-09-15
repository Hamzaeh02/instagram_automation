from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from api.auth import require_auth
from common.logging import get_logger
from strategy.llm import generate_text

logger = get_logger(__name__)
router = APIRouter(prefix="/api/ai", tags=["ai"], dependencies=[Depends(require_auth)])

# Per-field instructions so the rewrite actually fits what the field is for,
# rather than one generic "make this better" prompt for everything.
FIELD_INSTRUCTIONS: dict[str, str] = {
    "brand_name": "Suggest a clean, memorable version of this brand name. Keep it short - a name, not a tagline.",
    "niche": (
        "Rewrite this into a clear, specific 1-2 sentence description of the brand's niche/topic - "
        "concrete enough that someone could immediately picture the kind of content this account posts."
    ),
    "audience": (
        "Rewrite this into a specific, well-written description of the target audience - age range, "
        "interests, or pain points, phrased naturally."
    ),
    "tone": "Rewrite this into a crisp, specific description of a brand voice/tone (a few words to a short phrase).",
    "cta_style": "Rewrite this into a clear instruction describing what call-to-action style the captions should use.",
    "hashtag_style": (
        "Rewrite this into a clear, specific instruction for how hashtags should be chosen "
        "(mix of broad/niche/branded, roughly how many)."
    ),
    "upload_title": (
        "Rewrite this into a short, punchy internal title for this post (for the creator's own "
        "organization, not shown publicly)."
    ),
    "upload_caption": (
        "Rewrite this Instagram caption to be scroll-stopping and optimized to go viral: a strong "
        "hook in the first line that earns the read, punchy and conversational (not corporate), and "
        "a clear call-to-action at the end. Stay authentic to the original meaning - don't invent "
        "claims that weren't there, and don't make it clickbait-y or spammy."
    ),
    "upload_hashtags": (
        "Rewrite/expand this into an effective set of Instagram hashtags optimized for reach: a mix "
        "of a couple of broad high-volume tags, several specific niche tags, and 1-2 branded tags - "
        "roughly 8-15 total, space-separated."
    ),
}


class ImproveRequest(BaseModel):
    field: str
    text: str
    context: dict[str, str] = {}


class ImproveResponse(BaseModel):
    improved: str


@router.post("/improve", response_model=ImproveResponse)
def improve_field(body: ImproveRequest):
    instruction = FIELD_INSTRUCTIONS.get(body.field)
    if not instruction:
        raise HTTPException(status_code=400, detail=f"AI improve isn't available for field '{body.field}'")

    if not body.text.strip():
        raise HTTPException(status_code=400, detail="Write something first, then improve it")

    context_lines = "\n".join(f"{k}: {v}" for k, v in body.context.items() if v.strip())
    context_block = f"\nOther context about this brand so far:\n{context_lines}\n" if context_lines else ""

    prompt = f"""{instruction}
{context_block}
Current text: "{body.text}"

Return ONLY the improved text - no quotes, no explanation, no markdown, no preamble."""

    try:
        improved = generate_text(prompt).strip().strip('"').strip()
    except Exception as exc:
        logger.exception("AI improve failed for field %s", body.field)
        raise HTTPException(status_code=502, detail=f"AI improve failed: {exc}") from exc

    return ImproveResponse(improved=improved)

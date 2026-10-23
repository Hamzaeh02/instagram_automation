from __future__ import annotations

import io

from strategy.llm import generate_text

# Guards against an enormous document (a full 40-page business plan) blowing
# up the summarization prompt - text past this point is dropped before it
# ever reaches the LLM.
MAX_CHARS = 60_000

SUPPORTED_EXTENSIONS = (".txt", ".md", ".pdf", ".docx")


class DocumentTextError(ValueError):
    """Raised for anything wrong with the uploaded file itself (bad type,
    unreadable, empty) - always a 400 to the user, never a background-task
    failure buried in the activity log."""


def extract_text(filename: str, raw: bytes) -> str:
    """Pulls plain text out of an uploaded brand/business document."""
    ext = ("." + filename.rsplit(".", 1)[-1].lower()) if "." in filename else ""
    if ext not in SUPPORTED_EXTENSIONS:
        raise DocumentTextError(
            f"Unsupported file type '{ext or filename}' - upload a .txt, .md, .pdf, or .docx file"
        )

    if ext in (".txt", ".md"):
        text = raw.decode("utf-8", errors="ignore")
    elif ext == ".pdf":
        text = _extract_pdf(raw)
    else:
        text = _extract_docx(raw)

    text = text.strip()
    if not text:
        raise DocumentTextError("Couldn't find any readable text in that file")
    return text[:MAX_CHARS]


def _extract_pdf(raw: bytes) -> str:
    from pypdf import PdfReader

    try:
        reader = PdfReader(io.BytesIO(raw))
    except Exception as exc:
        raise DocumentTextError("That PDF couldn't be read - it may be corrupted or password-protected") from exc
    return "\n\n".join(page.extract_text() or "" for page in reader.pages)


def _extract_docx(raw: bytes) -> str:
    from docx import Document

    try:
        doc = Document(io.BytesIO(raw))
    except Exception as exc:
        raise DocumentTextError("That .docx file couldn't be read - it may be corrupted") from exc
    return "\n".join(p.text for p in doc.paragraphs)


def summarize_for_content_strategy(document_text: str) -> str:
    """Compresses an arbitrary uploaded document (business plan, brand brief,
    style guide, ...) into a compact content-strategy brief. generate_calendar
    batches its prompt in groups of BATCH_SIZE posts, re-sending the brief
    each time - stuffing tens of thousands of raw characters into every one
    of those calls would be slow and needlessly expensive, so this one-time
    summarization pass keeps what actually gets reused small."""
    prompt = (
        "You're helping a content strategist plan social media content. Read the "
        "document below (a business plan, brand brief, or similar) and summarize "
        "it into a concise content-strategy brief: what the brand/business is, "
        "what it offers, who it's for, its tone/voice, and 3-6 concrete content "
        "themes or angles the document suggests. Plain prose, under 300 words, no "
        "headers or markdown.\n\n"
        f"DOCUMENT:\n{document_text}"
    )
    return generate_text(prompt).strip()

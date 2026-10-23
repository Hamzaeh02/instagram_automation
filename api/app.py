from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.responses import FileResponse, HTMLResponse, PlainTextResponse

from api import (
    legal,
    routes_ai,
    routes_analytics,
    routes_brand,
    routes_competitors,
    routes_create,
    routes_engagement,
    routes_events,
    routes_facebook,
    routes_instagram,
    routes_linkedin,
    routes_messages,
    routes_orchestrator,
    routes_posts,
    routes_tiktok,
    routes_uploads,
    routes_workspaces,
    routes_x,
    routes_youtube,
)
from api.auth import router as auth_router
from db.session import init_db

app = FastAPI(title="Instagram Automation")
app.add_middleware(GZipMiddleware, minimum_size=1024)

init_db()


def _resume_interrupted_work() -> None:
    """A restart kills background tasks mid-way. Finish any post images that
    were in progress, and close runs that will never report back."""
    import datetime as dt
    import threading

    from db.models import Post, PostStatus, RunLog
    from db.session import get_session
    from orchestrator.daily import design_posts

    session = get_session()
    try:
        for run in session.query(RunLog).filter(RunLog.status == "running").all():
            run.status = "error"
            run.error = "Interrupted by a server restart"
            run.finished_at = dt.datetime.utcnow()
        stuck: dict[int, list[int]] = {}
        for post in session.query(Post).filter(Post.status == PostStatus.IMAGE_GENERATING.value).all():
            stuck.setdefault(post.workspace_id, []).append(post.id)
        session.commit()
    finally:
        session.close()
    for workspace_id, post_ids in stuck.items():
        threading.Thread(target=design_posts, args=(workspace_id, post_ids), daemon=True).start()


_resume_interrupted_work()

app.include_router(auth_router)
app.include_router(routes_workspaces.router)
app.include_router(routes_brand.router)
app.include_router(routes_posts.router)
app.include_router(routes_orchestrator.router)
app.include_router(routes_instagram.router)
app.include_router(routes_facebook.router)
app.include_router(routes_linkedin.router)
app.include_router(routes_tiktok.router)
app.include_router(routes_x.router)
app.include_router(routes_youtube.router)
app.include_router(routes_analytics.router)
app.include_router(routes_engagement.router)
app.include_router(routes_messages.router)
app.include_router(routes_competitors.router)
app.include_router(routes_events.router)
app.include_router(routes_ai.router)
app.include_router(routes_uploads.router)
app.include_router(routes_create.router)

@app.get("/terms", response_class=HTMLResponse, include_in_schema=False)
def terms_of_service() -> str:
    return legal.terms_html()


@app.get("/privacy", response_class=HTMLResponse, include_in_schema=False)
def privacy_policy() -> str:
    return legal.privacy_html()


# TikTok domain-ownership verification files - proves we control this app's
# own domain (separate from the R2 storage domain, verified via a file
# uploaded directly to that bucket instead). TikTok re-checks these
# periodically, so they stay here rather than being a one-off script.
@app.get("/tiktokVvEkDardjaxML8AjNn1W5YOWzkCLUqDo.txt", response_class=PlainTextResponse, include_in_schema=False)
def tiktok_domain_verification() -> str:
    return "tiktok-developers-site-verification=VvEkDardjaxML8AjNn1W5YOWzkCLUqDo"


DIST_DIR = Path(__file__).resolve().parent.parent / "dashboard" / "dist"

if DIST_DIR.exists():
    class _ImmutableAssets(StaticFiles):
        # Vite puts a content hash in every asset filename, so a given URL's
        # bytes never change - browsers can keep them for a year and skip the
        # download entirely on repeat visits.
        async def get_response(self, path, scope):
            response = await super().get_response(path, scope)
            if response.status_code == 200:
                response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
            return response

    app.mount("/assets", _ImmutableAssets(directory=DIST_DIR / "assets"), name="assets")

    @app.get("/{full_path:path}")
    def spa(full_path: str):
        # Serve the built dashboard for any non-API route, so client-side
        # routing (React Router) works on a hard refresh / direct link.
        # index.html must always be revalidated - it's what points at the
        # newest hashed asset filenames after each deploy.
        return FileResponse(DIST_DIR / "index.html", headers={"Cache-Control": "no-cache"})

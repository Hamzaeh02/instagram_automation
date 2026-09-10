from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from starlette.responses import FileResponse

from api import routes_brand, routes_credentials, routes_orchestrator, routes_posts
from api.auth import router as auth_router
from db.session import init_db
from review.webhook import router as webhook_router

app = FastAPI(title="Instagram Automation")

init_db()

app.include_router(webhook_router)
app.include_router(auth_router)
app.include_router(routes_brand.router)
app.include_router(routes_posts.router)
app.include_router(routes_orchestrator.router)
app.include_router(routes_credentials.router)

DIST_DIR = Path(__file__).resolve().parent.parent / "dashboard" / "dist"

if DIST_DIR.exists():
    app.mount("/assets", StaticFiles(directory=DIST_DIR / "assets"), name="assets")

    @app.get("/{full_path:path}")
    def spa(full_path: str):
        # Serve the built dashboard for any non-API route, so client-side
        # routing (React Router) works on a hard refresh / direct link.
        return FileResponse(DIST_DIR / "index.html")

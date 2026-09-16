from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from starlette.responses import FileResponse, HTMLResponse, PlainTextResponse

from api import (
    routes_ai,
    routes_brand,
    routes_create,
    routes_facebook,
    routes_instagram,
    routes_linkedin,
    routes_orchestrator,
    routes_posts,
    routes_tiktok,
    routes_uploads,
)
from api.auth import router as auth_router
from db.session import init_db

app = FastAPI(title="Instagram Automation")

init_db()

app.include_router(auth_router)
app.include_router(routes_brand.router)
app.include_router(routes_posts.router)
app.include_router(routes_orchestrator.router)
app.include_router(routes_instagram.router)
app.include_router(routes_facebook.router)
app.include_router(routes_linkedin.router)
app.include_router(routes_tiktok.router)
app.include_router(routes_ai.router)
app.include_router(routes_uploads.router)
app.include_router(routes_create.router)

_LEGAL_PAGE_STYLE = """<style>
body{font-family:-apple-system,system-ui,sans-serif;max-width:720px;margin:0 auto;padding:40px 20px;
line-height:1.6;color:#1a1a1a}h1{font-size:1.6rem}h2{font-size:1.15rem;margin-top:2em}
p,li{color:#333}small{color:#777}</style>"""

_TERMS_HTML = f"""<!doctype html><html><head><title>Terms of Service - Reelmind</title>{_LEGAL_PAGE_STYLE}</head>
<body>
<h1>Terms of Service</h1>
<p><small>Last updated: 2026</small></p>
<p>Reelmind is a content scheduling and AI-assisted content creation tool. By connecting a social
media account (Instagram, Facebook, LinkedIn, or TikTok) to Reelmind, you authorize it to publish
posts to that account on your behalf, at times and with content that you review and approve inside
the app.</p>
<h2>What Reelmind does</h2>
<ul>
<li>Stores the brand/profile information you provide to plan and write content.</li>
<li>Generates draft captions, scripts, and video/image content using third-party AI and stock-media
providers, which you can edit before anything is published.</li>
<li>Publishes approved posts to the social accounts you've explicitly connected, at the times you
schedule.</li>
</ul>
<h2>Your responsibilities</h2>
<p>You are responsible for the content you approve for publishing and for complying with each
connected platform's own terms of service and community guidelines.</p>
<h2>No warranty</h2>
<p>Reelmind is provided as-is, without warranty of any kind. It is currently an individual/early-stage
project, not a registered company.</p>
<h2>Contact</h2>
<p>Questions about these terms can be directed to the account owner via the platform where you were
given access to this tool.</p>
</body></html>"""

_PRIVACY_HTML = f"""<!doctype html><html><head><title>Privacy Policy - Reelmind</title>{_LEGAL_PAGE_STYLE}</head>
<body>
<h1>Privacy Policy</h1>
<p><small>Last updated: 2026</small></p>
<h2>What we collect</h2>
<ul>
<li><strong>Account info:</strong> the email and password you sign up with (password is stored
hashed, never in plain text).</li>
<li><strong>Brand/content info:</strong> whatever you enter to describe your brand, and any
files/media you upload or that get generated for you.</li>
<li><strong>Connected-platform tokens:</strong> when you connect Instagram, Facebook, LinkedIn, or
TikTok, we store the access token that platform issues so Reelmind can publish on your behalf. We
never see or store your password for those platforms - authentication happens entirely on each
platform's own login page.</li>
</ul>
<h2>How we use it</h2>
<p>Solely to operate the product: generating your content calendar, producing draft posts, and
publishing the posts you approve to the platforms you've connected, at your scheduled times.</p>
<h2>What we don't do</h2>
<p>We don't sell your data, and we don't use your connected accounts for anything other than the
publishing actions you initiate or schedule yourself.</p>
<h2>Data retention</h2>
<p>Your data is retained for as long as your account exists. You can request deletion at any time.</p>
<h2>Contact</h2>
<p>Questions about this policy can be directed to the account owner via the platform where you were
given access to this tool.</p>
</body></html>"""


@app.get("/terms", response_class=HTMLResponse, include_in_schema=False)
def terms_of_service() -> str:
    return _TERMS_HTML


@app.get("/privacy", response_class=HTMLResponse, include_in_schema=False)
def privacy_policy() -> str:
    return _PRIVACY_HTML


# TikTok domain-ownership verification files - proves we control this app's
# own domain (separate from the R2 storage domain, verified via a file
# uploaded directly to that bucket instead). TikTok re-checks these
# periodically, so they stay here rather than being a one-off script.
@app.get("/tiktokVvEkDardjaxML8AjNn1W5YOWzkCLUqDo.txt", response_class=PlainTextResponse, include_in_schema=False)
def tiktok_domain_verification() -> str:
    return "tiktok-developers-site-verification=VvEkDardjaxML8AjNn1W5YOWzkCLUqDo"


DIST_DIR = Path(__file__).resolve().parent.parent / "dashboard" / "dist"

if DIST_DIR.exists():
    app.mount("/assets", StaticFiles(directory=DIST_DIR / "assets"), name="assets")

    @app.get("/{full_path:path}")
    def spa(full_path: str):
        # Serve the built dashboard for any non-API route, so client-side
        # routing (React Router) works on a hard refresh / direct link.
        return FileResponse(DIST_DIR / "index.html")

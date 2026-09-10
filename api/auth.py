from __future__ import annotations

from fastapi import APIRouter, Cookie, HTTPException, Response
from itsdangerous import BadSignature, URLSafeTimedSerializer
from pydantic import BaseModel

from common.config import settings
from common.logging import get_logger

logger = get_logger(__name__)
router = APIRouter(prefix="/api/auth", tags=["auth"])

COOKIE_NAME = "ia_session"
MAX_AGE_SECONDS = 30 * 24 * 3600


def _serializer() -> URLSafeTimedSerializer:
    secret = settings.session_secret or "dev-insecure-secret-change-me"
    return URLSafeTimedSerializer(secret, salt="ia-dashboard-session")


class LoginRequest(BaseModel):
    password: str


@router.post("/login")
def login(body: LoginRequest, response: Response):
    if not settings.dashboard_password:
        logger.warning("DASHBOARD_PASSWORD is not set - refusing login until it's configured")
        raise HTTPException(status_code=500, detail="DASHBOARD_PASSWORD is not configured on the server")
    if body.password != settings.dashboard_password:
        raise HTTPException(status_code=401, detail="Incorrect password")

    token = _serializer().dumps({"authenticated": True})
    response.set_cookie(
        COOKIE_NAME, token, max_age=MAX_AGE_SECONDS, httponly=True, samesite="lax"
    )
    return {"ok": True}


@router.post("/logout")
def logout(response: Response):
    response.delete_cookie(COOKIE_NAME)
    return {"ok": True}


@router.get("/me")
def me(ia_session: str | None = Cookie(default=None)):
    if not _is_authenticated(ia_session):
        raise HTTPException(status_code=401, detail="Not authenticated")
    return {"authenticated": True}


def _is_authenticated(cookie_value: str | None) -> bool:
    if not settings.dashboard_password:
        # No password configured yet - allow access so first-run setup isn't locked out.
        return True
    if not cookie_value:
        return False
    try:
        _serializer().loads(cookie_value, max_age=MAX_AGE_SECONDS)
        return True
    except BadSignature:
        return False


def require_auth(ia_session: str | None = Cookie(default=None)) -> None:
    if not _is_authenticated(ia_session):
        raise HTTPException(status_code=401, detail="Not authenticated")

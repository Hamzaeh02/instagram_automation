from __future__ import annotations

import bcrypt
from fastapi import APIRouter, Cookie, Depends, HTTPException, Response
from itsdangerous import BadSignature, URLSafeTimedSerializer
from pydantic import BaseModel, field_validator

from common.config import settings
from common.logging import get_logger
from db.models import BrandProfile, User, Workspace
from db.session import get_session

logger = get_logger(__name__)
router = APIRouter(prefix="/api/auth", tags=["auth"])

COOKIE_NAME = "ia_session"
MAX_AGE_SECONDS = 30 * 24 * 3600
WORKSPACE_COOKIE_NAME = "ia_workspace"


def _serializer() -> URLSafeTimedSerializer:
    secret = settings.session_secret or "dev-insecure-secret-change-me"
    return URLSafeTimedSerializer(secret, salt="ia-dashboard-session")


def _hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def _verify_password(password: str, password_hash: str) -> bool:
    return bcrypt.checkpw(password.encode(), password_hash.encode())


def _set_session_cookie(response: Response, user_id: int) -> None:
    token = _serializer().dumps({"user_id": user_id})
    response.set_cookie(COOKIE_NAME, token, max_age=MAX_AGE_SECONDS, httponly=True, samesite="lax")


def _set_workspace_cookie(response: Response, workspace_id: int) -> None:
    # Unsigned - unlike the session cookie, this one is just a hint. Every
    # reader (require_workspace) re-validates that the id actually belongs
    # to the authenticated user before trusting it, so tampering just gets
    # ignored/falls back, never grants access to someone else's workspace.
    response.set_cookie(WORKSPACE_COOKIE_NAME, str(workspace_id), max_age=MAX_AGE_SECONDS, httponly=True, samesite="lax")


class SignupRequest(BaseModel):
    email: str
    password: str

    @field_validator("email")
    @classmethod
    def _valid_email(cls, v: str) -> str:
        v = v.strip().lower()
        if "@" not in v or "." not in v.split("@")[-1]:
            raise ValueError("Enter a valid email address")
        return v

    @field_validator("password")
    @classmethod
    def _password_length(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters")
        return v


class LoginRequest(BaseModel):
    email: str
    password: str


def _user_out(user: User) -> dict:
    return {"id": user.id, "email": user.email}


@router.post("/signup")
def signup(body: SignupRequest, response: Response):
    session = get_session()
    try:
        existing = session.query(User).filter(User.email == body.email).first()
        if existing:
            raise HTTPException(status_code=409, detail="An account with this email already exists")

        user = User(email=body.email, password_hash=_hash_password(body.password))
        session.add(user)
        session.commit()
        session.refresh(user)

        workspace = Workspace(user_id=user.id, name="My Workspace")
        session.add(workspace)
        session.commit()
        session.refresh(workspace)

        session.add(BrandProfile(user_id=user.id, workspace_id=workspace.id))
        session.commit()

        _set_session_cookie(response, user.id)
        _set_workspace_cookie(response, workspace.id)
        return _user_out(user)
    finally:
        session.close()


@router.post("/login")
def login(body: LoginRequest, response: Response):
    email = body.email.strip().lower()
    session = get_session()
    try:
        user = session.query(User).filter(User.email == email).first()
        if not user or not _verify_password(body.password, user.password_hash):
            raise HTTPException(status_code=401, detail="Incorrect email or password")

        _set_session_cookie(response, user.id)
        first_workspace = (
            session.query(Workspace).filter(Workspace.user_id == user.id).order_by(Workspace.id).first()
        )
        if first_workspace:
            _set_workspace_cookie(response, first_workspace.id)
        return _user_out(user)
    finally:
        session.close()


@router.post("/logout")
def logout(response: Response):
    response.delete_cookie(COOKIE_NAME)
    return {"ok": True}


def _decode_user_id(cookie_value: str | None) -> int | None:
    if not cookie_value:
        return None
    try:
        data = _serializer().loads(cookie_value, max_age=MAX_AGE_SECONDS)
        return data.get("user_id")
    except BadSignature:
        return None


def require_auth(ia_session: str | None = Cookie(default=None)) -> User:
    """FastAPI dependency: resolves the signed session cookie to a real User
    row. Every other route depends on this and scopes its queries to the
    returned user's id - that scoping is the core of tenant isolation."""
    user_id = _decode_user_id(ia_session)
    if user_id is None:
        raise HTTPException(status_code=401, detail="Not authenticated")

    session = get_session()
    try:
        user = session.get(User, user_id)
        if not user:
            raise HTTPException(status_code=401, detail="Not authenticated")
        session.expunge(user)
        return user
    finally:
        session.close()


def require_workspace(
    response: Response,
    user: User = Depends(require_auth),
    ia_workspace: str | None = Cookie(default=None),
) -> Workspace:
    """FastAPI dependency: resolves the active workspace for the
    authenticated user - this, not user_id, is the real tenant-isolation
    boundary everywhere below auth. The workspace id cookie is just a
    preference; it's always re-validated against the authenticated user
    (never trusted on its own), and falls back to - then persists - the
    user's oldest workspace if the cookie is missing, invalid, or points at
    a workspace that isn't theirs. Every user has at least one workspace
    (created at signup), so this never needs to handle "zero workspaces"."""
    session = get_session()
    try:
        workspace: Workspace | None = None
        if ia_workspace:
            try:
                candidate_id = int(ia_workspace)
            except ValueError:
                candidate_id = None
            if candidate_id is not None:
                candidate = session.get(Workspace, candidate_id)
                if candidate and candidate.user_id == user.id:
                    workspace = candidate

        if workspace is None:
            workspace = (
                session.query(Workspace).filter(Workspace.user_id == user.id).order_by(Workspace.id).first()
            )
            if workspace is None:
                raise HTTPException(status_code=500, detail="No workspace found for this account")
            _set_workspace_cookie(response, workspace.id)

        session.expunge(workspace)
        return workspace
    finally:
        session.close()


@router.get("/me")
def me(user: User = Depends(require_auth)):
    return _user_out(user)

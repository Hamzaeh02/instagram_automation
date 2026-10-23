from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel

from api.auth import _set_workspace_cookie, require_auth, require_workspace
from db.models import BrandProfile, User, Workspace
from db.session import get_session

router = APIRouter(prefix="/api/workspaces", tags=["workspaces"], dependencies=[Depends(require_auth)])


def _workspace_out(workspace: Workspace, active_id: int) -> dict:
    return {"id": workspace.id, "name": workspace.name, "active": workspace.id == active_id}


@router.get("")
def list_workspaces(user: User = Depends(require_auth), active: Workspace = Depends(require_workspace)):
    session = get_session()
    try:
        workspaces = (
            session.query(Workspace).filter(Workspace.user_id == user.id).order_by(Workspace.id).all()
        )
        return {"workspaces": [_workspace_out(w, active.id) for w in workspaces]}
    finally:
        session.close()


class CreateWorkspaceRequest(BaseModel):
    name: str


@router.post("")
def create_workspace(body: CreateWorkspaceRequest, response: Response, user: User = Depends(require_auth)):
    name = body.name.strip() or "Untitled workspace"
    session = get_session()
    try:
        workspace = Workspace(user_id=user.id, name=name)
        session.add(workspace)
        session.commit()
        session.refresh(workspace)

        # Pre-create an empty brand profile, same as signup does for the
        # first workspace - keeps "does this workspace have a brand profile
        # row" consistent everywhere instead of needing two code paths.
        session.add(BrandProfile(user_id=user.id, workspace_id=workspace.id))
        session.commit()

        _set_workspace_cookie(response, workspace.id)
        return {"id": workspace.id, "name": workspace.name, "active": True}
    finally:
        session.close()


class RenameWorkspaceRequest(BaseModel):
    name: str


@router.patch("/{workspace_id}")
def rename_workspace(workspace_id: int, body: RenameWorkspaceRequest, user: User = Depends(require_auth)):
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name can't be empty")
    session = get_session()
    try:
        workspace = session.get(Workspace, workspace_id)
        if not workspace or workspace.user_id != user.id:
            raise HTTPException(status_code=404, detail="Workspace not found")
        workspace.name = name
        session.commit()
        return {"id": workspace.id, "name": workspace.name}
    finally:
        session.close()


@router.post("/{workspace_id}/activate")
def activate_workspace(workspace_id: int, response: Response, user: User = Depends(require_auth)):
    session = get_session()
    try:
        workspace = session.get(Workspace, workspace_id)
        if not workspace or workspace.user_id != user.id:
            raise HTTPException(status_code=404, detail="Workspace not found")
        _set_workspace_cookie(response, workspace.id)
        return {"id": workspace.id, "name": workspace.name}
    finally:
        session.close()


@router.delete("/{workspace_id}")
def delete_workspace(workspace_id: int, user: User = Depends(require_auth)):
    session = get_session()
    try:
        remaining = session.query(Workspace).filter(Workspace.user_id == user.id).count()
        if remaining <= 1:
            raise HTTPException(status_code=400, detail="Can't delete your only workspace")
        workspace = session.get(Workspace, workspace_id)
        if not workspace or workspace.user_id != user.id:
            raise HTTPException(status_code=404, detail="Workspace not found")
        session.delete(workspace)  # cascades to brand profile, connections, posts, run_logs
        session.commit()
        return {"deleted": True}
    finally:
        session.close()

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

# MVP: single hardcoded user. Part 6 will validate against the users table.
VALID_USERNAME = "user"
VALID_PASSWORD = "password"

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginBody(BaseModel):
    username: str
    password: str


def get_session_user(request: Request) -> str:
    user = request.session.get("username")
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user


@router.post("/login")
def login(body: LoginBody, request: Request) -> dict[str, str]:
    if body.username != VALID_USERNAME or body.password != VALID_PASSWORD:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    request.session["username"] = body.username
    return {"username": body.username}


@router.post("/logout")
def logout(request: Request) -> dict[str, str]:
    request.session.pop("username", None)
    return {"status": "ok"}


@router.get("/me")
def me(request: Request) -> dict[str, str]:
    return {"username": get_session_user(request)}

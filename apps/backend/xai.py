"""Shared pieces for xAI calls: the key check and turning upstream failures into clear HTTP errors."""

import secrets

import httpx
from fastapi import Header, HTTPException

import settings

NO_KEY_MESSAGE = "XAI_API_KEY is not set " + ("on the server" if settings.STATELESS else "in apps/backend/.env")


def team_code_ok(code: str | None) -> bool:
    """True when no passcode is required or `code` is the right one."""
    return not settings.TEAM_CODE or secrets.compare_digest((code or "").encode(), settings.TEAM_CODE.encode())


def require_team_code(x_team_code: str | None = Header(None)) -> None:
    """Dependency on every Grok route: these calls spend the team's xAI credits, so a public deployment asks
    for the team passcode (the X-Team-Code header). With no TEAM_CODE set, local dev stays open and a
    deployment stays closed."""
    if not settings.TEAM_CODE and settings.STATELESS:
        raise HTTPException(503, "TEAM_CODE is not set on the server, so the Grok features are switched off.")
    if not team_code_ok(x_team_code):
        raise HTTPException(401, "Wrong team passcode." if x_team_code else "Enter the team passcode to use Grok here.")


def auth_headers() -> dict[str, str]:
    """Bearer header for xAI. Raises 503 when no key is configured; the key never leaves the backend."""
    key = settings.XAI_API_KEY
    if not key:
        raise HTTPException(503, NO_KEY_MESSAGE)
    return {"Authorization": f"Bearer {key}"}


def error_text(response: httpx.Response) -> str:
    """xAI's own error message, shortened. Not used for key errors, whose body could echo part of the key."""
    try:
        body = response.json()
        error = body.get("error", body)
        message = error.get("message", error) if isinstance(error, dict) else error
    except ValueError:
        message = response.text
    return str(message)[:300]


def is_key_error(response: httpx.Response) -> bool:
    """xAI answers a wrong key with 400 "Incorrect API key provided" (seen 2026-10-04), not only 401."""
    return response.status_code in (401, 403) or "API key" in response.text


def upstream_error(err: httpx.HTTPError, what: str) -> HTTPException:
    """A 502 that says which xAI call failed and why, in words the UI can show."""
    if isinstance(err, httpx.HTTPStatusError):
        status = err.response.status_code
        if is_key_error(err.response):
            return HTTPException(502, f"{what}: xAI rejected the API key ({status}). Check XAI_API_KEY in apps/backend/.env")
        return HTTPException(502, f"{what}: xAI returned {status}: {error_text(err.response)}")
    return HTTPException(502, f"{what}: could not reach xAI ({type(err).__name__})")

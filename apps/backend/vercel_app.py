"""The deployed backend (Vercel): only the Grok routes, under /api, behind the team passcode.

    POST /api/intent, POST /api/concept, POST /api/voice/transcribe, POST /api/voice/speak, GET /api/health

It reuses the local backend's modules unchanged. What is different from main.py: no /query (that needs a CLIP
model on a GPU), no scene files (they are static files of the deployment) and no disk, so a concept render
goes back in the response. scripts/deploy_vercel.sh copies this file to the deployment as app.py.
"""

import os

os.environ["PSS_STATELESS"] = "1"
os.environ["SCENES_DIR"] = "scene_facts"  # just each shipped scene's scene.json, for the prompt

from fastapi import FastAPI, Header, HTTPException, Request  # noqa: E402
from fastapi.responses import RedirectResponse  # noqa: E402

import intents  # noqa: E402
import render  # noqa: E402
import settings  # noqa: E402
import voice  # noqa: E402
import xai  # noqa: E402

app = FastAPI(title="Planetary Scene Studio (deployed Grok routes)", docs_url=None, redoc_url=None, openapi_url=None)
app.include_router(intents.router, prefix="/api")
app.include_router(render.router, prefix="/api")
app.include_router(voice.router, prefix="/api")


@app.get("/api/health")
def health(x_team_code: str | None = Header(None)):
    """Open to everyone: says whether Grok is set up and whether the passcode sent with the request is right."""
    return {
        "ok": True,
        "deployed": True,
        "grok_configured": bool(settings.XAI_API_KEY),
        "team_code_required": True,
        "team_code_ok": bool(settings.TEAM_CODE) and xai.team_code_ok(x_team_code),
        "text_model": settings.XAI_TEXT_MODEL,
        "image_model": settings.XAI_IMAGE_MODEL,
    }


@app.post("/api/query")
def query():
    raise HTTPException(501, "Open text search needs the team's own backend (it runs a CLIP model on a GPU).")


@app.get("/")
def home(request: Request):
    # The static index.html normally answers "/" before this function is reached; this is the safety net.
    return RedirectResponse("/index.html" + (f"?{request.url.query}" if request.url.query else ""))

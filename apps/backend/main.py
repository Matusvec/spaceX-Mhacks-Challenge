"""FastAPI service: keeps API keys off the browser and serves scene bundles (docs/backend.md)."""

from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

import intents
import render
import settings
import voice
import xai
from query import QueryUnavailable, query_scene

app = FastAPI(title="Planetary Scene Studio backend")
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)


app.include_router(intents.router)  # POST /intent (Grok text)
app.include_router(render.router)  # POST /concept, GET /concepts (Grok Imagine)
app.include_router(voice.router)  # POST /voice/transcribe, POST /voice/speak (Grok Voice)


@app.get("/health")
def health(x_team_code: str | None = Header(None)):
    return {
        "ok": True,
        "grok_configured": bool(settings.XAI_API_KEY),
        "team_code_required": bool(settings.TEAM_CODE),
        "team_code_ok": xai.team_code_ok(x_team_code),
        "text_model": settings.XAI_TEXT_MODEL,
        "image_model": settings.XAI_IMAGE_MODEL,
        "scenes_dir": str(settings.SCENES_DIR),
    }



class QueryRequest(BaseModel):
    scene_id: str
    text: str = Field(min_length=1, max_length=200)


@app.post("/query")
def query(request: QueryRequest):
    # A plain def: FastAPI runs it in a worker thread, so the first call (loading CLIP) does not block the server.
    try:
        return query_scene(request.scene_id, request.text.strip())
    except QueryUnavailable as err:
        raise HTTPException(503, str(err)) from err
    except FileNotFoundError as err:
        raise HTTPException(404, f"no clusters for this scene: {err}") from err


class SceneFiles(StaticFiles):
    """Bundles are re-exported in place, so browsers must revalidate (ETag) and not trust their cache."""

    def file_response(self, *args, **kwargs):
        response = super().file_response(*args, **kwargs)
        response.headers["Cache-Control"] = "no-cache"
        return response


if settings.SCENES_DIR.is_dir():
    app.mount("/scenes", SceneFiles(directory=settings.SCENES_DIR), name="scenes")
app.mount("/renders", StaticFiles(directory=settings.RENDERS_DIR), name="renders")  # saved concept renders

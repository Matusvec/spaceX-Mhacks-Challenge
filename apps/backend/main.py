"""FastAPI service: keeps API keys off the browser and serves scene bundles (docs/backend.md)."""

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import settings
from intents import text_to_intent

app = FastAPI(title="Planetary Scene Studio backend")
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)


class IntentContext(BaseModel):
    selected_module_id: int | None = None
    pins: list[str] = []


class IntentRequest(BaseModel):
    text: str
    scene_id: str
    context: IntentContext = IntentContext()


@app.get("/health")
def health():
    return {"ok": True, "grok_configured": bool(settings.XAI_API_KEY), "scenes_dir": str(settings.SCENES_DIR)}


@app.post("/intent")
async def intent(request: IntentRequest):
    if not settings.XAI_API_KEY:
        raise HTTPException(503, "XAI_API_KEY is not set in apps/backend/.env")
    try:
        return await text_to_intent(request.text, request.context.pins)
    except httpx.HTTPError as err:
        raise HTTPException(502, f"Grok request failed: {err}") from err


if settings.SCENES_DIR.is_dir():
    app.mount("/scenes", StaticFiles(directory=settings.SCENES_DIR), name="scenes")

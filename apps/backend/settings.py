import os
from pathlib import Path

from dotenv import dotenv_values, load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent
load_dotenv(BACKEND_DIR / ".env")


def __getattr__(name: str) -> str:
    # settings.XAI_API_KEY is read on every use, so a key added to .env while the server runs works without a restart.
    if name == "XAI_API_KEY":
        return os.environ.get("XAI_API_KEY") or dotenv_values(BACKEND_DIR / ".env").get("XAI_API_KEY") or ""
    raise AttributeError(name)


XAI_BASE_URL = os.environ.get("XAI_BASE_URL", "https://api.x.ai/v1").rstrip("/")
XAI_TEXT_MODEL = os.environ.get("XAI_TEXT_MODEL", "grok-4.20-0309-non-reasoning")
# Grok Imagine (render.py) and Grok Voice (voice.py). Model ids checked against docs.x.ai on 2026-10-04.
XAI_IMAGE_MODEL = os.environ.get("XAI_IMAGE_MODEL", "grok-imagine-image-2.0")
XAI_STT_MODEL = os.environ.get("XAI_STT_MODEL", "grok-voice-transcribe-2.0")
XAI_VOICE_ID = os.environ.get("XAI_VOICE_ID", "eve")
# Passcode(s) for every Grok route (xai.require_team_code), comma-separated. Unset: open, right for local dev only.
TEAM_CODE = os.environ.get("TEAM_CODE", "")
# Serverless deployment (vercel_app.py): no durable disk, so a render goes back in the response and nothing is saved.
STATELESS = os.environ.get("PSS_STATELESS") == "1"
# Concept renders are kept on disk so the gallery survives a reload.
RENDERS_DIR = (BACKEND_DIR / os.environ.get("RENDERS_DIR", "renders")).resolve()
SCENES_DIR = (BACKEND_DIR / os.environ.get("SCENES_DIR", "../../scenes")).resolve()
# TorchScript decoder for cluster centroids, 16 -> 512 (contracts.md section 4). Only /query reads it.
AE_DECODER_PATH = (BACKEND_DIR / os.environ.get("AE_DECODER_PATH", "models/ae_decoder.pt")).resolve()
ALLOWED_ORIGINS = [o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "http://localhost:5173").split(",") if o.strip()]

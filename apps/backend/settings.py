import os
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent
load_dotenv(BACKEND_DIR / ".env")

XAI_API_KEY = os.environ.get("XAI_API_KEY", "")
XAI_TEXT_MODEL = os.environ.get("XAI_TEXT_MODEL", "grok-4.20-0309-non-reasoning")
SCENES_DIR = (BACKEND_DIR / os.environ.get("SCENES_DIR", "../../scenes")).resolve()
ALLOWED_ORIGINS = [o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "http://localhost:5173").split(",") if o.strip()]

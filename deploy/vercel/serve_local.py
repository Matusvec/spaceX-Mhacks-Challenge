"""Local stand-in for the Vercel deployment, for checking the built output before it is uploaded.

    STAGE=<stage dir> uvicorn --app-dir deploy/vercel serve_local:app --port 8100   (scripts/deploy_vercel.sh --serve)

It answers the way Vercel does for this project: a file under <stage>/public wins, everything else goes to the
function (app.py), and a request body over 4.5 MB is refused. Vercel itself never runs this file.
"""

import os
import sys
from pathlib import Path

from starlette.responses import PlainTextResponse
from starlette.staticfiles import StaticFiles

STAGE = Path(os.environ["STAGE"]).resolve()
PUBLIC = STAGE / "public"
MAX_BODY_BYTES = 4_500_000  # Vercel's limit for a function's request body

sys.path.insert(0, str(STAGE))
from app import app as function  # noqa: E402  (the staged copy of apps/backend/vercel_app.py)

static = StaticFiles(directory=PUBLIC, html=True)


async def app(scope, receive, send):
    if scope["type"] == "http":
        path = scope["path"]
        if scope["method"] in ("GET", "HEAD") and (path == "/" or (PUBLIC / path.lstrip("/")).is_file()):
            return await static(scope, receive, send)
        length = dict(scope["headers"]).get(b"content-length", b"0")
        if int(length) > MAX_BODY_BYTES:
            return await PlainTextResponse("FUNCTION_PAYLOAD_TOO_LARGE", status_code=413)(scope, receive, send)
    await function(scope, receive, send)

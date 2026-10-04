"""Grok Imagine concept render: the user's current 3D view, edited to show their base on that terrain.

POST /concept sends the captured view to xAI's image edit endpoint (docs.x.ai, images/editing) and keeps the
result on disk; GET /concepts lists the last few. Output is an AI concept picture, never data: the UI labels it.
"""

import base64
import binascii
import json
import re
import secrets
import time
from collections import Counter
from typing import Literal

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

import settings
import xai

router = APIRouter(dependencies=[Depends(xai.require_team_code)])
if not settings.STATELESS:
    settings.RENDERS_DIR.mkdir(parents=True, exist_ok=True)
    (settings.RENDERS_DIR / ".gitignore").write_text("*\n")  # generated pictures are never committed

ModuleType = Literal["habitat", "greenhouse_dome", "tunnel", "landing_pad", "solar_field"]
MODULE_WORDS = {
    "habitat": ("habitat", "habitats"),
    "greenhouse_dome": ("greenhouse dome", "greenhouse domes"),
    "tunnel": ("connecting tunnel", "connecting tunnels"),
    "landing_pad": ("landing pad", "landing pads"),
    "solar_field": ("solar panel field", "solar panel fields"),
}
BODY_NAMES = {"mars": "Mars", "moon": "the Moon"}
EXTENSIONS = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}
# A status that means "this edit request is not accepted", as opposed to a bad key, rate limit or outage.
EDIT_UNAVAILABLE = {400, 404, 405, 415, 422}
GALLERY_SIZE = 8
DATA_URL = re.compile(r"^data:(image/(?:jpeg|png|webp));base64,(.+)$", re.DOTALL)


class ConceptModule(BaseModel):
    type: ModuleType
    x: float = 0  # site frame, meters east
    y: float = 0  # site frame, meters north


class ConceptRequest(BaseModel):
    scene_id: str = Field(pattern=r"^[\w.-]+$", max_length=80)
    prompt: str = Field("", max_length=400)  # the user's own words for the base idea
    image: str | None = Field(None, max_length=12_000_000)  # data URL of the current 3D view
    modules: list[ConceptModule] = Field([], max_length=40)


def scene_facts(scene_id: str) -> tuple[str, str]:
    """(body name, site title) from the scene's own manifest, so the prompt states only real scene facts."""
    path = settings.SCENES_DIR / scene_id / "scene.json"
    if scene_id.startswith(".") or not path.is_file():
        raise HTTPException(404, f"unknown scene: {scene_id}")
    manifest = json.loads(path.read_text())
    return BODY_NAMES.get(manifest.get("body"), str(manifest.get("body"))), str(manifest.get("title", scene_id))


def build_prompt(body: str, title: str, modules: list[ConceptModule], idea: str, has_view: bool) -> str:
    """The exact text sent to Grok Imagine. Returned to the browser so the user can read it."""
    counts = Counter(module.type for module in modules)
    listed = ", ".join(f"{n} {MODULE_WORDS[kind][n > 1]}" for kind, n in counts.items())
    parts = []
    if has_view:
        parts.append(
            f"Edit this image into a photorealistic concept render of a crewed base on {body}, at {title}. "
            "Keep the terrain and camera angle: the ground, rocks, horizon, lighting and viewpoint must stay "
            "exactly as in the image. Only add the base, standing on the ground at a believable scale."
        )
        if modules:
            parts.append(
                f"The base has {listed}. The plain placeholder shape in the image marks where "
                f"{'it stands' if len(modules) == 1 else 'they stand'}: replace it with the finished structure there."
            )
    else:
        parts.append(f"Photorealistic concept render of a crewed base on {body}, at {title}, seen from a low aerial view.")
        if modules:
            parts.append(f"The base has {listed}.")
    if idea.strip():
        parts.append(f"Design idea: {idea.strip().rstrip('.')}.")
    elif not modules:
        parts.append("The base is a small first outpost: a habitat, a greenhouse dome and a solar panel field.")
    parts.append("Remove any colored map overlays, markers and gizmos. No text, labels or logos in the picture.")
    return " ".join(parts)


async def _imagine(path: str, payload: dict) -> tuple[bytes, str]:
    """One Grok Imagine call. Returns (image bytes, mime type)."""
    headers = xai.auth_headers()
    async with httpx.AsyncClient(timeout=180) as client:
        response = await client.post(
            f"{settings.XAI_BASE_URL}{path}",
            headers=headers,
            json={"model": settings.XAI_IMAGE_MODEL, "response_format": "b64_json", **payload},
        )
        response.raise_for_status()
        item = response.json()["data"][0]
        if item.get("b64_json"):
            return base64.b64decode(item["b64_json"]), item.get("mime_type") or "image/jpeg"
        # xAI's image URLs are temporary, so fetch the picture now and keep our own copy.
        picture = await client.get(item["url"])
        picture.raise_for_status()
        return picture.content, picture.headers.get("content-type", "image/jpeg").split(";")[0]


async def render(request: ConceptRequest) -> dict:
    """Edit the user's view with Grok Imagine; plain text-to-image only when no view came or the edit is refused."""
    xai.auth_headers()  # 503 before any work when there is no key
    body, title = scene_facts(request.scene_id)
    view = DATA_URL.match(request.image) if request.image else None
    if request.image and not view:
        raise HTTPException(422, "image must be a JPEG, PNG or WebP data URL")

    mode, note, result = "edit", None, None
    if view:
        prompt = build_prompt(body, title, request.modules, request.prompt, has_view=True)
        try:
            result = await _imagine("/images/edits", {"prompt": prompt, "image": {"url": request.image, "type": "image_url"}})
        except httpx.HTTPStatusError as err:
            if err.response.status_code not in EDIT_UNAVAILABLE or xai.is_key_error(err.response):
                raise
            note = f"Image edit was refused ({err.response.status_code}: {xai.error_text(err.response)}), so this is not your view."
    if result is None:
        mode = "generate"
        note = note or "No view was sent, so this is not your view."
        prompt = build_prompt(body, title, request.modules, request.prompt, has_view=False)
        result = await _imagine("/images/generations", {"prompt": prompt, "aspect_ratio": "3:2"})

    image_bytes, mime = result
    render_id = f"{time.strftime('%Y%m%d-%H%M%S')}-{secrets.token_hex(2)}"
    image_name = f"{render_id}.{EXTENSIONS.get(mime, 'jpg')}"
    view_name = None
    if settings.STATELESS:
        # No disk to keep it on: the picture travels in the response and the browser keeps its own gallery.
        image_url = f"data:{mime};base64,{base64.b64encode(image_bytes).decode()}"
    else:
        image_url = f"/renders/{image_name}"
        (settings.RENDERS_DIR / image_name).write_bytes(image_bytes)
    if view and not settings.STATELESS:
        try:
            view_name = f"{render_id}-view.{EXTENSIONS[view.group(1)]}"
            (settings.RENDERS_DIR / view_name).write_bytes(base64.b64decode(view.group(2)))
        except binascii.Error:
            view_name = None
    record = {
        "id": render_id,
        "scene_id": request.scene_id,
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "model": settings.XAI_IMAGE_MODEL,
        "mode": mode,  # "edit": made from the user's view. "generate": text only, not this terrain.
        "note": note,
        "prompt": prompt,
        "idea": request.prompt.strip(),
        "image_url": image_url,
        "view_url": f"/renders/{view_name}" if view_name else None,
    }
    if not settings.STATELESS:
        (settings.RENDERS_DIR / f"{render_id}.json").write_text(json.dumps(record, indent=1))
    return record


@router.post("/concept")
async def concept(request: ConceptRequest):
    try:
        return await render(request)
    except httpx.HTTPError as err:
        raise xai.upstream_error(err, "Grok Imagine") from err


@router.get("/concepts")
def concepts(scene_id: str):
    """The last few concept renders for a scene, newest first."""
    records = []
    if settings.STATELESS:
        return records
    for path in sorted(settings.RENDERS_DIR.glob("*.json"), reverse=True):
        record = json.loads(path.read_text())
        if record.get("scene_id") == scene_id:
            records.append(record)
        if len(records) == GALLERY_SIZE:
            break
    return records


def _self_check() -> None:
    modules = [ConceptModule(type="habitat"), ConceptModule(type="greenhouse_dome"), ConceptModule(type="greenhouse_dome")]
    prompt = build_prompt("Mars", "Cheyava Falls", modules, " three domes ", has_view=True)
    assert "1 habitat, 2 greenhouse domes" in prompt and "Keep the terrain and camera angle" in prompt, prompt
    assert "Design idea: three domes. Remove" in prompt and "they stand" in prompt, prompt
    assert "first outpost" in build_prompt("the Moon", "Malapert", [], "", has_view=False)
    assert DATA_URL.match("data:image/jpeg;base64,AAAA") and not DATA_URL.match("https://example.com/a.jpg")
    print("render.py self-check ok")


if __name__ == "__main__":
    _self_check()

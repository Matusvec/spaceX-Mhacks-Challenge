"""Grok call: chat text to exactly one intent (docs/contracts.md section 9)."""

import json
from typing import Annotated, Literal, Union

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, TypeAdapter, ValidationError

import settings
import xai

router = APIRouter(dependencies=[Depends(xai.require_team_code)])

ModuleType = Literal["habitat", "greenhouse_dome", "tunnel", "landing_pad", "solar_field"]


class FindSitesArgs(BaseModel):
    max_slope_deg: float | None = None
    near_pin: str | None = None
    within_m: float | None = None
    terrain_class: str | None = None
    min_carbonate: float | None = None


class FindSites(BaseModel):
    intent: Literal["find_sites"]
    args: FindSitesArgs = FindSitesArgs()


class PlaceModuleArgs(BaseModel):
    type: ModuleType
    at: str = "selected_site"


class PlaceModule(BaseModel):
    intent: Literal["place_module"]
    args: PlaceModuleArgs


class ShowPathArgs(BaseModel):
    from_: str = Field("rover", alias="from")
    to: str
    drive: bool = False  # proposed addition: plan the route and also drive it

    model_config = {"populate_by_name": True}


class ShowPath(BaseModel):
    intent: Literal["show_path"]
    args: ShowPathArgs


class QuerySceneArgs(BaseModel):
    text: str


class QueryScene(BaseModel):
    intent: Literal["query_scene"]
    args: QuerySceneArgs


class RenderConcept(BaseModel):
    intent: Literal["render_concept"]
    args: dict = {}


class ToggleLayerArgs(BaseModel):
    layer: str
    on: bool


class ToggleLayer(BaseModel):
    intent: Literal["toggle_layer"]
    args: ToggleLayerArgs


class CompareSitesArgs(BaseModel):
    a: int
    b: int


class CompareSites(BaseModel):
    intent: Literal["compare_sites"]
    args: CompareSitesArgs


Intent = Annotated[
    Union[FindSites, PlaceModule, ShowPath, QueryScene, RenderConcept, ToggleLayer, CompareSites],
    Field(discriminator="intent"),
]
intent_adapter = TypeAdapter(Intent)

SYSTEM_PROMPT = """You turn a user's message to a planetary rover assistant into exactly one JSON intent.
Reply with only a JSON object, no other text. Allowed intents and argument schemas:

{"intent": "find_sites", "args": {"max_slope_deg"?: number, "near_pin"?: string, "within_m"?: number, "terrain_class"?: "soil"|"bedrock"|"sand"|"big_rock", "min_carbonate"?: number 0-1}}
  Where to build or land; the best places for a base.
{"intent": "show_path", "args": {"from": "rover", "to": string, "drive": boolean}}
  Rover routes. "drive": true when the user wants the rover to actually go there (drive, go, move, head, return);
  false when they only ask whether it can get there or want to see the route.
  "to" is one of: "site N" (a numbered best site), "selected_site", "home", a pin name, or "x, y" in meters.
{"intent": "place_module", "args": {"type": "habitat"|"greenhouse_dome"|"tunnel"|"landing_pad"|"solar_field", "at": string}}
  Put a base module somewhere; "at" uses the same forms as "to" above.
{"intent": "query_scene", "args": {"text": string}}
  Questions about rocks, minerals, chemistry, samples, or what the rover found. Use the user's words as "text".
{"intent": "render_concept", "args": {"idea"?: string}}
  Make a picture, image, visualization or concept render of the base, or show what the base would look like.
  "idea" is the user's own description of the base design, if they gave one (for example "three domes linked by tunnels").
{"intent": "toggle_layer", "args": {"layer": string, "on": boolean}}
{"intent": "compare_sites", "args": {"a": number, "b": number}}

If the message is unclear or none fit, use {"intent": "query_scene", "args": {"text": <the message>}}.
Never invent pin names; use them only if the user mentions them."""


async def _ask_grok(text: str, pins: list[str]) -> str:
    user = f"Pins in this scene: {', '.join(pins) or 'none'}\nMessage: {text}"
    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.post(
            f"{settings.XAI_BASE_URL}/chat/completions",
            headers={"Authorization": f"Bearer {settings.XAI_API_KEY}"},
            json={
                "model": settings.XAI_TEXT_MODEL,
                "messages": [{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": user}],
                "response_format": {"type": "json_object"},
                "temperature": 0,
            },
        )
        response.raise_for_status()
        return response.json()["choices"][0]["message"]["content"]


async def text_to_intent(text: str, pins: list[str]) -> dict:
    """One validated intent. Retries once on a bad reply, then falls back to query_scene."""
    for _ in range(2):
        try:
            intent = intent_adapter.validate_python(json.loads(await _ask_grok(text, pins)))
            return intent.model_dump(by_alias=True, exclude_none=True)
        except (ValidationError, json.JSONDecodeError, KeyError):
            continue
    return {"intent": "query_scene", "args": {"text": text}}



class IntentContext(BaseModel):
    selected_module_id: int | None = None
    pins: list[str] = []


class IntentRequest(BaseModel):
    text: str = Field(max_length=2000)
    scene_id: str
    context: IntentContext = IntentContext()


@router.post("/intent")
async def intent(request: IntentRequest):
    if not settings.XAI_API_KEY:
        raise HTTPException(503, xai.NO_KEY_MESSAGE)
    try:
        return await text_to_intent(request.text, request.context.pins)
    except httpx.HTTPError as err:
        raise xai.upstream_error(err, "Grok chat") from err

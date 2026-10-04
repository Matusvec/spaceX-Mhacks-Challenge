"""One-command check that the three xAI APIs the app uses really work with the key in apps/backend/.env.

    apps/backend/.venv/bin/python apps/backend/smoke_grok.py

Makes one real call per API through the same functions the server uses and prints PASS or FAIL for each.
Costs a few cents (two images). Never prints the key. Without a key it only checks that the endpoints exist.
Pictures and audio it produces are saved in apps/backend/renders/ as smoke-*, so you can look and listen.
"""

import asyncio
import base64
import shutil
import subprocess
import sys

import httpx

import intents
import render
import settings
import voice
import xai

OUT = settings.RENDERS_DIR


def explain(err: Exception) -> str:
    if isinstance(err, httpx.HTTPStatusError):
        status = err.response.status_code
        return f"HTTP {status}: " + ("xAI rejected the API key" if xai.is_key_error(err.response) else xai.error_text(err.response))
    return f"{type(err).__name__}: {err}"


async def check_text() -> str:
    intent = await intents.text_to_intent("Drive the rover to site 2", [])
    assert intent["intent"] == "show_path", f"expected show_path, got {intent}"
    return f"{settings.XAI_TEXT_MODEL} -> {intent}"


async def check_image() -> str:
    picture, mime = await render._imagine(
        "/images/generations", {"prompt": "Barren rocky Mars terrain seen from a low aerial view, no buildings", "aspect_ratio": "3:2"}
    )
    (OUT / f"smoke-1-generated.{render.EXTENSIONS.get(mime, 'jpg')}").write_bytes(picture)
    data_url = f"data:{mime};base64,{base64.b64encode(picture).decode()}"
    prompt = render.build_prompt("Mars", "a test site", [render.ConceptModule(type="habitat")], "one small dome", has_view=True)
    edited, edited_mime = await render._imagine("/images/edits", {"prompt": prompt, "image": {"url": data_url, "type": "image_url"}})
    (OUT / f"smoke-2-edited.{render.EXTENSIONS.get(edited_mime, 'jpg')}").write_bytes(edited)
    return f"{settings.XAI_IMAGE_MODEL}: text-to-image {len(picture)} bytes, image edit {len(edited)} bytes (look at {OUT}/smoke-*)"


async def check_voice() -> str:
    said = "Drive the rover to site two."
    mp3 = await voice.speak(said)
    assert len(mp3) > 2000, f"speech is only {len(mp3)} bytes"
    (OUT / "smoke-3-speech.mp3").write_bytes(mp3)
    heard = await voice.transcribe(mp3, "audio/mpeg")
    assert "site" in heard.lower(), f"spoke {said!r} but heard {heard!r}"
    result = f"text-to-speech {len(mp3)} bytes, speech-to-text heard {heard!r}"
    if shutil.which("ffmpeg"):  # Chrome's microphone recordings are WebM/Opus: check that container too
        webm = subprocess.run(
            ["ffmpeg", "-loglevel", "error", "-i", "pipe:0", "-c:a", "libopus", "-f", "webm", "pipe:1"],
            input=mp3, capture_output=True, check=True,
        ).stdout
        direct = await voice._stt(webm, "audio/webm")
        via = "accepted as is" if direct.is_success else f"refused ({direct.status_code}), WAV fallback"
        heard_webm = await voice.transcribe(webm, "audio/webm")
        assert "site" in heard_webm.lower(), f"WebM: heard {heard_webm!r}"
        result += f"; browser WebM {via}, heard {heard_webm!r}"
    return result


async def check_reachable() -> None:
    """No key: send each request in its real shape with a bad key. xAI checks the shape first, so
    "key rejected" means the endpoint exists and accepts our request format; 404 or 422 means it does not."""
    pixel = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=="
    image = {"model": settings.XAI_IMAGE_MODEL, "response_format": "b64_json", "prompt": "test"}
    requests = {
        "/chat/completions": {"json": {"model": settings.XAI_TEXT_MODEL, "messages": [{"role": "user", "content": "hi"}], "response_format": {"type": "json_object"}}},
        "/images/generations": {"json": {**image, "aspect_ratio": "3:2"}},
        "/images/edits": {"json": {**image, "image": {"url": pixel, "type": "image_url"}}},
        "/tts": {"json": {"text": "hi", "voice_id": settings.XAI_VOICE_ID, "language": "en"}},
        "/stt": {"data": {"model": settings.XAI_STT_MODEL}, "files": {"file": ("speech.webm", b"0000", "audio/webm")}},
    }
    async with httpx.AsyncClient(timeout=30) as client:
        for path, body in requests.items():
            try:
                response = await client.post(f"{settings.XAI_BASE_URL}{path}", headers={"Authorization": "Bearer not-a-key"}, **body)
                verdict = "request shape accepted, key rejected (as expected)" if xai.is_key_error(response) else f"UNEXPECTED: {xai.error_text(response)}"
                print(f"  {path:20} HTTP {response.status_code}: {verdict}")
            except httpx.HTTPError as err:
                print(f"  {path:20} unreachable: {type(err).__name__}")


async def main() -> int:
    if not settings.XAI_API_KEY:
        print(f"NO KEY: {xai.NO_KEY_MESSAGE}. Checking only that the xAI endpoints exist:")
        await check_reachable()
        return 2
    failed = 0
    for name, check in (("Grok text (chat /intent)", check_text), ("Grok Imagine (/concept)", check_image), ("Grok Voice (/voice/*)", check_voice)):
        try:
            print(f"PASS  {name}: {await check()}")
        except Exception as err:  # every failure is reported, then the next API is still checked
            failed += 1
            print(f"FAIL  {name}: {explain(err)}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))

"""Grok Voice, the simple route (docs/backend.md): the browser records one utterance, POST /voice/transcribe turns it
into text with xAI speech-to-text, the chat runs it like typed text, and POST /voice/speak reads the reply aloud
with xAI text-to-speech. Endpoints checked against docs.x.ai (audio/speech-to-text, audio/text-to-speech).
"""

import asyncio
import shutil

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field

import settings
import xai

router = APIRouter(dependencies=[Depends(xai.require_team_code)])
MAX_AUDIO_BYTES = 10_000_000  # about ten minutes of browser Opus; an utterance is a few seconds
FILE_NAMES = {"webm": "speech.webm", "ogg": "speech.ogg", "wav": "speech.wav", "mpeg": "speech.mp3", "mp4": "speech.m4a"}


async def _stt(audio: bytes, content_type: str) -> httpx.Response:
    kind = next((k for k in FILE_NAMES if k in content_type), "webm")
    async with httpx.AsyncClient(timeout=60) as client:
        # httpx writes `data` fields before `files`, and xAI requires the file to be the last form field.
        return await client.post(
            f"{settings.XAI_BASE_URL}/stt",
            headers=xai.auth_headers(),
            data={"model": settings.XAI_STT_MODEL},
            files={"file": (FILE_NAMES[kind], audio, content_type or "audio/webm")},
        )


async def _to_wav(audio: bytes) -> bytes | None:
    """16 kHz mono WAV through ffmpeg, or None when ffmpeg is missing or cannot read the audio."""
    if not shutil.which("ffmpeg"):
        return None
    process = await asyncio.create_subprocess_exec(
        "ffmpeg", "-loglevel", "error", "-i", "pipe:0", "-ac", "1", "-ar", "16000", "-f", "wav", "pipe:1",
        stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
    )
    wav, _ = await process.communicate(audio)
    return wav if process.returncode == 0 and wav else None


async def transcribe(audio: bytes, content_type: str) -> str:
    """Speech to text with Grok Voice. Raises httpx.HTTPStatusError when xAI refuses."""
    response = await _stt(audio, content_type)
    # The docs list WAV, MP3, OGG and more, and only imply WebM (what Chrome records). If xAI refuses the
    # container, send the same audio again as WAV.
    if response.status_code in (400, 415) and "wav" not in content_type:
        wav = await _to_wav(audio)
        if wav:
            response = await _stt(wav, "audio/wav")
    response.raise_for_status()
    return str(response.json().get("text", "")).strip()


async def speak(text: str) -> bytes:
    """Text to speech with Grok Voice. Returns MP3 bytes."""
    async with httpx.AsyncClient(timeout=60) as client:
        response = await client.post(
            f"{settings.XAI_BASE_URL}/tts",
            headers=xai.auth_headers(),
            json={"text": text, "voice_id": settings.XAI_VOICE_ID, "language": "en"},
        )
        response.raise_for_status()
        return response.content


@router.post("/voice/transcribe")
async def voice_transcribe(request: Request):
    """Body: the recorded audio itself (Content-Type audio/webm, audio/ogg, audio/wav ...). Returns { text }."""
    xai.auth_headers()
    audio = await request.body()
    if not audio:
        raise HTTPException(422, "empty audio")
    if len(audio) > MAX_AUDIO_BYTES:
        raise HTTPException(413, "recording too long")
    try:
        return {"text": await transcribe(audio, request.headers.get("content-type", "audio/webm"))}
    except httpx.HTTPError as err:
        raise xai.upstream_error(err, "Grok Voice (speech to text)") from err


class SpeakRequest(BaseModel):
    text: str = Field(min_length=1, max_length=1200)


@router.post("/voice/speak")
async def voice_speak(request: SpeakRequest):
    try:
        return Response(await speak(request.text), media_type="audio/mpeg")
    except httpx.HTTPError as err:
        raise xai.upstream_error(err, "Grok Voice (text to speech)") from err

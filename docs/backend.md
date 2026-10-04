# Backend: FastAPI query service

Code owner: Claire. Runs on Matus's laptop (RTX 5070) during development and the demo. Location: `apps/backend/`.

The backend keeps API keys off the browser, encodes text for semantic search, turns natural language into intents and layer queries with Grok, and serves scene bundles. All training happens on Colab; the laptop only runs inference.

## Is the RTX 5070 fast enough?

Yes, for everything the backend does:
- Text encoding with OpenCLIP ViT-B-16: milliseconds.
- Decoding 256 cluster centroids once at startup: trivial.
- Layer filters over a few million Gaussians with numpy: tens of milliseconds.
- Grok calls are network-bound.

## Setup on the RTX 5070 (Blackwell, sm_120)

Blackwell GPUs need CUDA 12.8 or newer and a recent PyTorch build. Older PyTorch wheels fail with "sm_120 is not compatible."

```bash
python3.11 -m venv .venv && source .venv/bin/activate     # Windows: .venv\Scripts\activate
pip install --upgrade pip
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu128
python -c "import torch; print(torch.__version__, torch.cuda.is_available(), torch.cuda.get_device_name(0))"
pip install fastapi uvicorn[standard] open_clip_torch numpy httpx python-dotenv pydantic
```

If `cuda.is_available()` is False or kernels fail, use a newer (or nightly) cu128 build. CPU fallback works too; everything here is light.

## Layout

```
apps/backend/
  main.py              FastAPI app, CORS for the web app origin
  settings.py          env vars: XAI_API_KEY, SCENES_DIR, ALLOWED_ORIGINS
  scenes.py            loads bundles: layers.bin into numpy, clusters, pins
  clipmodel.py         OpenCLIP text encoder + autoencoder decoder
  query.py             filters + semantic relevancy over layers
  intents.py           Grok call: text to one intent (contracts.md section 9)
  render.py            Grok Imagine image edit
  voice.py             Grok Voice: speech to text, text to speech
  xai.py               key check and xAI error messages
  smoke_grok.py        one real call per xAI API, PASS or FAIL
  models/ae_decoder.pt from Colab
```

## Endpoints

### `POST /intent`

Body: `{ "text": str, "scene_id": str, "context": { "selected_module_id"?: int, "pins": [names] } }`

Calls a Grok text model with a system prompt that lists the allowed intents and their argument schemas (`contracts.md` section 9) and requires a single JSON object back. Validate with pydantic; on failure, retry once, then return `{ "intent": "query_scene", "args": { "text": <original text> } }`.

### `POST /query`

Body: `{ "scene_id": str, "text"?: str, "filters"?: { field: [min, max] }, "near_pin"?: str, "within_m"?: float }`

1. Start with all Gaussians.
2. Apply numeric filters on decoded layer arrays (for example `slope_deg <= 5`, `mineral.carbonate >= 0.5`, `terrain_class.bedrock >= 0.5`).
3. Apply `near_pin` and `within_m` using pin positions.
4. If `text` is given: encode with OpenCLIP, normalize; score each decoded cluster centroid with a LangSplat-style relevancy against canonical negatives ("object", "things", "stuff", "texture"); keep clusters above a threshold; intersect with the filter result.
5. Return `{ "cluster_ids": [...], "gaussian_mask_rle": "...", "explanation": "slope <= 5 deg AND bedrock AND near Cheyava Falls (50 m) AND visual: 'veined'" }`. Run-length encode the boolean mask over Gaussian indices.

### `POST /concept` (Grok Imagine, `render.py`)

Body: `{ "scene_id": str, "prompt"?: str, "image"?: "data:image/jpeg;base64,...", "modules"?: [{ "type", "x", "y" }] }`

`image` is the viewer's current 3D view; `prompt` is the user's own words for the base idea. The backend builds the full prompt from the scene's `scene.json` (body, title) and the module types, sends the view to the xAI image edit endpoint, saves the result and the view under `apps/backend/renders/`, and returns `{ id, scene_id, created_at, model, mode, note, prompt, idea, image_url, view_url }`. `image_url` and `view_url` are paths on the backend (`/renders/...`). `mode` is `"edit"` (made from the view) or `"generate"` (text-to-image, used only when no view was sent or xAI refuses the edit; `note` then says so). `GET /concepts?scene_id=` lists the last eight, newest first.

The request shape xAI accepts (checked against the live API on 2026-10-04; a bare string for `image` is rejected with 422):

```python
await client.post(
    "https://api.x.ai/v1/images/edits",
    headers={"Authorization": f"Bearer {key}"},
    json={"model": "grok-imagine-image-2.0", "prompt": prompt, "response_format": "b64_json",
          "image": {"url": image_data_uri, "type": "image_url"}},
)   # -> {"data": [{"b64_json": "...", "mime_type": "image/jpeg"}]}
```

xAI requires `application/json`; the OpenAI SDK's `images.edit()` (multipart) is not supported. Reference: https://docs.x.ai/developers/model-capabilities/images/editing. Without a key every Grok endpoint returns 503 naming `XAI_API_KEY`; a wrong key comes back from xAI as HTTP 400 "Incorrect API key provided".

### Voice (Grok Voice, `voice.py`)

The simple route is built: the browser records one utterance and the chat treats the transcript like typed text.

- `POST /voice/transcribe`: the body is the recorded audio itself (`Content-Type: audio/webm`, `audio/ogg`, `audio/wav` ...). Calls `POST https://api.x.ai/v1/stt` (multipart, `model=grok-voice-transcribe-2.0`, the `file` field last) and returns `{ "text": str }`. If xAI refuses the container and `ffmpeg` is installed, the audio is sent again as WAV.
- `POST /voice/speak`: body `{ "text": str }`. Calls `POST https://api.x.ai/v1/tts` (`{ text, voice_id, language }`) and returns MP3 audio.
- Not built: the realtime Grok Voice Agent (`wss://api.x.ai/v1/realtime`) with the intents as tools. See https://docs.x.ai/developers/model-capabilities/audio/speech-to-speech.

`apps/backend/smoke_grok.py` makes one real call to each of the three APIs (text, Imagine, Voice) and prints PASS or FAIL.

### `GET /scenes/{scene_id}/{path}`

Serves bundle files from `SCENES_DIR` with correct content types and HTTP range support (large files).

## Deploying to Vercel (one URL for teammates and judges)

`scripts/deploy_vercel.sh` builds a self-contained Vercel project in `.vercel-stage/` and uploads nothing unless asked:

```bash
scripts/deploy_vercel.sh            # dry run: build and check everything, upload nothing
scripts/deploy_vercel.sh --serve    # dry run, then serve the result on http://localhost:8100 (local stand-in)
npx vercel login                    # once, yourself
scripts/deploy_vercel.sh --deploy   # sets XAI_API_KEY and TEAM_CODE on Vercel (piped, never printed) and deploys
```

- Static files: the viewer built with `VITE_SAME_ORIGIN=1` and the scenes `mars-hero-01` and `moon-malapert-01`.
- One Python function, `apps/backend/vercel_app.py`, for `/api/intent`, `/api/concept`, `/api/voice/transcribe`, `/api/voice/speak` and `/api/health`. It has no disk, so a concept render comes back as a data URL and the gallery lives in the browser.
- Every Grok route needs the team passcode (`TEAM_CODE` on the server, the `X-Team-Code` header from the browser). With no `TEAM_CODE` the deployed routes stay closed; local dev with no `TEAM_CODE` stays open.
- `/query` is not deployed (it needs CLIP on a GPU). The script asks the local backend for the phrases in `deploy/vercel/search_phrases.txt` and ships the answers as `/search/<scene>.json`; the deployed search box offers exactly those.

## Running for the demo

```bash
uvicorn main:app --host 0.0.0.0 --port 8000
```

Teammates on the same network reach it at `http://<laptop-ip>:8000`. If venue wifi blocks peer traffic, use a tunnel (for example Cloudflare Tunnel) and put the URL in the web app's `VITE_BACKEND_URL`. Keep a local-only mode where the laptop runs both backend and web app, as the demo fallback.

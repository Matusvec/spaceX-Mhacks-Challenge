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

### `POST /render`

Body: `{ "image_base64": "data:image/jpeg;base64,...", "prompt": str }`

Calls the xAI image edit endpoint and returns `{ "image_url": str }`.

```python
import httpx, os

async def grok_edit(image_data_uri: str, prompt: str) -> str:
    async with httpx.AsyncClient(timeout=120) as client:
        r = await client.post(
            "https://api.x.ai/v1/images/edits",
            headers={"Authorization": f"Bearer {os.environ['XAI_API_KEY']}"},
            json={"model": "grok-imagine-image-2.0", "prompt": prompt, "image": image_data_uri},
        )
        r.raise_for_status()
        return r.json()["data"][0]["url"]   # check the response shape against the docs
```

xAI requires `application/json`; the OpenAI SDK's `images.edit()` (multipart) is not supported. Confirm the request and response field names against https://docs.x.ai/developers/model-capabilities/images/editing before relying on them.

### Voice

Grok Voice (SpaceXAI track requirement, together with Imagine). Two acceptable routes:
- **Simplest:** the browser records a short utterance, the backend transcribes it with Grok Voice, then runs `/intent` on the text.
- **Realtime:** a Grok Voice Agent session with the intents exposed as tools. See https://docs.x.ai/developers/models/voice-agent-api. Implement only if the simple route works first.

### `GET /scenes/{scene_id}/{path}`

Serves bundle files from `SCENES_DIR` with correct content types and HTTP range support (large files).

## Running for the demo

```bash
uvicorn main:app --host 0.0.0.0 --port 8000
```

Teammates on the same network reach it at `http://<laptop-ip>:8000`. If venue wifi blocks peer traffic, use a tunnel (for example Cloudflare Tunnel) and put the URL in the web app's `VITE_BACKEND_URL`. Keep a local-only mode where the laptop runs both backend and web app, as the demo fallback.

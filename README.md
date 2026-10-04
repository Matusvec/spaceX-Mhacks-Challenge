# Planetary Scene Studio

Figma for planetary surfaces. A shared, live 3D workspace where a team stands inside a real place on Mars or the Moon, reads the science embedded in the ground, and designs where humans could build.

Built at MHacks 2026 (Oct 3 to 4, Ann Arbor) by Matus Vecera, Claire Huang, and Humyra Ferdus, members of the Notre Dame Data Club.

## What it does

1. **Real places, rebuilt in 3D.** Mars: a Gaussian splat trained on real Perseverance (or Curiosity) rover images of a distinctive formation, placed on 1 m HiRISE terrain. Moon: Malapert Massif, an Artemis III candidate region, from NASA LOLA 5 m terrain with LRO imagery draped on it.
2. **Science embedded in the scene.** Every Gaussian carries layers: geometry (slope, roughness, elevation), terrain class from a model we train on NASA's AI4Mars dataset, orbital mineralogy, rover-measured chemistry at named targets, and visual semantics (SAM + CLIP features lifted onto the splat, compressed by an autoencoder).
3. **Ask the scene questions.** "Flat bedrock near the sample site with high carbonate" lights up the matching Gaussians. Grok turns the question into a combined query over the layers.
4. **Design a base, live, together.** Place habitats, greenhouse domes, landing pads, and solar fields by voice or by hand. Each placement gets a live scorecard (slope, leveling volume, distance to science, rover access; on the Moon also sunlight, Earth visibility, and a radiation estimate). Grok Imagine renders a photoreal concept from the current view.
5. **Multiplayer.** Cursors, pins, highlights, and placed modules sync live through Spacetime.
6. **Reachable from a phone.** A Relay agent answers by text with renders and scorecards as rich cards, and can fly you through a site on a video call.

## Repo layout

```
planetary-scene-studio/
  README.md               this file
  AGENTS.md               rules for Cursor and other coding agents
  docs/
    contracts.md          shared formats: scene bundle, per-Gaussian layers, frames, APIs, schemas
    data-sources.md       every dataset, where it lives, how to pick the Mars site
    splat-pipeline.md     rover images to a trained, compressed, placed splat (Colab)
    semantic-layers.md    building every per-Gaussian layer, including the trained models
    moon-scene.md         Malapert terrain, sunlight, Earth visibility, radiation simulator
    viewer-and-editing.md the React + three.js + Spark web app, layers, base design, scoring
    backend.md            FastAPI query service on the RTX 5070 laptop, Grok calls
    multiplayer.md        Spacetime module and client
    relay-agent.md        the Relay agent
    team-and-timeline.md  who works on what, checkpoints, tiers, cut order, prize checklist
  apps/
    web/                  React + Vite + three.js + Spark (Claire)
    backend/              FastAPI service (Claire writes, runs on Matus's laptop)
    relay/                Relay agent, TypeScript (Humyra)
  spacetime/              Spacetime TypeScript module (Humyra)
  pipelines/
    colab/                training and lifting notebooks (Matus)
    moon/                 Moon physics scripts (Matus)
    data/                 download and curation scripts
  scenes/                 built scene bundles (gitignored; large files live on Drive)
```

## Where compute runs

| Where | What |
|---|---|
| Google Colab Pro (A100 or H100) | All training: splats, AI4Mars segmentation model, autoencoder; SAM + CLIP feature extraction; feature lifting |
| Matus's laptop (RTX 5070) | The FastAPI backend during the demo: text encoding, layer queries, Grok calls; Moon physics precompute |
| Browser | Rendering, editing, base scoring (instant, client-side) |

## Things to verify in the first hours

These are known unknowns. Each doc says how to check them.

- Whether the chosen Mars stop falls inside the 1 m HiRISE terrain model (see `data-sources.md`).
- Whether the raw-image camera models are consistent across drives, or need per-drive localization (see `splat-pipeline.md`).
- Whether the splat compressor preserves Gaussian order, since per-Gaussian layers are stored by index (see `contracts.md`).
- Whether Spark can recolor individual splats for layer display, or the fallback overlay is needed (see `viewer-and-editing.md`).
- PyTorch with CUDA 12.8 working on the RTX 5070 (see `backend.md`).

## Quick start

1. Read `docs/contracts.md` first. Every part of the system meets at those formats.
2. Then read the doc for your area (`docs/team-and-timeline.md` says who owns what).
3. Keys go in `.env` files that are never committed: `XAI_API_KEY`, `RELAY_AGENT_TOKEN`, `FETCH_*`, `ELEVENLABS_API_KEY`.

# Rules for coding agents (Cursor)

Read `docs/contracts.md` before writing any code. All components meet at those formats; do not invent new ones.

## General

- This is a 24-hour hackathon build. Prefer the simplest thing that works and is demo-reliable.
- Keep custom code in separate, small files by responsibility. No 1,000-line files.
- Never commit secrets. Read keys from environment variables. Never call the xAI API directly from the browser; go through `apps/backend`.
- Never fabricate scientific values. Chemistry, mineralogy, and radiation numbers must come from a cited source listed in `docs/data-sources.md`, or be labeled clearly as an estimate in the UI.
- Every science layer shown in the UI must display its resolution and source (for example "orbital, ~18 m/px, CRISM" or "rover measurement, this target").
- Units: meters, degrees, SI. Frames are defined in `docs/contracts.md`; convert at the boundary, never mid-pipeline.

## Stack

- Web: React + Vite + TypeScript, plain three.js for the canvas, Spark for Gaussian splats. Not React Three Fiber.
- Backend: Python 3.11, FastAPI, PyTorch with CUDA 12.8 (RTX 5070 is Blackwell, sm_120).
- Training: Colab notebooks in `pipelines/colab/`, gsplat with the MCMC strategy.
- Multiplayer: SpacetimeDB TypeScript module in `spacetime/`, generated client bindings used by `apps/web` and `apps/relay`.
- Relay agent: TypeScript, Relay SDK, in `apps/relay/`.

## Colab notebooks

- Mount Google Drive. Write checkpoints and logs to Drive, never only to the runtime disk.
- Every notebook must be resumable: skip finished steps, resume from the latest checkpoint.
- Log loss and metrics to a CSV on Drive so progress can be checked from any laptop.

## Definition of done for any feature

It works in the running app on real data (or the agreed fallback), on two browsers at once if it touches shared state, and it does not break the Tier 1 demo path in `docs/team-and-timeline.md`.

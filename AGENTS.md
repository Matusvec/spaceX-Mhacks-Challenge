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
- Training: gsplat MCMC on a Colab GPU, started from `pipelines/colab/launch.sh`. Read `docs/colab-cli.md` before touching a runtime.
- Multiplayer: SpacetimeDB TypeScript module in `spacetime/`, generated client bindings used by `apps/web` and `apps/relay`.
- Relay agent: TypeScript, Relay SDK, in `apps/relay/`.

## Colab, from the command line

Agents train with `pipelines/colab/launch.sh`. The Colab website is not part of the loop.

Do not run `colab auth`, `colab drivemount`, `colab repl`, or an unpiped `colab console`. Those wait on a person and the shell will hang.

Do not start login, and do not ask the user to paste an authorization code into chat. If neither `~/.config/colab-cli/token.json` nor `~/.config/gcloud/application_default_credentials.json` exists, stop and tell them to run the scoped `gcloud auth application-default login` in `docs/colab-cli.md` in their own terminal. After one of those files exists, `launch.sh` can open a GPU, upload a COLMAP tree, train, and download checkpoints.

- Checkpoints and the CSV go to Google Drive when `/content/drive` is already mounted. Agents never mount it. `launch.sh pull` also copies them onto this machine, so a finished run is not left only on the VM disk.
- Resume from the latest checkpoint in the result dir. Skip a run whose CSV already shows the target step count.
- Log loss to `logs/<run>.csv` (step, loss). When Drive is mounted, the same file is copied there.

## Definition of done for any feature

It works in the running app on real data (or the agreed fallback), on two browsers at once if it touches shared state, and it does not break the Tier 1 demo path in `docs/team-and-timeline.md`.

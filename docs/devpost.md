# Devpost submission draft

Paste-ready copy for Planetary Scene Studio. Tone: confident, specific, not grandiose. Every claim below maps to something in this repo.

---

## Title

**Planetary Scene Studio**

## Tagline (≤120 chars)

Stand inside real Mars and Moon sites, ask the ground questions, and design a base together — live.

*(alt, Spacetime-forward:)* A shared 3D ops room on real NASA terrain — Gaussian science layers, live Spacetime sync, Grok as co-pilot.

---

## Elevator (1–2 sentences for the top of the page)

Planetary Scene Studio is a multiplayer workspace where a team stands inside a real place on Mars or the Moon — rebuilt from NASA rover imagery and orbital data — reads science embedded in the ground, and designs where humans could build. SpacetimeDB is the shared session; Grok turns natural language and concept renders into actions; the scene itself is the interface.

---

## Inspiration

NASA already flies the sensors. Perseverance photographs Cheyava Falls — a rock with a potential biosignature story — from meters away. HiRISE maps Jezero at a meter. LOLA and LRO map Artemis candidate ridges like Malapert. What teams lack is a place to *work together inside that data*: not a slide deck of maps, not a solitary CAD file, but a live scene where science, reachability, and habitat layout share one coordinate frame.

We built that in one night at MHacks: a frontier ops room you can open in a browser, on two laptops at once, with the same pins, rover drives, and modules for everyone.

---

## What it does

1. **Real places, reconstructed.** Mars: a Gaussian splat trained on real Perseverance imagery of the Cheyava Falls workspace, registered onto ~1 m HiRISE terrain. Moon: Malapert Massif (Artemis III–relevant), from LOLA 5 m terrain with LRO imagery — plus illumination, Earth visibility, and a labeled radiation *estimate*.
2. **Science in the Gaussians.** Per-Gaussian layers for geometry (slope, roughness, elevation), terrain class (model trained on NASA AI4Mars), orbital mineralogy where cited, rover chemistry at named targets, and visual-semantic features for “find light-toned layered rock” style queries. Every layer shows resolution and source in the UI.
3. **Ask the scene.** Natural-language intents (local reader or Grok) become layer queries, pins, rover drives, and site advice — with citations, not invented numbers.
4. **Design a base, scored live.** Habitats, greenhouse domes, landing pads, solar fields: place and drag; get slope, leveling, science distance, rover access (Moon: sunlight, Earth view, shielding). Grok Imagine turns the current 3D view into a photoreal concept — labeled as AI concept, not data.
5. **Multiplayer that is the product.** SpacetimeDB holds presence, 3D cursors, pins, placed modules, and rover drive state. Two browsers, one session: drag a dome on one screen, watch the score update on the other. Offline falls back to local memory and reconnects.
6. **Gamified without being toy.** Rover A\* over a slope-limited grid, drive animation, shared pins and chat (“drive to pin 2”), org sign-in for scene access — the loop of explore → query → place → score → iterate with your team.

---

## How we built it (technical story for judges)

| Layer | Stack |
|---|---|
| Viewer | React + Vite + TypeScript, plain three.js, Spark for Gaussian splats |
| Shared state | SpacetimeDB TypeScript module (`spacetime/`): tables + reducers only; generated client bindings in `apps/web` |
| Intelligence | FastAPI backend: Grok for intent, Imagine concept renders, Voice STT/TTS; schema-validated fallbacks |
| Scenes / ML | Colab + gsplat (MCMC), CAHV→COLMAP from rover camera models, stereo seeding, per-Gaussian layer export; AI4Mars segmentation; Moon physics scripts |
| Contracts | One scene-bundle format and one `site` frame (meters) for viewer, scoring, Spacetime, and agents — convert at the boundary, never mid-pipeline |

**SpacetimeDB is not a chat bolt-on.** Shared session state — who is in the scene, where they look, pins, modules, rover — lives in tables; reducers are the only writers. The demo moment is two clients on `pss-studio-mhacks` (or local) moving the same base.

**SpaceXAI / Cursor angle (honest):** the codebase was built with Cursor agents and humans in parallel overnight; Grok Imagine and Voice are wired and smoke-tested against real xAI APIs; inputs are public NASA/USGS data with sources listed in `docs/data-sources.md`.

---

## Built with (sponsor tags — one line each)

- **SpacetimeDB** — core real-time backend for multiplayer scenes (users, cursors, pins, modules, rover).
- **Cursor** — primary coding environment; agents + humans shipped viewer, backend, pipelines, and module overnight.
- **xAI / Grok** — intent parsing, Imagine concept renders from the live camera view, Voice in/out.
- **NASA / USGS public data** — Perseverance raw images + CAHVORE models, HiRISE DTMs, CRISM/mineral maps where cited, AI4Mars, LOLA/LRO for Moon.
- **gsplat / Gaussian splatting** — Mars hero splat trained and compressed into the scene bundle.
- **React, three.js, Spark** — browser viewer and splat rendering.
- **FastAPI + PyTorch** — query/render/voice service.
- **Figma** — UI process before/alongside implementation (design prize path).
- **Relay** *(if demoed)* — phone agent over the same Spacetime scene state.
- **Vercel** *(if deployed)* — backend/deploy path under `deploy/vercel/`.

---

## Challenges we ran into

- **Splat quality from sparse rover viewpoints.** Cameras cluster at a few stops; novel orbits showed spikes until we fixed stereo alignment (Mastcam-Z L/R), exposure/white balance, needle penalties, and dataset curation — and judged by looking at novel views, not only held-out PSNR.
- **Science honesty under time pressure.** Easy to fake pretty overlays. We required cited pins, resolution labels on every layer, and clear “estimate” / “AI concept, not data” labels for radiation and Imagine.
- **One night, three owners, one contract.** Viewer, ML pipelines, and Spacetime had to meet at `docs/contracts.md` (frames, bundle layout, score JSON) so integration was copy-path, not rewrite.
- **Venue networking.** Laptop-to-laptop Spacetime can die on wifi; we published to Spacetime’s hosted cloud and kept an offline optimistic client.

---

## Accomplishments that we're proud of

- A **real Cheyava Falls–area splat** on HiRISE terrain in the browser, with per-Gaussian layers and ~60 fps at ~1M Gaussians in testing — not a stock HDRI “Mars.”
- **Spacetime as the shared ops layer**, proven with a two-client automated check (pins, cursor, rover drive, modules).
- **End-to-end Grok path**: chat intents, Imagine from a captured Mars view (terrain/angle preserved, habitats added), Voice wired — SpaceXAI-shaped, not a screenshot of a chatbot.
- **Moon site with engineering-relevant rasters** (illumination, Earth visibility, slope, dose estimate) next to the Mars science story — same app, same multiplayer model.
- Shipping a **contracts-first** architecture so agents and humans could work in parallel without inventing formats.

---

## What we learned

- Immersion for planetary science is less about photorealism everywhere and more about **registered truth**: meters, sources, and a shared frame teammates trust.
- Gaussian splats are a bridge between rover photography and interactive 3D — but only if the pipeline respects camera models and fails loudly when stops don’t register.
- Real-time multiplayer for design tools wants a **database with reducers**, not ad-hoc WebSockets: SpacetimeDB matched that model.
- Judges and scientists share one need: **label the uncertainty**. Pretty layers without resolution destroy trust.

---

## What's next

- Tighter visual-semantic search and more cited chemistry pins.
- Relay video fly-through and Fetch.ai agent discovery (Tier 3).
- Hardening hosted Spacetime org/scene access for classroom and mission-ops style rooms.
- Broader sites once the bundle pipeline is push-button.

---

# Rubric map (use while editing — don’t paste this block unless useful)

### Innovation
- Shared *immersive* workspace on **real** mission sites (Cheyava / Malapert), not generic planet art.
- Science query + base scoring + multiplayer in one loop; Grok as co-pilot over the same scene state.
- Problem: collaborative site selection / habitat ideation with cited data — still awkward today.

### Technical complexity
- Full stack: COLMAP-style reconstruction from CAHV, gsplat training, per-Gaussian layers, AI4Mars, Moon physics rasters, Spark viewer, FastAPI+Grok, Spacetime module with accounts/scenes/rover.
- Contracts, frames, and offline/reconnect behavior show engineering maturity for a hackathon.

### Usability
- Browser-first canvas; scene switcher; layer legends with source/resolution; chat + voice; shared session panel; org sign-in; scorecards on place/drag.
- Concept renders and rover drives make the tool feel playable without hiding that numbers are scientific or estimated.

### Adherence to theme (SpaceXAI / space + Cursor + Grok + real data)
- Built with Cursor; uses Grok Imagine + Voice; NASA/USGS inputs; planning/design for human presence beyond Earth (bases + science access), with SpacetimeDB as the live collaboration spine.

---

## Demo script (90 seconds)

1. **Mars open** — “This is Cheyava Falls from Perseverance images on HiRISE terrain. ~N Gaussians, cited sources.”
2. **Layer** — toggle slope / terrain class; point at legend: resolution + source.
3. **Query / chat** — “flat bedrock near the sample” or drive rover to a pin; show path.
4. **Second laptop** — teammate places greenhouse; score updates live (**SpacetimeDB**).
5. **Concept** — capture view → Grok Imagine habitats; say out loud: “AI concept, not telemetry.”
6. **Moon flip** — Malapert; illumination / Earth visibility; one shielding note as estimate.
7. **Close** — “Ops room for frontier sites: real data, shared state, design under constraints.”

---

## Honest limits (say these if asked; builds trust)

- Mineralogy is orbital-scale where used; never per-rock unless from a cited rover target pin.
- Radiation on the Moon is a **simulator estimate**, labeled in UI.
- Splat quality is best near well-imaged stops; novel orbits still show soft/gap regions — we iterated on that overnight and document it.
- “Figma for planets” is a shorthand for collaborative editing — the product is an **ops + science workspace**, not a drawing tool.

---

## Short social / Discord blurb

We built Planetary Scene Studio in one night: stand inside real NASA Mars/Moon sites (Gaussian splat + orbital terrain), query science layers, design a scored base with your team on SpacetimeDB, and use Grok for voice, intents, and Imagine concepts. Not planet wallpaper — a shared frontier ops room.

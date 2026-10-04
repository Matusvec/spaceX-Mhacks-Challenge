# Planetary Scene Studio: Devpost draft

Live: https://planetary-scene-studio.vercel.app (needs an access code; give judges the mission-control one)
Repo: https://github.com/Matusvec/spaceX-Mhacks-Challenge

Every number below is from our own bundle or a cited source. Lines marked TEAM are for a teammate to fill in.

## Inspiration

From orbit, the best pictures of Mars are 25 cm per pixel and the best elevation model is 1 m per pixel. A 30 cm rock is one pixel. Yet a rock that size decides whether a wheel, a landing leg or a habitat foundation works. NASA's rovers have photographed some places from the ground at millimetres per pixel, and those photos are public. We wanted one tool where a mission team picks a site from orbit, then stands on the real ground to plan it, together.

## What it does

- **Two real places.** Cheyava Falls in Jezero Crater, Mars (the rock NASA announced in September 2025 as a potential biosignature), and the Malapert Massif plateau near the lunar south pole.
- **A photoreal ground site on orbital terrain.** A Gaussian splat of 972,047 Gaussians, trained from 241 Perseverance photos, sits on a 2 km HiRISE terrain in the same metric frame. Inside the 18 m splat, orbit has 270 height samples.
- **The splat is data, not a picture.** Every Gaussian carries layers: terrain class from a model we trained on AI4Mars, roughness, height above the orbital model, and a visual cluster for text search ("sand ripples").
- **Science you can cite.** The Cheyava Falls pin has 15 findings quoted from the Nature paper and NASA releases. Orbital mineral maps (CRISM) are shown only where they have data.
- **Plan a base.** A suitability map grades the terrain; place habitats, domes and pads and get a scorecard.
- **Drive a rover.** A six-wheel rocker-bogie rover follows the ground, including the splat's own rocks. Double-click anywhere, or tell it in chat or by voice. Fly the camera, follow the rover, or look through its mast camera.
- **Imagine the base with Grok.** Describe an idea; we send your current 3D view to Grok Imagine and it paints the base onto that exact terrain and camera angle. Swipe between the real view and the concept.
- **Talk to it.** Chat and voice go through Grok to a fixed set of actions; replies about science come only from cited data.
- **Do it together.** One access code on the landing page signs you in to your organisation; you see only your scenes, and who is live in each. Cursors, pins, modules, rover drives, a team chat and each other's concept renders sync live through SpacetimeDB.
- **Moon physics.** Illumination and Earth visibility computed from LOLA terrain and JPL ephemerides, a radiation dose estimate, and a regolith shielding slider built on published values (the curve is not monotonic, and we show that).

## How we built it

- **Splat pipeline (Python).** We did not use structure-from-motion. Rover images ship with JPL camera models (CAHVORE); we undistort them, take metric poses from rover telemetry, register three rover stops to each other to within 2 pixels, and train with gsplat (MCMC) on a Colab A100. Every candidate was judged by rendering new viewpoints and looking at them, not by a metric.
- **Semantic layers.** A SegFormer model trained on AI4Mars labels terrain in each rover photo; SAM regions embedded with CLIP give the search clusters. Both are lifted onto the Gaussians.
- **Viewer.** React, TypeScript, plain three.js, Spark for the splat.
- **Grok.** Imagine image-edit API on the captured view, Voice API for speech-to-text and text-to-speech, text API for chat intents. Keys stay on the server.
- **SpacetimeDB.** One TypeScript module holds presence, pins, modules, rover state, team chat, shared concept renders (the pictures live in rows), organisations and scene access; reducers enforce who may touch which scene. There is no other database.
- **Hosting.** Static app and scenes on Vercel with one small function for the Grok calls; all 3D runs in the browser.
- TEAM: how Cursor and Grok Bot were used for planning and building.

## Challenges

- Rover cameras are fisheye and the two eyes of Mastcam-Z disagree by a few pixel rows; ignoring either ruins stereo.
- A splat that scored well on held-out photos showed spikes from new viewpoints. We found and fixed that only by looking.
- A rover sees about 10 m well. The limit is the data, not the method: the same pipeline turns any rover stop into a site.
- Honesty about what is measured. Estimates are labelled, layers show their source and resolution, and "no data" is never drawn as a low value.

## What we are proud of

- A metric, registered, searchable ground site built from public NASA photos overnight.
- A concept render that keeps the real terrain and viewpoint.
- A shared session where one person's rover drive plays on everyone's screen.

## Limits, stated plainly

- Text search separates rocks from the ground between them; it does not tell rock types apart.
- The orbital mineral maps do not cover the rover site, and show no carbonate detection.
- The splat has holes where no photo covers the ground, and is soft from closer than about 2 m.
- Sign-in is organisation membership by access code, not email login.

## What's next

More rover stops stitched along the traverse, email login through SpacetimeAuth, and Mastcam-Z multispectral layers.

## Built with

React, TypeScript, three.js, Spark, SpacetimeDB, FastAPI, xAI Grok (Imagine, Voice, text), gsplat, PyTorch, SegFormer, SAM, open_clip, Google Colab, Vercel. Data: NASA/JPL Mars 2020 raw images, USGS HiRISE DTM and orthomosaic, CRISM, LOLA, JPL DE421.

## Images for the gallery

- `docs/figures/shared_concept_swipe_live.png`: the live site; Ben (NASA) opens Ada's Grok Imagine concept, swiping between the real 3D scene and her render, with LIVE 2 and the team chat on the right. Use this one first.
- `docs/figures/landing_page.png`: the access-code landing page.
- `docs/figures/orbit_vs_splat.png`: the same 18 m disc from orbit and from our splat.
- `docs/figures/grok_imagine_view_vs_render.jpg`: our 3D view and Grok Imagine's concept on it.

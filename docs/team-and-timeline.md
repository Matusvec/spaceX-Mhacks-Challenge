# Team, timeline, and prize checklist

## Who works on what

Three areas, each owned end to end by one person. Everyone helps wherever things are stuck, and we rebalance at the 6 PM check-in.

| Area | Person | Owns |
|---|---|---|
| Scenes and ML | Matus | Mars site selection, splat pipeline (`splat-pipeline.md`), all semantic layers including the AI4Mars model and autoencoder (`semantic-layers.md`), Moon physics in training gaps (`moon-scene.md`), runs the backend on his laptop |
| App and intelligence | Claire | Web app: viewer, layers, terrain, base design and scoring, path planning, concept renders, voice (`viewer-and-editing.md`); backend code (`backend.md`) |
| Collaboration, Relay, story | Humyra | Spacetime module and client glue (`multiplayer.md`), the Relay agent (`relay-agent.md`), Figma design, curating pins and mineral data, Devpost and every sponsor submission |

The pitch is shared; we decide on Sunday morning who speaks, who drives, and who runs the second laptop.

## Tiers

**Tier 1, the demo must have these by midnight:**
- [ ] Mars scene in the viewer (splat on terrain, or the fallback)
- [ ] Geometry layer and slope overlay
- [ ] Place, drag, and score modules
- [ ] Multiplayer cursors, pins, and modules on two laptops
- [ ] One Grok Imagine concept render
- [ ] Moon terrain with the illumination map

**Tier 2:**
- [ ] AI4Mars terrain-class layer
- [ ] Pins with cited chemistry; mineral layer
- [ ] Visual-semantic search (lifted features, autoencoder, clusters)
- [ ] Voice to intents (Grok Voice)
- [ ] Earth in the sky and the Earth-visibility map
- [ ] Radiation estimate with the shielding slider
- [ ] Rover path planning
- [ ] Relay text agent with rich cards

**Tier 3:**
- [ ] Relay video-call fly-through
- [ ] Apollo photoreal splat
- [ ] Fetch.ai agents
- [ ] ElevenLabs narration
- [ ] Learned LangSplat-style features
- [ ] Mastcam-Z multispectral layer

**Cut order if behind at midnight:** Tier 3 entirely, then semantic search, then the radiation slider, then path planning. Never cut Tier 1.

## Checkpoints (Ann Arbor time)

| Time | Milestone |
|---|---|
| Sat 5:00 PM | Mars site chosen; images downloading; viewer loads a placeholder bundle; Spacetime cursors on two tabs; Relay agent replies "hello" |
| Sat 6:00 PM | First quick splat in the viewer; go/no-go on rover splat quality; rebalance work |
| Sat 9:00 PM | Mars bundle with geometry layer; modules place and score; Moon terrain bundle loads |
| Sun 12:00 AM | Tier 1 end to end |
| Sun 4:00 AM | Tier 2 done or cut |
| Sun 8:00 AM | Feature freeze; record a backup demo video; rehearse 3 times |
| Sun 10:30 AM | Devpost and all sponsor submissions done |
| Sun 12:00 PM | Hard deadline (Devpost shows 12:15; treat noon as real) |
| Sun 12:30 to 2:30 PM | Judging at Duderstadt; whole team at the table |

## Prize checklist (requirements that are easy to miss)

| Prize | Requirement | Owner |
|---|---|---|
| Grand Prize, AI track | Strong demo, technical depth, clear pitch | All |
| SpaceXAI | Built with Cursor (all code), uses Grok Imagine or Voice (we use both), real space data; bonus for planning in Grok Bot | All |
| Relay | Agent works in the Relay app | Humyra |
| Figma Best Design | Design in Figma first; show the process on Devpost | Humyra |
| Spacetime | Spacetime is the core real-time backend | Humyra |
| Fetch.ai | Agent on Agentverse, discoverable on ASI:One, plus submission through the ASI Submission Agent | Tier 3 |
| ElevenLabs (sponsor + MLH) | Real use of ElevenLabs voice | Humyra |
| Notability | Use Notability Pro during the hackathon; tag it; at least 2 screenshots on Devpost | Humyra |
| .Tech domain (MLH) | Register a .tech domain for the project | Humyra |
| Judged by an LLM | Enter | Humyra |

Ask the help desk whether Devpost caps the number of sponsor prizes per project.

## Devpost must include

- Team members added, table number, description, demo video, links.
- Sponsor tags for every tool used, with a line on how each was used.
- Data sources with links (`data-sources.md`), and the honest limits (resolution labels, radiation estimate).

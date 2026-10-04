# Relay agent

Owner: Humyra. Location: `apps/relay/` (TypeScript).

The Relay agent lets anyone on the team talk to the scene from their phone: ask about sites, get renders and scorecards as rich cards, and (stretch) video-call it for a fly-through. Relay's prize requires the agent to work in the Relay app.

Docs: https://docs.relayapp.im/llms.txt (quickstart, SDKs, messages, interactions, calls, webhooks).

## Setup

```bash
npx relaymessenger connect     # sign in to the Relay Console, create or select the agent, store credentials
npx relaymessenger watch       # live event viewer in a second terminal
```

Use the TypeScript SDK for the backend (`docs: live/sdks`, `start/build-on-the-api`). Receive messages via WebSocket (always-on) or webhooks. Keep the agent token in `.env`, never in code.

## What the agent does

| User says | Agent does |
|---|---|
| "how's site B looking?" | Reads `placed_module` rows from Spacetime, picks the module, replies with a rich card: concept render image, grade, three key numbers, buttons |
| "find a flat spot near the carbonates" | Calls backend `/intent`, then `/query`, writes a `highlight` to Spacetime, replies with a summary and a render of the highlighted view |
| "compare A and B" | Rich cards side by side, or one card with both grades and the main differences |
| "what's at Cheyava Falls?" | Replies from `pins.json` with the cited summary and source link |
| "render it" | Asks the web app (via a Spacetime row or the backend) for the latest capture, calls `/render`, sends the image |

Rich content to use (see Relay docs):
- Rich cards with picture, title, description, up to 4 buttons ("Compare to A", "Show path", "Render again", "Open in browser").
- Buttons for quick replies.
- Voice memos for narrated summaries (ElevenLabs voice: also counts toward the ElevenLabs prize).
- Typing indicators and task activity while a render is generating.

## Shared logic

The agent uses the same intents as the web app (`contracts.md` section 9), through the backend `/intent`. Don't build a second NLU path.

## Video call fly-through (Tier 3)

1. Record a fly-through per site in the browser (camera path around the base site, `MediaRecorder` on the canvas) and save it.
2. When a user starts a call, stream those frames as the agent's video (Relay calls docs: video, audio, events).
3. Voice in the call: ElevenLabs bridge (supported in Relay docs) or Grok Voice through the LiveKit integration.

Only start this once Tier 1 and the text agent work end to end.

## Testing

- Test from at least two phones.
- Keep a short script of 5 messages that exercise every feature, for the demo and for judges who want to try it.

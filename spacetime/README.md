# Shared session: SpacetimeDB module

This module is the real-time backend for everything people share in a scene: who is there and
where their cursor is (`user`, `cursor`), user pins (`pin`), placed base modules (`placed_module`)
and the rover (`rover`: where it is parked, or the drive every client is animating). It also holds
the accounts: organisations, their members, and which scenes each organisation may open. Reducers
are the only way to write. Tables are in `src/schema.ts`, scene reducers in `src/index.ts`, sign-in
and seeding in `src/accountReducers.ts`. The web app's client code is in `apps/web/src/multiplayer/`.

## Accounts and scene access

- An account is a SpacetimeDB identity: a token this browser keeps in localStorage. There is no
  password or e-mail. Next step: SpacetimeAuth, their hosted OIDC login (a client is already created
  in the dashboard); it replaces the token source and leaves the tables and checks as they are.
- `enter(name, code)` (the landing page's one box) writes a `member` row for the caller in the
  organisation whose code matches a row of the private table `organisation_secret`. Codes are never
  sent to clients. `sign_in(name, orgId, code)` is the same with the organisation named explicitly.
- Presence (the public `user` table) is what the landing page counts and what each scene card lists
  as "N live".
- `scene_access` (private) maps organisation -> scene ids. A client sees only its own organisation's
  rows, through the `my_scenes` view; that list is what "Your scenes" shows.
- Every reducer that touches a scene's shared state (join, cursor, pins, modules, rover) calls
  `requireAccess` and rejects a caller whose organisation does not have that scene.
- What this does NOT protect: the scene files are static files on a public host, so someone who
  guesses a URL can download them. And the shared rows are in public tables: a hand-written client
  could subscribe to another scene's pins and read them. It cannot write them.

Seed the organisations (module owner only; codes are generated into `~/.config/pss-studio/`, outside the repo):

```bash
spacetime/seed-orgs.sh maincloud pss-studio-mhacks     # or: local pss-studio-dev
```

The admin is the identity that first published the database (stored by `init`). `init` runs only on
a first publish or after `--delete-data=always`, so a database published before accounts existed
has to be republished once with that flag, then seeded.

Tested with the `spacetime` CLI and the `spacetimedb` npm package, both 2.10.2.

## Run it locally

```bash
# once: the CLI, at user level (no sudo)
curl -sSf https://install.spacetimedb.com | sh -s -- -y

# the server, on port 3000 (data in ~/.local/share/spacetime/data, survives restarts)
setsid nohup spacetime start --non-interactive > ~/.local/share/spacetime/server.log 2>&1 < /dev/null &

# once, and after every change to src/index.ts: build + publish, then regenerate the client bindings
cd spacetime
npm install
spacetime publish pss-studio --server local --module-path . --yes
spacetime generate --lang typescript --module-path . --out-dir ../apps/web/src/multiplayer/module_bindings --yes
```

A schema change that is not additive needs `--delete-data=always` on publish (it wipes the tables).

Look inside: `spacetime sql pss-studio --server local "SELECT * FROM pin"`, `spacetime logs pss-studio --server local -f`.

The web app connects to `ws://<the page's host>:3000`, database `pss-studio`, unless told otherwise.
With no server it still works, in memory, and says "offline, not shared"; it retries every 4 s.

## Two laptops

Same wifi, no cloud: run the server and `npx vite --host` on one laptop; the other opens
`http://<that laptop's IP>:5173/?scene=mars-hero-01`. It finds the server at the same IP by itself.

Hosted cloud (when the venue wifi blocks laptop-to-laptop traffic):

```bash
spacetime login                      # opens a browser; a person has to do this
cd spacetime
spacetime publish pss-studio-mhacks --server maincloud --module-path . --yes   # names are global: pick a free one
```

then in `apps/web/.env.local` (restart `vite` after editing):

```
VITE_SPACETIME_URI=wss://maincloud.spacetimedb.com
VITE_SPACETIME_MODULE=pss-studio-mhacks
```

## URL options

- `?scene=mars-hero-01` opens that scene directly if the signed-in organisation has it.
- `?name=Ada` gives this tab its own identity (sessionStorage), so two tabs can be two people; used by the test script.
- `?solo=1` never contacts the server: no sign-in, nothing shared ("offline: access not checked, not shared"). `shots/capture.mjs` uses it.
- `?room=rehearsal` is a private session on the same scene. Everyone without `room` shares one session per scene.

## Checks

- `node shots/two-clients.mjs`: accounts (three organisations, who sees which scenes, switching scenes in one tab,
  the server refusing a member without access), then two people in one scene: pins, cursor, rover drive, module, reset.
  Writes `shots/mp-*.png`. `MODE=accounts` or `MODE=shared` runs one part.
- `MODE=offline node shots/two-clients.mjs`: a signed-in person loses the server, works in memory, goes live again.
  Needs a local server you stop and start when it says so (`APP_URL`, `CODES_FILE` for a dev server pointed at it).
- `node apps/web/scripts/check-pin-chat.mjs`: the chat wording for pins.

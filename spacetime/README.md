# Shared session: SpacetimeDB module

`src/index.ts` is the real-time backend for everything people share in a scene: who is there and
where their cursor is (`user`, `cursor`), user pins (`pin`), placed base modules (`placed_module`)
and the rover (`rover`: where it is parked, or the drive every client is animating). Reducers are
the only way to write. The web app's client code is in `apps/web/src/multiplayer/`.

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

- `?name=Ada` sets the name shown to others (otherwise the one saved by "rename", else "Explorer 123").
- `?room=rehearsal` is a private session on the same scene. Everyone without `room` shares one session per scene.

## Checks

- `node shots/two-clients.mjs`: two browsers, one session; pins, cursor, rover drive, module, reset. Writes `shots/mp-*.png`.
- `MODE=offline node shots/two-clients.mjs`: started with the server down, then the server comes back.
- `node apps/web/scripts/check-pin-chat.mjs`: the chat wording for pins.

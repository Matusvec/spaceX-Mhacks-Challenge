# Multiplayer: Spacetime

Owner: Humyra. Location: `spacetime/` (module) with generated bindings used by `apps/web` and `apps/relay`.

SpacetimeDB holds all shared scene state. Tables store data; reducers are the only way to write. Every client subscribes and sees changes instantly.

## Setup

```bash
# install the SpacetimeDB CLI per https://spacetimedb.com/docs/quickstarts/typescript/
spacetime dev --template basic-ts
```

Server code lives in `spacetime/src/index.ts`. The CLI generates TypeScript client bindings (`module_bindings/`); copy or symlink them into `apps/web/src/multiplayer/` and `apps/relay/src/`.

## Tables

All positions are in the `site` frame, meters (`contracts.md`).

| Table | Columns | Notes |
|---|---|---|
| `user` | identity (pk), name, color, activeSceneId, online | One row per connected person or agent |
| `cursor` | identity (pk), sceneId, x, y, z, camX, camY, camZ, dirX, dirY, dirZ, updatedAt | 3D cursor plus camera, for showing where others look |
| `pin` | id (pk, auto), sceneId, author, x, y, z, note, createdAt | User pins, separate from science pins in `pins.json` |
| `highlight` | id (pk, auto), sceneId, author, queryText, clusterIdsJson, color, createdAt | Shared query results |
| `placed_module` | id (pk, auto), sceneId, author, type, x, y, z, rotationZDeg, scale, scoreJson, updatedAt | Base and terrarium modules with their last score |
| `scene_state` | sceneId (pk), activeLayer, timeOfDay, shieldingM | Shared view settings for presentations |

## Reducers

| Reducer | Args | Effect |
|---|---|---|
| `join` | name, color | Upsert `user`, online = true |
| `set_scene` | sceneId | Update the user's active scene |
| `update_cursor` | sceneId, position, camera position, camera direction | Upsert `cursor`; clients throttle to about 15 updates per second |
| `add_pin` / `remove_pin` | sceneId, position, note / id | |
| `add_highlight` / `clear_highlight` | sceneId, queryText, clusterIdsJson, color / id | |
| `place_module` | sceneId, type, position, rotationZDeg, scale | Insert |
| `move_module` | id, position, rotationZDeg | Update; clients send on drag end, plus throttled during drag |
| `set_module_score` | id, scoreJson | The client that moved it writes the score it computed |
| `delete_module` | id | |
| `set_scene_state` | sceneId, activeLayer, timeOfDay, shieldingM | |

Use the connection's identity as `author`; don't trust a client-provided name for ownership.

## Client behavior (web)

- On connect: `join`, then subscribe to rows for the active scene.
- Render other users' cursors as small colored markers with name labels, and a faint view cone from their camera.
- Pins, highlights, and modules render from table state, not local state, so everyone always matches.
- Local optimistic updates while dragging are fine; reconcile to the table on update.

## Demo moment

Two laptops in the same scene: one person drags the greenhouse dome, the other screen shows it move and the score change live. Test this on venue wifi early; if peer traffic is blocked, use Spacetime's hosted cloud rather than a laptop-hosted instance.

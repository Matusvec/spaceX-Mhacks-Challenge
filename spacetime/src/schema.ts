// Tables of the shared session and the access rule every scene reducer applies.
// Reducers: index.ts (scene state) and accountReducers.ts (sign-in, seeding, the my_scenes view).
import { schema, table, t, SenderError, type InferSchema, type ReducerCtx } from 'spacetimedb/server';

// ---- Accounts: who belongs to which organisation, and which scenes it may open ----
export const MAX_NAME = 32;

export function clean(text: string, max: number, what: string): string {
  const trimmed = text.trim();
  if (!trimmed) throw new SenderError(`${what} must not be empty`);
  if (trimmed.length > max) throw new SenderError(`${what} is longer than ${max} characters`);
  return trimmed;
}

// Public: the sign-in screen lists the organisations by name.
const organisation = table({ name: 'organisation', public: true }, { id: t.string().primaryKey(), name: t.string() });

// PRIVATE: access codes never leave the server. sign_in compares against this table.
const organisationSecret = table({ name: 'organisation_secret' }, { orgId: t.string().primaryKey(), code: t.string() });

// PRIVATE: clients read their own organisation's rows through the my_scenes view only.
export const sceneAccess = table(
  { name: 'scene_access' },
  { id: t.u64().primaryKey().autoInc(), orgId: t.string().index('btree'), sceneId: t.string() },
);

// One row per signed-in identity. Public, so people in a scene can see who is from where.
const member = table(
  { name: 'member', public: true },
  { identity: t.identity().primaryKey(), name: t.string(), orgId: t.string(), joinedAt: t.timestamp() },
);

// PRIVATE: the identity that published the module; only it may run the admin reducers.
const admin = table({ name: 'admin' }, { identity: t.identity().primaryKey() });


// ---- Scene state ----

export const MODULE_TYPES = ['habitat', 'greenhouse_dome', 'tunnel', 'landing_pad', 'solar_field'];
export const MAX_NOTE = 200;
// Handed out when the colour a client asked for is already worn by someone else in the scene.
// No cyan: that is the colour of the cited science pins.
export const COLORS = ['#ff9f43', '#ff6b9d', '#b388ff', '#7bed9f', '#ffd32a', '#ff7f50', '#f78fb3', '#c7ecee'];

const user = table(
  { name: 'user', public: true },
  { identity: t.identity().primaryKey(), name: t.string(), color: t.string(), activeSceneId: t.string(), online: t.bool() },
);

// 3D cursor (the terrain point under the mouse) plus the camera, to show where others look.
const cursor = table(
  { name: 'cursor', public: true },
  {
    identity: t.identity().primaryKey(),
    sceneId: t.string(),
    x: t.f64(), y: t.f64(), z: t.f64(),
    camX: t.f64(), camY: t.f64(), camZ: t.f64(),
    dirX: t.f64(), dirY: t.f64(), dirZ: t.f64(),
    updatedAt: t.timestamp(),
  },
);

// User pins: people's notes. Never mixed with the cited science pins of a bundle's pins.json.
const pin = table(
  { name: 'pin', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    sceneId: t.string().index('btree'),
    author: t.identity(),
    x: t.f64(), y: t.f64(), z: t.f64(),
    note: t.string(),
    createdAt: t.timestamp(),
  },
);

const placedModule = table(
  { name: 'placed_module', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    sceneId: t.string().index('btree'),
    author: t.identity(),
    type: t.string(),
    x: t.f64(), y: t.f64(), z: t.f64(),
    rotationZDeg: t.f64(),
    scale: t.f64(),
    scoreJson: t.string(),
    updatedAt: t.timestamp(),
  },
);

// One rover per scene. (x, y) is where it is parked, or where the active drive started.
// `seq` goes up on every drive or reset, so clients can tell a new command from a repeat.
const rover = table(
  { name: 'rover', public: true },
  {
    sceneId: t.string().primaryKey(),
    x: t.f64(), y: t.f64(),
    targetX: t.f64(), targetY: t.f64(),
    targetLabel: t.string(),
    driving: t.bool(),
    driver: t.identity(),
    seq: t.u32(),
    updatedAt: t.timestamp(),
  },
);

const spacetimedb = schema({ user, cursor, pin, placedModule, rover, organisation, organisationSecret, sceneAccess, member, admin });
export default spacetimedb;

export type Ctx = ReducerCtx<InferSchema<typeof spacetimedb>>;

// A scene id may carry a room ("mars-hero-01#rehearsal"); access is granted per scene, for all its rooms.
export function requireAccess(ctx: Ctx, sceneId: string): void {
  const scene = sceneId.split('#')[0];
  const me = ctx.db.member.identity.find(ctx.sender);
  if (!me) throw new SenderError('sign in to an organisation first');
  for (const grant of ctx.db.sceneAccess.orgId.filter(me.orgId)) if (grant.sceneId === scene) return;
  throw new SenderError(`your organisation does not have the scene "${scene}"`);
}


export function finite(...values: number[]): void {
  if (!values.every(Number.isFinite)) throw new SenderError('coordinates must be finite numbers');
}

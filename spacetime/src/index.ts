// Shared scene state for Planetary Scene Studio (docs/multiplayer.md, docs/contracts.md section 7).
// Tables hold the state; reducers are the only way to write. Positions are site-frame metres
// (+X east, +Y north, +Z up). `author` is always the caller's identity, never a client-sent name.
// Who may touch a scene is decided here too: see schema.ts (organisations, members, scene access).
import { t, SenderError } from 'spacetimedb/server';
import spacetimedb, { COLORS, MAX_NAME, MAX_NOTE, MODULE_TYPES, clean, finite, requireAccess, type Ctx } from './schema';

// The module's entry file must export the schema as default, and every reducer by name.
export default spacetimedb;
export * from './accountReducers';


function setOnline(ctx: Ctx, online: boolean): void {
  const row = ctx.db.user.identity.find(ctx.sender);
  if (row) ctx.db.user.identity.update({ ...row, online });
  if (!online) ctx.db.cursor.identity.delete(ctx.sender);
}

export const onConnect = spacetimedb.clientConnected((ctx) => setOnline(ctx, true));
export const onDisconnect = spacetimedb.clientDisconnected((ctx) => setOnline(ctx, false));

export const join = spacetimedb.reducer({ name: t.string(), color: t.string(), sceneId: t.string() }, (ctx, args) => {
  requireAccess(ctx, args.sceneId);
  const name = clean(args.name, MAX_NAME, 'name');
  if (!/^#[0-9a-fA-F]{6}$/.test(args.color)) throw new SenderError('color must look like #rrggbb');
  const taken = new Set<string>();
  for (const other of ctx.db.user.iter()) {
    if (other.online && other.activeSceneId === args.sceneId && !other.identity.equals(ctx.sender)) taken.add(other.color);
  }
  const color = taken.has(args.color) ? (COLORS.find((c) => !taken.has(c)) ?? args.color) : args.color;
  const row = { identity: ctx.sender, name, color, activeSceneId: args.sceneId, online: true };
  if (ctx.db.user.identity.find(ctx.sender)) ctx.db.user.identity.update(row);
  else ctx.db.user.insert(row);
});

export const setScene = spacetimedb.reducer({ sceneId: t.string() }, (ctx, { sceneId }) => {
  const row = ctx.db.user.identity.find(ctx.sender);
  if (!row) throw new SenderError('join first');
  if (sceneId) requireAccess(ctx, sceneId); // "" = back on the scene list
  ctx.db.user.identity.update({ ...row, activeSceneId: sceneId });
  ctx.db.cursor.identity.delete(ctx.sender);
});

export const updateCursor = spacetimedb.reducer(
  {
    sceneId: t.string(),
    x: t.f64(), y: t.f64(), z: t.f64(),
    camX: t.f64(), camY: t.f64(), camZ: t.f64(),
    dirX: t.f64(), dirY: t.f64(), dirZ: t.f64(),
  },
  (ctx, a) => {
    requireAccess(ctx, a.sceneId);
    finite(a.x, a.y, a.z, a.camX, a.camY, a.camZ, a.dirX, a.dirY, a.dirZ);
    const row = { identity: ctx.sender, ...a, updatedAt: ctx.timestamp };
    if (ctx.db.cursor.identity.find(ctx.sender)) ctx.db.cursor.identity.update(row);
    else ctx.db.cursor.insert(row);
  },
);

export const hideCursor = spacetimedb.reducer((ctx) => {
  ctx.db.cursor.identity.delete(ctx.sender);
});

export const addPin = spacetimedb.reducer(
  { sceneId: t.string(), x: t.f64(), y: t.f64(), z: t.f64(), note: t.string() },
  (ctx, { sceneId, x, y, z, note }) => {
    requireAccess(ctx, sceneId);
    finite(x, y, z);
    ctx.db.pin.insert({ id: 0n, sceneId, author: ctx.sender, x, y, z, note: clean(note, MAX_NOTE, 'note'), createdAt: ctx.timestamp });
  },
);

// Pins and modules are a shared whiteboard: anyone in the scene may edit or remove them.
export const renamePin = spacetimedb.reducer({ id: t.u64(), note: t.string() }, (ctx, { id, note }) => {
  const row = ctx.db.pin.id.find(id);
  if (!row) throw new SenderError(`no pin ${id}`);
  requireAccess(ctx, row.sceneId);
  ctx.db.pin.id.update({ ...row, note: clean(note, MAX_NOTE, 'note') });
});

export const removePin = spacetimedb.reducer({ id: t.u64() }, (ctx, { id }) => {
  const row = ctx.db.pin.id.find(id);
  if (!row) return;
  requireAccess(ctx, row.sceneId);
  ctx.db.pin.id.delete(id);
});

export const placeModule = spacetimedb.reducer(
  { sceneId: t.string(), type: t.string(), x: t.f64(), y: t.f64(), z: t.f64(), rotationZDeg: t.f64(), scale: t.f64(), scoreJson: t.string() },
  (ctx, a) => {
    requireAccess(ctx, a.sceneId);
    finite(a.x, a.y, a.z, a.rotationZDeg, a.scale);
    if (!MODULE_TYPES.includes(a.type)) throw new SenderError(`unknown module type "${a.type}"`);
    ctx.db.placedModule.insert({ id: 0n, author: ctx.sender, ...a, updatedAt: ctx.timestamp });
  },
);

export const moveModule = spacetimedb.reducer(
  { id: t.u64(), x: t.f64(), y: t.f64(), z: t.f64(), rotationZDeg: t.f64(), scoreJson: t.string() },
  (ctx, { id, x, y, z, rotationZDeg, scoreJson }) => {
    finite(x, y, z, rotationZDeg);
    const row = ctx.db.placedModule.id.find(id);
    if (!row) throw new SenderError(`no module ${id}`);
    requireAccess(ctx, row.sceneId);
    ctx.db.placedModule.id.update({ ...row, x, y, z, rotationZDeg, scoreJson, updatedAt: ctx.timestamp });
  },
);

export const setModuleScore = spacetimedb.reducer({ id: t.u64(), scoreJson: t.string() }, (ctx, { id, scoreJson }) => {
  const row = ctx.db.placedModule.id.find(id);
  if (!row) throw new SenderError(`no module ${id}`);
  requireAccess(ctx, row.sceneId);
  ctx.db.placedModule.id.update({ ...row, scoreJson, updatedAt: ctx.timestamp });
});

export const deleteModule = spacetimedb.reducer({ id: t.u64() }, (ctx, { id }) => {
  const row = ctx.db.placedModule.id.find(id);
  if (!row) return;
  requireAccess(ctx, row.sceneId);
  ctx.db.placedModule.id.delete(id);
});

function putRover(ctx: Ctx, sceneId: string, next: { x: number; y: number; targetX: number; targetY: number; targetLabel: string; driving: boolean }): void {
  const row = ctx.db.rover.sceneId.find(sceneId);
  const full = { sceneId, ...next, driver: ctx.sender, seq: (row?.seq ?? 0) + 1, updatedAt: ctx.timestamp };
  if (row) ctx.db.rover.sceneId.update(full);
  else ctx.db.rover.insert(full);
}

// Starts a drive from (fromX, fromY) to the target. Every client plans the same route and animates it.
export const driveRover = spacetimedb.reducer(
  { sceneId: t.string(), fromX: t.f64(), fromY: t.f64(), toX: t.f64(), toY: t.f64(), label: t.string() },
  (ctx, { sceneId, fromX, fromY, toX, toY, label }) => {
    requireAccess(ctx, sceneId);
    finite(fromX, fromY, toX, toY);
    putRover(ctx, sceneId, { x: fromX, y: fromY, targetX: toX, targetY: toY, targetLabel: label.slice(0, MAX_NOTE), driving: true });
  },
);

// Any client whose animation finishes reports it; only the first report for the current drive counts.
export const roverArrived = spacetimedb.reducer({ sceneId: t.string(), seq: t.u32() }, (ctx, { sceneId, seq }) => {
  requireAccess(ctx, sceneId);
  const row = ctx.db.rover.sceneId.find(sceneId);
  if (!row || !row.driving || row.seq !== seq) return;
  ctx.db.rover.sceneId.update({ ...row, x: row.targetX, y: row.targetY, driving: false, updatedAt: ctx.timestamp });
});

export const resetRover = spacetimedb.reducer({ sceneId: t.string() }, (ctx, { sceneId }) => {
  requireAccess(ctx, sceneId);
  putRover(ctx, sceneId, { x: 0, y: 0, targetX: 0, targetY: 0, targetLabel: '', driving: false });
});

const MAX_CHAT = 500;
const KEEP_CHAT = 100;

export const sendChat = spacetimedb.reducer({ sceneId: t.string(), text: t.string() }, (ctx, { sceneId, text }) => {
  requireAccess(ctx, sceneId);
  const who = ctx.db.user.identity.find(ctx.sender);
  const name = who?.name ?? ctx.db.member.identity.find(ctx.sender)?.name ?? 'someone';
  ctx.db.chatMessage.insert({ id: 0n, sceneId, author: ctx.sender, name, color: who?.color ?? '#cccccc', text: clean(text, MAX_CHAT, 'message'), sentAt: ctx.timestamp });
  const all = [...ctx.db.chatMessage.sceneId.filter(sceneId)].sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const old of all.slice(0, Math.max(0, all.length - KEEP_CHAT))) ctx.db.chatMessage.id.delete(old.id);
});

const MAX_IMAGE_CHARS = 400_000; // about 300 KB of JPEG as base64
const KEEP_CONCEPTS = 12;

export const shareConcept = spacetimedb.reducer(
  { sceneId: t.string(), renderId: t.string(), idea: t.string(), prompt: t.string(), poseJson: t.string(), image: t.string() },
  (ctx, a) => {
    requireAccess(ctx, a.sceneId);
    if (!a.image.startsWith('data:image/')) throw new SenderError('the picture must be an image data URL');
    if (a.image.length > MAX_IMAGE_CHARS) throw new SenderError('the picture is too large to share');
    if (a.poseJson.length > 2000 || a.renderId.length > 100) throw new SenderError('bad concept');
    const existing = [...ctx.db.concept.sceneId.filter(a.sceneId)].sort((x, y) => (x.id < y.id ? -1 : 1));
    if (existing.some((c) => c.renderId === a.renderId)) return;
    const who = ctx.db.user.identity.find(ctx.sender);
    ctx.db.concept.insert({
      id: 0n, sceneId: a.sceneId, author: ctx.sender, authorName: who?.name ?? 'someone', renderId: a.renderId,
      idea: a.idea.slice(0, 400), prompt: a.prompt.slice(0, 2000), poseJson: a.poseJson, image: a.image, createdAt: ctx.timestamp,
    });
    for (const old of existing.slice(0, Math.max(0, existing.length + 1 - KEEP_CONCEPTS))) ctx.db.concept.id.delete(old.id);
  },
);

export const removeConcept = spacetimedb.reducer({ id: t.u64() }, (ctx, { id }) => {
  const row = ctx.db.concept.id.find(id);
  if (!row) return;
  requireAccess(ctx, row.sceneId);
  ctx.db.concept.id.delete(id);
});

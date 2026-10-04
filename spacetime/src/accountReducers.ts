// Sign-in, sign-out, the owner-only seeding reducer and the "my scenes" view. Tables are in schema.ts.
import { t, SenderError } from 'spacetimedb/server';
import spacetimedb, { sceneAccess, MAX_NAME, clean } from './schema';

// The identity that publishes the module becomes its administrator (runs once: first publish, or after a data wipe).
export const init = spacetimedb.init((ctx) => {
  ctx.db.admin.insert({ identity: ctx.sender });
});

// Creates or replaces an organisation, its access code and its scenes. Module owner only; run from the CLI
// (spacetime/seed-orgs.sh), so the codes are never in the repo or the client bundle.
export const adminSetOrganisation = spacetimedb.reducer(
  { id: t.string(), name: t.string(), code: t.string(), sceneIds: t.array(t.string()) },
  (ctx, { id, name, code, sceneIds }) => {
    if (!ctx.db.admin.identity.find(ctx.sender)) throw new SenderError('only the module owner may do this');
    if (!/^[a-z0-9-]{2,40}$/.test(id)) throw new SenderError('organisation id: lowercase letters, digits and dashes');
    if (code.length < 8) throw new SenderError('access code must be at least 8 characters');
    const org = { id, name: clean(name, 80, 'organisation name') };
    if (ctx.db.organisation.id.find(id)) ctx.db.organisation.id.update(org);
    else ctx.db.organisation.insert(org);
    ctx.db.organisationSecret.orgId.delete(id);
    ctx.db.organisationSecret.insert({ orgId: id, code });
    for (const grant of [...ctx.db.sceneAccess.orgId.filter(id)]) ctx.db.sceneAccess.id.delete(grant.id);
    for (const sceneId of sceneIds) ctx.db.sceneAccess.insert({ id: 0n, orgId: id, sceneId });
  },
);

// Joins the caller's identity to an organisation. The code is compared here, against a private table.
export const signIn = spacetimedb.reducer({ name: t.string(), orgId: t.string(), code: t.string() }, (ctx, args) => {
  const name = clean(args.name, MAX_NAME, 'name');
  const secret = ctx.db.organisationSecret.orgId.find(args.orgId);
  if (!secret || secret.code !== args.code.trim()) throw new SenderError('that access code is not right for this organisation');
  const row = { identity: ctx.sender, name, orgId: args.orgId, joinedAt: ctx.timestamp };
  if (ctx.db.member.identity.find(ctx.sender)) ctx.db.member.identity.update(row);
  else ctx.db.member.insert(row);
});

export const signOut = spacetimedb.reducer((ctx) => {
  ctx.db.member.identity.delete(ctx.sender);
  ctx.db.cursor.identity.delete(ctx.sender);
  const row = ctx.db.user.identity.find(ctx.sender);
  if (row) ctx.db.user.identity.update({ ...row, activeSceneId: '' });
});

// What a client may list: the scenes of the caller's own organisation, and nothing about the others.
export const myScenes = spacetimedb.view({ name: 'my_scenes', public: true }, t.array(sceneAccess.rowType), (ctx) => {
  const me = ctx.db.member.identity.find(ctx.sender);
  return me ? [...ctx.db.sceneAccess.orgId.filter(me.orgId)] : [];
});

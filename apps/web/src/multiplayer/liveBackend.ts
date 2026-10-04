import type { Identity } from "spacetimedb";
import type { ModuleType } from "../contracts";
import { errorText, type Link } from "./connection";
import { tables } from "./module_bindings";
import type { PeerCursor, SharedActions, Snapshot } from "./types";

type Options = {
  sceneId: string;
  profile: () => { name: string; color: string };
  onReady: () => void; // joined, and the scene's rows are in
  onError: (error: string) => void; // a reducer said no (no access, bad input) or the scene subscription failed
  onSnapshot: (snapshot: Snapshot) => void;
  onCursors: (cursors: PeerCursor[]) => void;
};

export type SceneSession = { actions: SharedActions; rejoin: () => void; leave: () => void };

/**
 * Joins one scene over an open link: announces this person there, subscribes to the scene's rows and keeps
 * `onSnapshot` fed. `leave()` undoes all of it, so the same connection can move on to another scene.
 */
export function joinScene({ conn, identity: self }: Link, options: Options): SceneSession {
  const { sceneId, onReady, onError, onSnapshot, onCursors } = options;
  let left = false;
  let ready = false;
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;

  // Reducer errors show in the shared panel instead of failing silently.
  const call = async (run: () => Promise<void>) => {
    if (left) return;
    try {
      await run();
    } catch (err) {
      if (!left) onError(errorText(err));
    }
  };

  const users = () => new Map([...conn.db.user.iter()].map((u) => [u.identity.toHexString(), u]));

  const refresh = () => {
    refreshTimer = undefined;
    if (left || !ready) return;
    const all = users();
    const mine = (id: Identity) => id.isEqual(self);
    const meta = (id: Identity) => {
      const who = all.get(id.toHexString());
      return { author: id.toHexString(), authorName: who?.name ?? "someone", color: who?.color ?? "#cccccc", mine: mine(id) };
    };
    const byId = (a: { id: bigint }, b: { id: bigint }) => (a.id < b.id ? -1 : 1);
    const rover = [...conn.db.rover.iter()].find((r) => r.sceneId === sceneId);
    onSnapshot({
      people: [...all.values()]
        .filter((u) => u.online && u.activeSceneId === sceneId)
        .map((u) => ({ id: u.identity.toHexString(), name: u.name, color: u.color, isSelf: mine(u.identity) })),
      pins: [...conn.db.pin.iter()]
        .filter((p) => p.sceneId === sceneId)
        .sort(byId)
        .map((p) => ({
          id: p.id,
          sceneId,
          ...meta(p.author),
          position: { x: p.x, y: p.y, z: p.z },
          note: p.note,
          createdAt: p.createdAt.microsSinceUnixEpoch,
        })),
      modules: [...conn.db.placedModule.iter()]
        .filter((m) => m.sceneId === sceneId)
        .sort(byId)
        .map((m) => ({
          id: m.id,
          sceneId,
          ...meta(m.author),
          type: m.type as ModuleType,
          position: { x: m.x, y: m.y, z: m.z },
          rotationZDeg: m.rotationZDeg,
          scale: m.scale,
          scoreJson: m.scoreJson,
        })),
      concepts: [...conn.db.concept.iter()]
        .filter((c) => c.sceneId === sceneId)
        .sort(byId)
        .map((c) => ({ id: c.id, renderId: c.renderId, authorName: c.authorName, mine: mine(c.author), idea: c.idea, prompt: c.prompt, poseJson: c.poseJson, image: c.image, createdAtMs: Number(c.createdAt.microsSinceUnixEpoch / 1000n) })),
      chat: [...conn.db.chatMessage.iter()]
        .filter((m) => m.sceneId === sceneId)
        .sort(byId)
        .map((m) => ({ id: m.id, name: m.name, color: m.color, text: m.text, sentAtMs: Number(m.sentAt.microsSinceUnixEpoch / 1000n), mine: mine(m.author) })),
      rover: rover
        ? { x: rover.x, y: rover.y, targetX: rover.targetX, targetY: rover.targetY, targetLabel: rover.targetLabel, driving: rover.driving, seq: rover.seq, mine: mine(rover.driver) }
        : null,
    });
  };
  // Many rows can change in one transaction; rebuild the snapshot once. (A timer, not rAF: hidden tabs still sync.)
  const scheduleRefresh = () => void (refreshTimer ??= setTimeout(refresh, 0));

  // Cursors move ~15 times a second per person, so they skip React and go straight to the 3D markers.
  const emitCursors = () => {
    if (left) return;
    const all = users();
    const cursors: PeerCursor[] = [];
    for (const c of conn.db.cursor.iter()) {
      const user = all.get(c.identity.toHexString());
      if (c.sceneId !== sceneId || c.identity.isEqual(self) || !user?.online) continue;
      cursors.push({ id: c.identity.toHexString(), name: user.name, color: user.color, position: { x: c.x, y: c.y, z: c.z }, camera: { x: c.camX, y: c.camY, z: c.camZ } });
    }
    onCursors(cursors);
  };
  const onPeople = () => {
    scheduleRefresh();
    emitCursors();
  };

  const snapshotTables = [conn.db.pin, conn.db.placedModule, conn.db.rover, conn.db.chatMessage, conn.db.concept] as const;
  for (const table of snapshotTables) {
    table.onInsert(scheduleRefresh);
    table.onUpdate(scheduleRefresh);
    table.onDelete(scheduleRefresh);
  }
  conn.db.user.onInsert(onPeople);
  conn.db.user.onUpdate(onPeople);
  conn.db.cursor.onInsert(emitCursors);
  conn.db.cursor.onUpdate(emitCursors);
  conn.db.cursor.onDelete(emitCursors);

  const join = () => call(() => conn.reducers.join({ ...options.profile(), sceneId }));

  const subscription = conn
    .subscriptionBuilder()
    .onApplied(() => {
      ready = true;
      refresh();
      emitCursors();
      onReady();
    })
    .onError(() => onError("the session server refused this scene's subscription"))
    .subscribe([
      tables.cursor.where((r) => r.sceneId.eq(sceneId)),
      tables.pin.where((r) => r.sceneId.eq(sceneId)),
      tables.placedModule.where((r) => r.sceneId.eq(sceneId)),
      tables.rover.where((r) => r.sceneId.eq(sceneId)),
      tables.chatMessage.where((r) => r.sceneId.eq(sceneId)),
      tables.concept.where((r) => r.sceneId.eq(sceneId)),
    ]);
  void join();

  const flat = (d: { position: { x: number; y: number; z: number }; rotationZDeg: number; scoreJson: string }) => ({
    ...d.position,
    rotationZDeg: d.rotationZDeg,
    scoreJson: d.scoreJson,
  });

  const actions: SharedActions = {
    addPin: (position, note) => void call(() => conn.reducers.addPin({ sceneId, ...position, note })),
    renamePin: (id, note) => void call(() => conn.reducers.renamePin({ id, note })),
    removePin: (id) => void call(() => conn.reducers.removePin({ id })),
    placeModule: (draft) => void call(() => conn.reducers.placeModule({ sceneId, type: draft.type, scale: 1, ...flat(draft) })),
    moveModule: (id, draft) => void call(() => conn.reducers.moveModule({ id, ...flat(draft) })),
    deleteModule: (id) => void call(() => conn.reducers.deleteModule({ id })),
    driveRover: (from, to, label) =>
      void call(() => conn.reducers.driveRover({ sceneId, fromX: from.x, fromY: from.y, toX: to.x, toY: to.y, label })),
    roverArrived: (seq) => void call(() => conn.reducers.roverArrived({ sceneId, seq })),
    resetRover: () => void call(() => conn.reducers.resetRover({ sceneId })),
    sendChat: (text) => void call(() => conn.reducers.sendChat({ sceneId, text })),
    shareConcept: (draft) => void call(() => conn.reducers.shareConcept({ sceneId, ...draft })),
    removeConcept: (id) => void call(() => conn.reducers.removeConcept({ id })),
    setCursor: (pose) =>
      void call(() =>
        pose
          ? conn.reducers.updateCursor({
              sceneId,
              ...pose.position,
              camX: pose.camera.x, camY: pose.camera.y, camZ: pose.camera.z,
              dirX: pose.direction.x, dirY: pose.direction.y, dirZ: pose.direction.z,
            })
          : conn.reducers.hideCursor({}),
      ),
  };

  return {
    actions,
    rejoin: () => void join(),
    leave: () => {
      left = true;
      clearTimeout(refreshTimer);
      for (const table of snapshotTables) {
        table.removeOnInsert(scheduleRefresh);
        table.removeOnUpdate(scheduleRefresh);
        table.removeOnDelete(scheduleRefresh);
      }
      conn.db.user.removeOnInsert(onPeople);
      conn.db.user.removeOnUpdate(onPeople);
      conn.db.cursor.removeOnInsert(emitCursors);
      conn.db.cursor.removeOnUpdate(emitCursors);
      conn.db.cursor.removeOnDelete(emitCursors);
      try {
        if (!subscription.isEnded()) subscription.unsubscribe();
        // "" = on the scene list: no longer counted among the people in this scene.
        void conn.reducers.setScene({ sceneId: "" }).catch(() => {});
      } catch {
        // the connection is already gone; nothing to undo
      }
    },
  };
}

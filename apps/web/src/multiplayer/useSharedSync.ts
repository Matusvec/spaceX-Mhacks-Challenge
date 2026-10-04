import { useEffect, useMemo, useRef, useState } from "react";
import type { Body } from "../contracts";
import type { HoverInfo, SceneRoot } from "../scene/SceneRoot";
import type { Basecamp } from "../ui/useBasecamp";
import type { Rover, RoverSync } from "../ui/useRover";
import { SharedMarkers } from "./sharedMarkers";
import type { ModuleDraft } from "./types";
import type { SharedScene } from "./useSharedScene";

const MODULE_SEND_MS = 80; // while dragging a module, at most ~12 moves a second go out

/** What useRover calls when this user drives or resets the rover, so every other client follows. */
export function useRoverBroadcast(shared: SharedScene): RoverSync & { pendingOwn: number } {
  const ref = useRef(shared);
  ref.current = shared;
  return useMemo(() => {
    const sync = {
      // Commands sent and not yet echoed back by the table; an echo must not be replayed here.
      pendingOwn: 0,
      onDrive(from: { x: number; y: number }, target: { x: number; y: number; label: string }) {
        if (ref.current.status === "live") sync.pendingOwn++;
        ref.current.actions.driveRover(from, target, target.label);
      },
      onArrive() {
        const row = ref.current.rover;
        if (row?.driving) ref.current.actions.roverArrived(row.seq);
      },
      onReset() {
        if (ref.current.status === "live") sync.pendingOwn++;
        ref.current.actions.resetRover();
      },
    };
    return sync;
  }, []);
}

type Args = {
  shared: SharedScene;
  roverSync: { pendingOwn: number };
  sceneRoot: SceneRoot | null;
  body: Body | null; // of the bundle on screen
  rover: Rover;
  basecamp: Basecamp;
  hover: HoverInfo;
};

/** Feeds the shared tables into the scene and the existing hooks, and this user's edits back into the tables. */
export function useSharedSync({ shared, roverSync, sceneRoot, body, rover, basecamp, hover }: Args) {
  const { actions, modules, pins, onCursors, setCursor, status } = shared;

  // 3D markers: user pins, other people's cursors, modules that are not the one being edited here.
  const [markers, setMarkers] = useState<SharedMarkers | null>(null);
  useEffect(() => {
    if (!sceneRoot) return;
    const created = new SharedMarkers();
    const remove = sceneRoot.addSiteLayer(created.root);
    setMarkers(created);
    return () => {
      remove();
      created.dispose();
      setMarkers(null);
    };
  }, [sceneRoot]);
  useEffect(() => markers?.setPins(pins), [markers, pins]);
  useEffect(() => (markers ? onCursors((cursors) => markers.setCursors(cursors)) : undefined), [markers, onCursors]);

  // This user's cursor: the terrain point under the mouse and the camera it is seen from.
  useEffect(() => {
    const camera = hover && sceneRoot?.cameraSite();
    setCursor(hover && camera ? { position: hover, camera: camera.position, direction: camera.direction } : null);
  }, [hover, sceneRoot, setCursor]);

  // Rover: replay drives and resets that other clients started; park where the table says it is parked.
  const roverRef = useRef(rover);
  roverRef.current = rover;
  const row = shared.rover;
  const ready = rover.position !== null;
  const lastSeq = useRef<number | null>(null);
  useEffect(() => {
    if (!row || !ready) {
      lastSeq.current = null;
      return;
    }
    const local = roverRef.current;
    const isNew = row.seq !== lastSeq.current;
    lastSeq.current = row.seq;
    if (isNew && row.mine && roverSync.pendingOwn > 0) {
      roverSync.pendingOwn--;
      return;
    }
    if (row.driving) {
      if (isNew) local.driveTo({ x: row.targetX, y: row.targetY, label: row.targetLabel }, { x: row.x, y: row.y });
      return;
    }
    if (local.route?.status === "driving") return; // another client finished the same drive a moment earlier
    if (isNew && row.targetLabel === "") local.reset(true);
    else if (local.position?.x !== row.x || local.position?.y !== row.y) local.moveTo({ x: row.x, y: row.y });
  }, [row?.seq, row?.driving, ready, roverSync]); // eslint-disable-line react-hooks/exhaustive-deps

  // Modules: the placement being edited in the Base camp panel is one row of placed_module.
  const { placement, evaluation } = basecamp;
  const draft = useMemo<ModuleDraft | null>(
    () =>
      placement && evaluation
        ? {
            type: placement.type,
            position: { x: placement.x, y: placement.y, z: evaluation.padHeightM },
            rotationZDeg: placement.rotationZDeg,
            scoreJson: JSON.stringify(evaluation.score),
          }
        : null,
    [placement, evaluation],
  );
  const [editingId, setEditingId] = useState<bigint | null>(null);
  const placedWith = useRef<Set<bigint> | null>(null); // the ids that existed when this client asked for a new row
  const send = useRef<{ at: number; timer?: ReturnType<typeof setTimeout> }>({ at: 0 });

  useEffect(() => {
    placedWith.current = null; // a switch between live and offline starts from that side's rows
  }, [status]);

  useEffect(() => {
    clearTimeout(send.current.timer);
    if (!draft) {
      if (editingId !== null) actions.deleteModule(editingId);
      setEditingId(null);
      placedWith.current = null;
      return;
    }
    if (editingId === null) {
      // The row this client asked for shows up in the table a moment later: adopt it.
      const created = placedWith.current && modules.find((m) => m.mine && !placedWith.current!.has(m.id));
      if (created) {
        placedWith.current = null;
        setEditingId(created.id);
      } else if (!placedWith.current) {
        placedWith.current = new Set(modules.map((m) => m.id));
        actions.placeModule(draft);
      }
      return;
    }
    const current = modules.find((m) => m.id === editingId);
    if (!current || current.type !== draft.type) {
      // Gone (someone removed it, or the backend changed) or a different module type: place a fresh row.
      if (current) actions.deleteModule(editingId);
      setEditingId(null);
      return;
    }
    const p = current.position;
    const same = p.x === draft.position.x && p.y === draft.position.y && p.z === draft.position.z;
    if (same && current.rotationZDeg === draft.rotationZDeg && current.scoreJson === draft.scoreJson) return;
    const move = () => {
      send.current.at = performance.now();
      actions.moveModule(editingId, draft);
    };
    const wait = send.current.at + MODULE_SEND_MS - performance.now();
    if (wait <= 0) move();
    else send.current.timer = setTimeout(move, wait);
  }, [draft, editingId, modules, actions]);

  useEffect(() => {
    if (markers && body) markers.setModules(modules.filter((m) => m.id !== editingId), body);
  }, [markers, body, modules, editingId]);

  return {
    editingId,
    // Leaves the module where it is as a shared row and frees the panel to place another one.
    keepModule: () => {
      setEditingId(null);
      placedWith.current = null;
      basecamp.removeModule();
    },
  };
}

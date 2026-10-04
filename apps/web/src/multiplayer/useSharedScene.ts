import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { Link } from "./connection";
import { joinScene, type SceneSession } from "./liveBackend";
import type { ConnectionStatus, CursorPose, PeerCursor, SharedActions, Snapshot } from "./types";

// Cyan is left out: it is the colour of the cited science pins.
const COLORS = ["#ff9f43", "#ff6b9d", "#b388ff", "#7bed9f", "#ffd32a", "#ff7f50", "#f78fb3", "#c7ecee"];
const NAME_KEY = "pss.name";
const CURSOR_INTERVAL_MS = 66; // about 15 updates a second (docs/multiplayer.md)
const EMPTY: Snapshot = { people: [], pins: [], modules: [], rover: null };

/** What the scene session needs from the account (multiplayer/useAccount.ts): the open connection, if any. */
export type SharedAccount = { link: Link | null; status: ConnectionStatus; error: string | null; name: string | null };
const NO_ACCOUNT: SharedAccount = { link: null, status: "offline", error: null, name: null };

type Profile = { name: string; color: string };

function loadProfile(signedInName: string | null): Profile {
  // The name given at sign-in; else ?name=Ada in the URL; else the one saved by "rename".
  let name = signedInName ?? new URLSearchParams(window.location.search).get("name");
  try {
    name ??= localStorage.getItem(NAME_KEY);
  } catch {
    // storage blocked: fall through to a generated name
  }
  const n = Math.floor(Math.random() * 900 + 100);
  return { name: (name ?? `Explorer ${n}`).slice(0, 32), color: COLORS[n % COLORS.length] };
}

// The offline twin of the reducers: the same calls on an in-memory snapshot. Ids count down from -1.
function localActions(sceneId: string, profile: () => Profile, set: Dispatch<SetStateAction<Snapshot>>): SharedActions {
  let nextId = -1n;
  const mine = () => ({ sceneId, author: "local", authorName: profile().name, color: profile().color, mine: true });
  return {
    addPin: (position, note) =>
      set((s) => ({ ...s, pins: [...s.pins, { id: nextId--, ...mine(), position, note: note.trim(), createdAt: BigInt(Date.now()) * 1000n }] })),
    renamePin: (id, note) => set((s) => ({ ...s, pins: s.pins.map((p) => (p.id === id ? { ...p, note: note.trim() } : p)) })),
    removePin: (id) => set((s) => ({ ...s, pins: s.pins.filter((p) => p.id !== id) })),
    placeModule: (draft) => set((s) => ({ ...s, modules: [...s.modules, { id: nextId--, ...mine(), scale: 1, ...draft }] })),
    moveModule: (id, draft) => set((s) => ({ ...s, modules: s.modules.map((m) => (m.id === id ? { ...m, ...draft } : m)) })),
    deleteModule: (id) => set((s) => ({ ...s, modules: s.modules.filter((m) => m.id !== id) })),
    // Offline the rover and the cursor are already local; there is nobody to tell.
    driveRover: () => {},
    roverArrived: () => {},
    resetRover: () => {},
    setCursor: () => {},
  };
}

/**
 * Shared scene state: people, user pins, placed modules and the rover. Live from SpacetimeDB when it is
 * reachable; otherwise the same features work in memory on this machine only (status "offline").
 */
export function useSharedScene(bundleSceneId: string, account: SharedAccount = NO_ACCOUNT) {
  const { link } = account;
  // ?room=name gives a private session on the same scene (a rehearsal, a second team, the test script).
  const [room] = useState(() => new URLSearchParams(window.location.search).get("room"));
  const sceneId = room ? `${bundleSceneId}#${room}` : bundleSceneId;
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState<Snapshot>(EMPTY);
  const [local, setLocal] = useState<Snapshot>(EMPTY);
  const [profile, setProfile] = useState(() => loadProfile(account.name));
  const profileRef = useRef(profile);
  profileRef.current = profile;
  const handle = useRef<SceneSession | null>(null);
  const cursorListeners = useRef(new Set<(cursors: PeerCursor[]) => void>());
  const lastCursors = useRef<PeerCursor[]>([]);
  const localRef = useRef(local);
  localRef.current = local;

  useEffect(() => {
    setError(null);
    if (!link) return;
    const emitCursors = (cursors: PeerCursor[]) => {
      lastCursors.current = cursors;
      cursorListeners.current.forEach((listener) => listener(cursors));
    };
    const session = joinScene(link, {
      sceneId,
      profile: () => profileRef.current,
      onReady: () => setReady(true),
      onError: setError,
      onSnapshot: setLive,
      onCursors: emitCursors,
    });
    handle.current = session;
    return () => {
      session.leave();
      handle.current = null;
      setReady(false);
      emitCursors([]);
    };
  }, [sceneId, link]);

  const offline = useMemo(() => localActions(sceneId, () => profileRef.current, setLocal), [sceneId]);
  const isLive = ready && link !== null && handle.current !== null;
  const status: ConnectionStatus = link ? "connecting" : account.status === "live" ? "connecting" : account.status;
  const actions = isLive ? handle.current!.actions : offline;

  // Pins made while offline are sent up once the server is reachable, so nothing a user typed is lost.
  useEffect(() => {
    if (!isLive) return;
    for (const pin of localRef.current.pins) handle.current?.actions.addPin(pin.position, pin.note);
    setLocal(EMPTY);
  }, [isLive]);

  const setName = useCallback((name: string) => {
    const clean = name.trim().slice(0, 32);
    if (!clean) return;
    try {
      localStorage.setItem(NAME_KEY, clean);
    } catch {
      // not remembered across reloads; still applied now
    }
    profileRef.current = { ...profileRef.current, name: clean };
    setProfile(profileRef.current);
    handle.current?.rejoin();
  }, []);

  // At most one cursor update per interval; the newest pose wins.
  const cursor = useRef<{ pose: CursorPose | null; timer?: ReturnType<typeof setTimeout>; shown: boolean }>({ pose: null, shown: false });
  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  const setCursor = useCallback((pose: CursorPose | null) => {
    const state = cursor.current;
    if (!pose && !state.pose && !state.shown) return;
    state.pose = pose;
    state.timer ??= setTimeout(() => {
      state.timer = undefined;
      state.shown = state.pose !== null;
      actionsRef.current.setCursor(state.pose);
    }, CURSOR_INTERVAL_MS);
  }, []);

  const onCursors = useCallback((listener: (cursors: PeerCursor[]) => void) => {
    cursorListeners.current.add(listener);
    listener(lastCursors.current);
    return () => void cursorListeners.current.delete(listener);
  }, []);

  const snapshot = isLive ? live : local;
  const people = isLive ? snapshot.people : [{ id: "local", ...profile, isSelf: true }];
  return { status: isLive ? ("live" as const) : status, error: error ?? account.error, profile, setName, ...snapshot, people, actions, setCursor, onCursors };
}

export type SharedScene = ReturnType<typeof useSharedScene>;

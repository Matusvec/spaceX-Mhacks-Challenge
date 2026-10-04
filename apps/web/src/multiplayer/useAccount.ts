import { useCallback, useEffect, useState } from "react";
import { setTeamCode } from "../config/backend";
import { errorText, openLink, type Link } from "./connection";
import type { ConnectionStatus } from "./types";

// If the server has not answered by then, the app opens anyway, unshared ("offline"); it keeps trying.
const CONNECT_TIMEOUT_MS = 4000;
const FORM_KEY = "pss.account"; // the name typed last time; never the access code

export type Organisation = { id: string; name: string };
export type Member = { name: string; orgId: string; orgName: string };
// Someone who is in a scene right now (presence: the public `user` table). `sceneId` may carry a "#room".
export type LivePerson = { id: string; name: string; color: string; sceneId: string };
type Tables = { organisations: Organisation[]; member: Member | null; sceneIds: string[]; live: LivePerson[] };
const NONE: Tables = { organisations: [], member: null, sceneIds: [], live: [] };

// ?solo=1 never contacts the session server: for screenshot tools and for working alone on purpose.
const SOLO = new URLSearchParams(window.location.search).has("solo");

function read({ conn, identity }: Link): Tables {
  const organisations = [...conn.db.organisation.iter()].map(({ id, name }) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  const mine = [...conn.db.member.iter()].find((m) => m.identity.isEqual(identity));
  return {
    organisations,
    member: mine ? { name: mine.name, orgId: mine.orgId, orgName: organisations.find((o) => o.id === mine.orgId)?.name ?? mine.orgId } : null,
    // The my_scenes view: the server only sends the rows of this identity's own organisation.
    sceneIds: [...conn.db.myScenes.iter()].map((row) => row.sceneId).sort(),
    live: [...conn.db.user.iter()]
      .filter((u) => u.online && u.activeSceneId)
      .map((u) => ({ id: u.identity.toHexString(), name: u.name, color: u.color, sceneId: u.activeSceneId }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export function rememberedName(): string {
  try {
    return String(JSON.parse(localStorage.getItem(FORM_KEY) ?? "{}").name ?? "");
  } catch {
    return "";
  }
}

/**
 * The signed-in person. The account is this browser's SpacetimeDB identity; membership of an organisation
 * (a row in `member`, written only by the sign_in reducer after it checked the access code) decides which
 * scenes are listed and which shared state the server lets this identity touch.
 */
export function useAccount() {
  const [link, setLink] = useState<Link | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>(SOLO ? "offline" : "connecting");
  const [error, setError] = useState<string | null>(null);
  const [tables, setTables] = useState<Tables>(NONE);

  useEffect(() => {
    if (SOLO) return;
    const giveUp = setTimeout(() => setStatus((s) => (s === "connecting" ? "offline" : s)), CONNECT_TIMEOUT_MS);
    const close = openLink((next, err) => {
      // Dev-only handle for shots/two-clients.mjs: lets the test call a reducer the UI would never offer.
      if (import.meta.env.DEV) (window as unknown as { __spacetime?: unknown }).__spacetime = next?.conn;
      setLink(next);
      setTables(next ? read(next) : NONE);
      setStatus(next ? "live" : "offline");
      setError(err);
    });
    return () => {
      clearTimeout(giveUp);
      close();
    };
  }, []);

  useEffect(() => {
    if (!link) return;
    const refresh = () => setTables(read(link));
    const watched = [link.conn.db.organisation, link.conn.db.member, link.conn.db.myScenes, link.conn.db.user] as const;
    for (const table of watched) {
      table.onInsert(refresh);
      table.onDelete(refresh);
    }
    link.conn.db.organisation.onUpdate(refresh);
    link.conn.db.member.onUpdate(refresh);
    link.conn.db.user.onUpdate(refresh);
    return () => {
      link.conn.db.user.removeOnUpdate(refresh);
      for (const table of watched) {
        table.removeOnInsert(refresh);
        table.removeOnDelete(refresh);
      }
      link.conn.db.organisation.removeOnUpdate(refresh);
      link.conn.db.member.removeOnUpdate(refresh);
    };
  }, [link]);

  /** The access code alone picks the organisation. Resolves once the server accepted it; rejects with its reason. */
  const enter = useCallback(
    async (name: string, code: string) => {
      if (!link) throw new Error("the session server is not reachable");
      try {
        await link.conn.reducers.enter({ name, code });
      } catch (err) {
        throw new Error(errorText(err));
      }
      setTeamCode(code.trim()); // the same code unlocks the Grok routes (config/backend.ts), so nobody types two
      try {
        localStorage.setItem(FORM_KEY, JSON.stringify({ name: name.trim() }));
      } catch {
        // not remembered; the membership itself lives on the server
      }
    },
    [link],
  );

  const signOut = useCallback(async () => {
    try {
      await link?.conn.reducers.signOut({});
      setTeamCode(""); // signing out also forgets the Grok passcode
    } catch (err) {
      setError(errorText(err));
    }
  }, [link]);

  return { status, error, link, solo: SOLO, ...tables, enter, signOut };
}

export type Account = ReturnType<typeof useAccount>;

import { useCallback, useEffect, useState } from "react";
import { errorText, openLink, type Link } from "./connection";
import type { ConnectionStatus } from "./types";

// If the server has not answered by then, the app opens anyway, unshared ("offline"); it keeps trying.
const CONNECT_TIMEOUT_MS = 4000;
const FORM_KEY = "pss.account"; // name and organisation typed last time; never the access code

export type Organisation = { id: string; name: string };
export type Member = { name: string; orgId: string; orgName: string };
type Tables = { organisations: Organisation[]; member: Member | null; sceneIds: string[] };
const NONE: Tables = { organisations: [], member: null, sceneIds: [] };

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
  };
}

export function rememberedForm(): { name: string; orgId: string } {
  try {
    return { name: "", orgId: "", ...JSON.parse(localStorage.getItem(FORM_KEY) ?? "{}") };
  } catch {
    return { name: "", orgId: "" };
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
    const watched = [link.conn.db.organisation, link.conn.db.member, link.conn.db.myScenes] as const;
    for (const table of watched) {
      table.onInsert(refresh);
      table.onDelete(refresh);
    }
    link.conn.db.organisation.onUpdate(refresh);
    link.conn.db.member.onUpdate(refresh);
    return () => {
      for (const table of watched) {
        table.removeOnInsert(refresh);
        table.removeOnDelete(refresh);
      }
      link.conn.db.organisation.removeOnUpdate(refresh);
      link.conn.db.member.removeOnUpdate(refresh);
    };
  }, [link]);

  /** Resolves once the server accepted the code; rejects with the server's reason (shown on the form). */
  const signIn = useCallback(
    async (name: string, orgId: string, code: string) => {
      if (!link) throw new Error("the session server is not reachable");
      try {
        await link.conn.reducers.signIn({ name, orgId, code });
      } catch (err) {
        throw new Error(errorText(err));
      }
      try {
        localStorage.setItem(FORM_KEY, JSON.stringify({ name: name.trim(), orgId }));
      } catch {
        // not remembered; the membership itself lives on the server
      }
    },
    [link],
  );

  const signOut = useCallback(async () => {
    try {
      await link?.conn.reducers.signOut({});
    } catch (err) {
      setError(errorText(err));
    }
  }, [link]);

  return { status, error, link, solo: SOLO, ...tables, signIn, signOut };
}

export type Account = ReturnType<typeof useAccount>;

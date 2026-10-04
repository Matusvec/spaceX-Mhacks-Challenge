import type { Identity } from "spacetimedb";
import { DbConnection, tables } from "./module_bindings";

// One-line switch to the hosted cloud: VITE_SPACETIME_URI=wss://maincloud.spacetimedb.com
// The default follows the page's host, so a second laptop that opens this app also finds the server.
export const SPACETIME_URI = import.meta.env.VITE_SPACETIME_URI ?? `ws://${window.location.hostname}:3000`;
export const SPACETIME_MODULE = import.meta.env.VITE_SPACETIME_MODULE ?? "pss-studio";

const RETRY_MS = 4000;
const TOKEN_KEY = `pss.spacetime.token.${SPACETIME_URI}/${SPACETIME_MODULE}`;

// The token is this browser's Spacetime identity, and the identity is the account: kept in localStorage,
// so a person stays signed in. A URL with ?name= gets a per-tab identity instead (sessionStorage), so
// two demo tabs on one laptop can be two different people.
function tokenStore(): Storage | null {
  try {
    return new URLSearchParams(window.location.search).has("name") ? sessionStorage : localStorage;
  } catch {
    return null; // storage blocked: every load is a new identity
  }
}

/** One open, subscribed connection: the account tables (organisations, members, my scenes, people) are in `conn.db`. */
export type Link = { conn: DbConnection; identity: Identity };

export const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Keeps one connection to SpacetimeDB open for the life of the app, retrying when it drops.
 * `onChange(link, error)` gets the link once the account tables are in, and null when it is lost.
 */
export function openLink(onChange: (link: Link | null, error: string | null) => void): () => void {
  let conn: DbConnection | null = null;
  let closed = false;
  let live = false;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;

  const drop = (error: string) => {
    if (closed) return;
    live = false;
    conn = null;
    onChange(null, error);
    clearTimeout(retryTimer);
    retryTimer = setTimeout(open, RETRY_MS);
  };

  function open(): void {
    if (closed) return;
    try {
      conn = DbConnection.builder()
        .withUri(SPACETIME_URI)
        .withDatabaseName(SPACETIME_MODULE)
        .withToken(tokenStore()?.getItem(TOKEN_KEY) ?? undefined)
        .onConnect((connection, identity, token) => {
          if (closed) return connection.disconnect();
          tokenStore()?.setItem(TOKEN_KEY, token);
          connection
            .subscriptionBuilder()
            .onApplied(() => {
              live = true;
              onChange({ conn: connection, identity }, null);
            })
            .onError(() => drop("the session server refused the account subscription (is the module up to date?)"))
            .subscribe([tables.organisation, tables.member, tables.user, tables.myScenes]);
        })
        .onConnectError((_ctx, err) => {
          // The token is the account: keep it through an unreachable server. Only a token the server
          // refuses (one issued by a different server) is dropped, so the next try gets a fresh identity.
          if (/401|403|unauthori[sz]ed|invalid token/i.test(errorText(err))) tokenStore()?.removeItem(TOKEN_KEY);
          drop(`cannot reach ${SPACETIME_URI}: ${errorText(err)}`);
        })
        .onDisconnect(() => drop(live ? "connection lost, retrying" : `cannot reach ${SPACETIME_URI}, retrying`))
        .build();
    } catch (err) {
      drop(errorText(err));
    }
  }
  open();

  return () => {
    closed = true;
    clearTimeout(retryTimer);
    conn?.disconnect();
    conn = null;
  };
}

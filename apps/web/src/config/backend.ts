// Where the Grok routes live, and the team passcode that a public deployment asks for.
//   Local dev: VITE_BACKEND_URL points at apps/backend (http://localhost:8000); no passcode unless TEAM_CODE is set there.
//   Deployed build (VITE_SAME_ORIGIN=1, scripts/deploy_vercel.sh): functions on the page's own origin, under /api.

const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL ?? "").replace(/\/$/, "");

export const SAME_ORIGIN = import.meta.env.VITE_SAME_ORIGIN === "1";
export const API_BASE = SAME_ORIGIN ? "/api" : BACKEND_URL;
export const hasApi = SAME_ORIGIN || BACKEND_URL !== "";

const STORAGE_KEY = "pss-team-code";
const listeners = new Set<() => void>();

function readStored(): string {
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return ""; // storage blocked: the passcode then lasts until the page is closed
  }
}

let teamCode = readStored();

export function getTeamCode(): string {
  return teamCode;
}

/** Remembers the team passcode in this browser and tells subscribers (the Grok status check) to look again. */
export function setTeamCode(code: string): void {
  teamCode = code;
  try {
    window.localStorage.setItem(STORAGE_KEY, code);
  } catch {
    // Storage blocked: kept in memory only.
  }
  listeners.forEach((listener) => listener());
}

export function subscribeTeamCode(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** fetch() against the Grok routes, with the team passcode attached when one is stored. */
export function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (teamCode) headers.set("X-Team-Code", teamCode);
  return fetch(`${API_BASE}${path}`, { ...init, headers });
}

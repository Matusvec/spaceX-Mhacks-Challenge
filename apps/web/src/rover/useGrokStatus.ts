import { useSyncExternalStore } from "react";
import { apiFetch, getTeamCode, hasApi, subscribeTeamCode } from "../config/backend";
import "./grok.css";

export type GrokStatus = "checking" | "ready" | "locked" | "no-key" | "offline" | "no-backend";

export const GROK_STATUS_TEXT: Record<GrokStatus, string> = {
  checking: "checking Grok…",
  ready: "Grok connected",
  locked: "Grok locked: team passcode needed",
  "no-key": "Grok off (no API key): local reader",
  offline: "backend offline: local reader",
  "no-backend": "no backend: local reader",
};

const POLL_MS = 15000;

// One shared check for the whole page (the chat header and the concept section both show it).
// `rejected`: a passcode is stored but the server did not accept it.
type Snapshot = { status: GrokStatus; rejected: boolean };
let snapshot: Snapshot = { status: hasApi ? "checking" : "no-backend", rejected: false };
const listeners = new Set<() => void>();
let stop: (() => void) | null = null;

async function check(): Promise<void> {
  let status: GrokStatus = "offline";
  try {
    const response = await apiFetch("/health");
    if (response.ok) {
      const health = (await response.json()) as { grok_configured?: boolean; team_code_required?: boolean; team_code_ok?: boolean };
      status = !health.grok_configured ? "no-key" : health.team_code_required && !health.team_code_ok ? "locked" : "ready";
    }
  } catch {
    // Stays "offline": shown in the chat header.
  }
  const rejected = status === "locked" && getTeamCode() !== "";
  if (status === snapshot.status && rejected === snapshot.rejected) return;
  snapshot = { status, rejected };
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!stop && hasApi) {
    void check();
    // Polled, because the key or passcode can be set while the app runs (it also keeps a serverless function warm).
    const timer = window.setInterval(() => void check(), POLL_MS);
    const unsubscribe = subscribeTeamCode(() => void check());
    stop = () => {
      window.clearInterval(timer);
      unsubscribe();
    };
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && stop) {
      stop();
      stop = null;
    }
  };
}

/** Whether Grok can be used from this page, from the backend's /health. */
export function useGrokAccess(): Snapshot {
  return useSyncExternalStore(subscribe, () => snapshot);
}

export function useGrokStatus(): GrokStatus {
  return useGrokAccess().status;
}

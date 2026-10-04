import { useSyncExternalStore } from "react";
import { interpret } from "../rover/interpret";

// Feasibility notes on a concept render: one Grok text call through the chat's /intent path, grounded in the
// same scene facts the chat sends (site scores, placed modules, layers). Kept in this browser only; never shared.
export const FEASIBILITY_HEADING = "Feasibility notes by Grok, from this site's scores. AI assessment, not an engineering review.";
const KEY = "pss-concept-notes";
const REQUEST =
  "Assess how feasible this base idea is at this site, in three or four short sentences. Judge the idea against the " +
  "site's own numbers in the scene facts (slope, flatness, ground to move, rover reach, distance to science, and where " +
  "given sunlight, Earth view and dose): what those numbers support, what they make risky, and what to check because " +
  "the scene has no data on it. Do not invent figures. Idea: ";

function read(): Record<string, string> {
  try {
    return JSON.parse(window.localStorage.getItem(KEY) ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

let notes = read();
const listeners = new Set<() => void>();

/** Asks Grok once for notes on render `id`. A failed or ungrounded call (no Grok) stores nothing, so nothing shows. */
export async function assessFeasibility(id: string, idea: string, sceneId: string, facts: string): Promise<void> {
  if (notes[id]) return;
  const { intent, via } = await interpret(REQUEST + (idea || "a small first outpost"), sceneId, [], facts);
  if (via !== "grok" || intent?.intent !== "answer") return;
  notes = { ...notes, [id]: intent.args.text };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(notes));
  } catch {
    // Storage full or blocked: the notes last until the page is closed.
  }
  listeners.forEach((listener) => listener());
}

export function useFeasibilityNotes(): Record<string, string> {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => notes,
  );
}

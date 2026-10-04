// Chat wording for user pins: "drive to pin 2", "go to my last pin", "add a pin here as outcrop".
// Pure functions (checked by scripts/check-pin-chat.mjs); the rover and the tables are passed in.

export type ChatPin = { note: string; position: { x: number; y: number }; mine: boolean };
export type UserPinContext = { pins: ChatPin[]; add: (x: number, y: number, note: string) => void };
type Target = { x: number; y: number; label: string };

/** The user pin a destination phrase means, or null: by number ("pin 2"), "last pin" / "my pin", or its note. */
export function findUserPin(to: string, pins: ChatPin[]): Target | null {
  const t = to.trim().toLowerCase();
  const at = (index: number): Target | null => {
    const pin = pins[index];
    return pin ? { x: pin.position.x, y: pin.position.y, label: `pin ${index + 1} "${pin.note}"` } : null;
  };
  const number = t.match(/\bpin\s*#?(\d+)\b/)?.[1];
  if (number) return at(Number(number) - 1);
  if (/\b(last|latest|newest|my)\s+pin\b/.test(t)) {
    const mine = pins.map((p) => p.mine).lastIndexOf(true);
    return at(mine >= 0 ? mine : pins.length - 1);
  }
  // Longest note first, so "north outcrop" is not taken for a pin called "north".
  const byNote = pins
    .map((pin, index) => ({ index, note: pin.note.trim().toLowerCase() }))
    .filter(({ note }) => t === note || (note.length >= 3 && t.includes(note)))
    .sort((a, b) => b.note.length - a.note.length)[0];
  return byNote ? at(byNote.index) : null;
}

/** The note of a "make a pin" request ("" when none was given), or null when the text asks for something else. */
export function pinRequest(text: string): string | null {
  const t = text.trim().replace(/[.!]+$/, "");
  const rest =
    t.match(/^(?:please\s+)?(?:add|drop|place|put|create|make|leave|set)\s+(?:a\s+|another\s+|one\s+more\s+)?(?:new\s+)?pin\b(.*)$/i)?.[1] ??
    t.match(/^(?:please\s+)?(?:pin|mark)\s+((?:this|that|here|the\s+rover|the\s+spot|my\s+position|where)\b.*)$/i)?.[1];
  if (rest === undefined) return null;
  const note = rest.match(/(?:\bas\b|\bcalled\b|\bnamed\b|\blabell?ed\b|\bsaying\b|:)\s*(.+)$/i)?.[1] ?? "";
  return note.replace(/^["'“]|["'”]$/g, "").trim();
}

/** Runs a "make a pin" request at the rover's position. Null when the text is not one. */
export function addPinFromChat(
  text: string,
  userPins: UserPinContext | undefined,
  rover: { x: number; y: number } | null,
): { text: string } | null {
  const note = pinRequest(text);
  if (note === null) return null;
  if (!userPins || !rover) return { text: "I can't drop a pin until the scene has loaded." };
  const label = note || `Rover stop (${rover.x.toFixed(0)}, ${rover.y.toFixed(0)})`;
  userPins.add(rover.x, rover.y, label);
  const number = userPins.pins.length + 1;
  return {
    text: `Pinned "${label}" where I am, at (${rover.x.toFixed(0)}, ${rover.y.toFixed(0)}) m. It is pin ${number} in My pins: say "drive to pin ${number}" to come back.`,
  };
}

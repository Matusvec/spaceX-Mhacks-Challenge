// Self-check for the user-pin chat wording. Run: node apps/web/scripts/check-pin-chat.mjs
import assert from "node:assert/strict";
import { findUserPin, pinRequest } from "../src/multiplayer/pinChat.ts";
import { interpretLocally } from "../src/rover/localInterpreter.ts";

const pins = [
  { note: "north", position: { x: 1, y: 1 }, mine: true },
  { note: "North outcrop", position: { x: 2, y: 2 }, mine: false },
  { note: "sample spot", position: { x: 3, y: 3 }, mine: true },
  { note: "Ada's rock", position: { x: 4, y: 4 }, mine: false },
];
assert.equal(findUserPin("pin 2", pins).x, 2);
assert.equal(findUserPin("pin #4", pins).x, 4);
assert.equal(findUserPin("pin 9", pins), null);
assert.equal(findUserPin("my last pin", pins).x, 3, "last pin that is mine");
assert.equal(findUserPin("the latest pin", [pins[0], pins[1]]).x, 1);
assert.equal(findUserPin("the north outcrop", pins).x, 2, "longest note wins");
assert.equal(findUserPin("site 2", pins), null);
assert.equal(findUserPin("home", pins), null);
assert.equal(findUserPin("my last pin", []), null);

assert.equal(pinRequest("add a pin here"), "");
assert.equal(pinRequest("Add a pin here as sample spot."), "sample spot");
assert.equal(pinRequest("pin this spot as \"layered rock\""), "layered rock");
assert.equal(pinRequest("drop a pin called Camp 1"), "Camp 1");
assert.equal(pinRequest("drive to pin 2"), null);
assert.equal(pinRequest("pin 2"), null);
assert.equal(pinRequest("place a habitat at site 1"), null);

// The local reader must hand the destination phrase through for the drive wording we advertise.
for (const [text, to] of [["drive to pin 2", "pin 2"], ["Go to my last pin", "my last pin"], ["drive to sample spot", "sample spot"]]) {
  const intent = interpretLocally(text);
  assert.equal(intent?.intent, "show_path", text);
  assert.equal(intent.args.to, to, text);
  assert.ok(findUserPin(intent.args.to, pins), text);
}
console.log("pin chat: ok");

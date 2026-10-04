// Two (or three) browsers in one shared session: the proof that sign-in, scene access, pins, cursors, modules
// and rover drives go through SpacetimeDB. Each person is its own headless Chromium. No dependencies (Node 22+).
// Usage: node shots/two-clients.mjs [sceneId]     accounts, then the shared scene; writes shots/mp-*.png
//        MODE=accounts | shared | offline         one part only. MODE=offline needs a server you can stop:
//          it prints ">>> stop" and ">>> start" when to stop and start `spacetime start`.
// Env: APP_URL (default http://127.0.0.1:5199), CODES_FILE (default ~/.config/pss-studio/org-codes-pss-studio-mhacks.env,
//      written by spacetime/seed-orgs.sh), ROOM, GL=hw|sw.
import { accountsScenario } from "./mp-accounts.mjs";
import { loadCodes, open, sleep } from "./mp-browser.mjs";

const sceneId = process.argv[2] ?? "mars-hero-01";
const codes = loadCodes();

const EYE = [75, -170, 120];
const TARGET = [75, 20, 0];
const clients = [];
const hideGrade = (c) =>
  c.evaluate(`(() => { const box = [...document.querySelectorAll("label.checkbox")].find((l) => l.textContent.includes("Show grade"))?.querySelector("input");
    if (box?.checked) box.click(); })()`);

// A signed-in person loses the server mid-session, keeps working in memory, and is live again when it returns.
async function offlineScenario() {
  const cy = await open("Cy", { scene: sceneId });
  clients.push(cy);
  await cy.signIn(codes.control);
  await cy.until(/live 1\b/i, "the live chip", 120000);
  await cy.until(/Best sites[\s\S]*Site 1/i, "the scene to load", 120000);
  console.log(">>> stop the Spacetime server now");
  await cy.until(/offline: access not checked, not shared/, "the offline chip", 120000);
  await hideGrade(cy);
  await cy.view(EYE, TARGET);
  await cy.scrollToShared();
  await cy.click("Add pin");
  await sleep(300);
  await cy.mouse(700, 560, true);
  await sleep(400);
  await cy.type(".pin-form input", "Offline pin");
  await sleep(100);
  await cy.click("Save pin");
  await cy.until(/Offline pin/, "the pin in the list while offline");
  console.log("offline       Cy:", await cy.chat("drive to pin 1"));
  await sleep(1500);
  console.log("offline       Cy:", await cy.section());
  await cy.shoot("mp-offline-1-works-locally.png");
  console.log(">>> start the Spacetime server now");
  await cy.until(/live 1\b/i, "the chip to go live once the server is back", 120000);
  await cy.until(/Offline pin/, "the offline pin to come back from the table");
  await sleep(1000);
  console.log("back online   Cy:", await cy.section());
  await cy.shoot("mp-offline-2-live-again.png");
  console.log("offline: ok");
}

try {
  const mode = process.env.MODE ?? "all";
  if (mode === "offline") await offlineScenario();
  if (mode === "accounts" || mode === "all") await accountsScenario(codes, clients);
  if (mode === "shared" || mode === "all") await sharedScenario();
} finally {
  for (const c of clients) c.close();
}

async function sharedScenario() {
  // Two organisations that both have this scene: Ada from NASA, Ben from mission control.
  const [ada, ben] = await Promise.all([open("Ada", { scene: sceneId }), open("Ben", { scene: sceneId })]);
  clients.push(ada, ben);
  await ada.signIn(codes.nasa);
  await ben.signIn(codes.control);
  for (const c of clients) await c.until(/live 2\b/i, "the live chip with both people", 120000);
  for (const c of clients) {
    await hideGrade(c);
    await c.view(EYE, TARGET);
    await c.scrollToShared();
  }
  await sleep(2500);
  console.log("1. presence   Ada:", await ada.section());

  // 2. Ada's mouse over the terrain: Ben sees her cursor and name.
  for (let i = 0; i < 6; i++) {
    await ada.mouse(820 + i * 12, 520 + i * 6);
    await sleep(120);
  }
  await sleep(600);
  await ben.shoot("mp-1-ben-sees-ada-cursor.png");

  // 3. Ada adds a pin with the button; it appears in Ben's list and scene.
  await ada.click("Add pin");
  await sleep(300);
  await ada.mouse(980, 560, true);
  await sleep(400);
  await ada.type(".pin-form input", "Layered outcrop");
  await sleep(100);
  await ada.click("Save pin");
  await ben.until(/Layered outcrop/, "Ada's pin in Ben's list");
  console.log("3. pin        Ben:", await ben.section());

  // 4. Ben adds one through the chat, at the rover; Ada sees it.
  console.log("4. chat       Ben:", await ben.chat("add a pin here as Rover start"));
  await ada.until(/Rover start/, "Ben's chat pin in Ada's list");
  await sleep(800);
  await ada.shoot("mp-2-ada-sees-both-pins.png");
  await ben.shoot("mp-2-ben-sees-both-pins.png");

  // 4b. Team chat: Ada writes, Ben reads it (people to people, not the rover assistant).
  await ada.type('input[name="team-chat"]', "Ben, meet me at the outcrop");
  await sleep(100);
  await ada.evaluate(`document.querySelector(".team-chat-input").requestSubmit()`);
  // Ben's team chat window starts minimized: its bar counts the unread line, then he opens it.
  await ben.until(/Team chat[\s\S]{0,40}1 new/i, "an unread count on Ben's minimized team chat");
  await ben.shoot("mp-7a-ben-team-chat-unread.png");
  await ben.evaluate(`document.querySelector('button[aria-label="Open team chat"]')?.click()`);
  await ben.until(/Ben, meet me at the outcrop/, "Ada's chat line on Ben's screen");
  await sleep(300);
  await ben.shoot("mp-7-ben-team-chat.png");
  console.log("4b. chat      Ben:", await ben.evaluate(`document.querySelector(".team-chat-messages").innerText.replace(/\\s+/g, " ")`));

  // 4c. Shared concept: Ada shares a picture of her view with its camera pose (a stand-in for a Grok render,
  //     same size and path as a real one: a 1024 px JPEG in the table row); Ben gets it, pinned, and opens it.
  const sharedSize = await ada.evaluate(`(async () => {
    const view = window.__sceneRoot.captureView();
    const canvas = document.createElement("canvas");
    canvas.width = 1024; canvas.height = Math.round(1024 * view.height / view.width);
    canvas.getContext("2d").drawImage(view, 0, 0, canvas.width, canvas.height);
    const image = canvas.toDataURL("image/jpeg", 0.75);
    const pose = window.__sceneRoot.lastCapturedPose();
    const room = new URLSearchParams(location.search).get("room");
    await window.__spacetime.reducers.shareConcept({ sceneId: "${sceneId}#" + room, renderId: "test-" + Date.now(), idea: "Three domes by the outcrop",
      prompt: "test picture, not a Grok render", poseJson: JSON.stringify(pose), image });
    return Math.round(image.length / 1024);
  })()`);
  await ben.until(/Three domes by the outcrop · by Ada/, "Ada's shared concept in Ben's Concepts list", 30000);
  await ben.evaluate(`[...document.querySelectorAll(".concept-list li")].find((li) => li.innerText.includes("by Ada")).querySelector("button").click()`);
  await sleep(2500);
  await ben.shoot("mp-8-ben-opens-ada-concept.png");
  console.log(`4c. concept   Ben: sees and opens Ada's concept (picture ${sharedSize} KB in the row)`);
  await ben.evaluate(`window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))`);
  await sleep(500);

  // 5. Ada drives the rover to pin 1 through the chat; Ben's rover drives too.
  console.log("5. drive      Ada:", await ada.chat("drive to pin 1"));
  await ben.until(/driving \(sped up\)/, "the drive to start on Ben's screen", 15000);
  await sleep(1500);
  await ben.shoot("mp-3-ben-rover-driving.png");
  await ada.shoot("mp-3-ada-rover-driving.png");
  for (const c of clients) await c.until(/Status\s*arrived/, "the rover to arrive", 180000);
  const at = (c) => c.evaluate(`document.body.innerText.match(/At \\((-?\\d+), (-?\\d+)\\) m/)?.[0]`);
  console.log("5. arrived    Ada:", await at(ada), "| Ben:", await at(ben));
  await ben.shoot("mp-4-ben-rover-arrived.png");

  // 6. Ben places a habitat through the chat; Ada gets the module and its score.
  console.log("6. module     Ben:", await ben.chat("place a habitat at site 1"));
  await ada.until(/placed modules[\s\S]*Habitat · grade \d+/i, "Ben's module in Ada's list");
  await sleep(1000);
  for (const c of clients) await c.scrollToShared();
  console.log("6. module     Ada:", await ada.section());
  await ada.shoot("mp-5-ada-sees-ben-module.png");

  // 6b. Ben moves it (same type: move_module), then swaps the type (delete + place); Ada follows both.
  await ben.chat("place a habitat at site 3");
  await ada.until(/Habitat · grade \d+\s*\(-15, -50\) m/, "the moved module on Ada's screen");
  await ben.chat("place a greenhouse dome at site 1");
  await ada.until(/Greenhouse dome · grade \d+\s*\(-?\d+, -?\d+\) m · Ben/, "the swapped module on Ada's screen");
  console.log("6b. moved+swapped Ada:", (await ada.section()).match(/PLACED MODULES.*/i)?.[0]);

  // 7. Both screens from above with the chat minimized: the same pins, rover and module.
  for (const c of clients) {
    await c.evaluate(`document.querySelector('button[aria-label="Minimize chat"]')?.click()`);
    await c.view([40, -330, 230], [40, -50, 0]);
  }
  await sleep(2500);
  await ada.shoot("mp-6-ada-overview.png");
  await ben.shoot("mp-6-ben-overview.png");

  // 8. Ben resets the rover: Ada's goes home too. Ada deletes pin 2: gone on Ben's screen.
  await ben.click("Reset rover");
  await ada.until(/At \(0, 0\) m/, "the reset rover on Ada's screen", 15000);
  await ada.evaluate(`[...document.querySelectorAll(".user-pins li")].find((li) => li.innerText.includes("Rover start")).querySelector("button:last-child").click()`);
  await sleep(1500);
  if (/Rover start/.test(await ben.section())) throw new Error("Ben still lists the pin Ada deleted");
  console.log("8. reset+delete Ben:", await ben.section());

  // 9. A third person on the scene list sees who is live in the Mars scene, by name.
  const zoe = await open("Zoe");
  clients.push(zoe);
  await zoe.signIn(codes.control);
  await zoe.until(/2 live\s*Ada\s*Ben/i, "Ada and Ben shown live on Zoe's Mars card");
  await sleep(500);
  await zoe.shoot("mp-acc-6-scenes-two-live.png");
  console.log("9. presence   Zoe:", (await zoe.text()).match(/2 live\s*Ada\s*Ben/i)?.[0].replace(/\s+/g, " "));
  console.log("two clients: ok");
}

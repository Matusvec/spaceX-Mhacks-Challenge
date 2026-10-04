// One real Grok Imagine render on the deployed site, shared to a teammate through SpacetimeDB, plus a chat line.
// Usage: APP_URL=https://planetary-scene-studio.vercel.app node shots/mp-live-concept.mjs   (costs one render)
import { loadCodes, open, sleep } from "./mp-browser.mjs";

const codes = loadCodes();
const clients = [];
try {
  const [ada, ben] = await Promise.all([open("Ada", { scene: "mars-hero-01" }), open("Ben", { scene: "mars-hero-01" })]);
  clients.push(ada, ben);
  await ada.signIn(codes.control);
  await ben.signIn(codes.nasa);
  for (const c of clients) {
    await c.until(/live[,\s]+2/i, "both people live", 120000);
    await c.until(/Site 1/i, "the scene to load", 120000);
  }
  await sleep(4000);

  await ada.type('input[name="team-chat"]', "Rendering a concept now, watch your Concepts list");
  await sleep(100);
  await ada.evaluate(`document.querySelector(".team-chat-input").requestSubmit()`);
  await ben.evaluate(`document.querySelector('button[aria-label="Open team chat"]')?.click()`);
  await ben.until(/Rendering a concept now/, "Ada's chat line on Ben's screen");
  await sleep(400);
  await ben.shoot("mp-live-1-ben-team-chat.png");

  await ada.evaluate(`(() => { const box = [...document.querySelectorAll("textarea")][0];
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(box, "two domes and a landing pad");
    box.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  await sleep(200);
  const t0 = Date.now();
  await ada.click("Concept render");
  try {
    await ben.until(/two domes and a landing pad · by Ada/, "Ada's real render in Ben's Concepts list", 90000);
  } catch (err) {
    await ada.shoot("mp-live-fail-ada.png");
    console.log("Ada's page:", (await ada.text()).replace(/\s+/g, " ").slice(0, 1500));
    throw err;
  }
  console.log(`render shared and received after ${Math.round((Date.now() - t0) / 1000)} s`);
  await ben.evaluate(`[...document.querySelectorAll(".concept-list li")].find((li) => li.innerText.includes("by Ada")).querySelector("button").click()`);
  await sleep(3000);
  await ben.shoot("mp-live-2-ben-opens-real-concept.png");
  await ada.shoot("mp-live-2-ada-after-render.png");
  console.log("live concept: ok");
} finally {
  for (const c of clients) c.close();
}

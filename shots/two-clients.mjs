// Two browsers in one shared session: the proof that pins, cursors, modules and rover drives sync through
// SpacetimeDB. Each is its own headless Chromium (own profile), named Ada and Ben. No dependencies (Node 22+).
// Usage: node shots/two-clients.mjs [sceneId]        writes shots/mp-*.png and prints what each client sees.
//        MODE=offline node shots/two-clients.mjs    one client, started while the Spacetime server is DOWN:
//          it must work in memory ("offline, not shared"); start the server while it waits and it goes live
//          and sends its pin up (shots/mp-offline-*.png).
// Env: APP_URL (default http://127.0.0.1:5199), GL=hw|sw. Needs the app's dev server and `spacetime start`.
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const sceneId = process.argv[2] ?? "mars-hero-01";
const APP_URL = process.env.APP_URL ?? "http://127.0.0.1:5199";
const OUT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOM = process.env.ROOM ?? `test-${Date.now()}`; // its own session, so a person using the app is not disturbed
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const glFlags =
  process.env.GL === "sw" ? ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] : ["--use-angle=gl-egl", "--ignore-gpu-blocklist", "--enable-gpu"];

async function open(name) {
  const chromium = spawn("/usr/lib/chromium/chromium", [
    "--headless=new", "--remote-debugging-port=0", "--window-size=1600,1000", "--hide-scrollbars",
    `--user-data-dir=${mkdtempSync(join(tmpdir(), "pss-mp-"))}`, ...glFlags, "about:blank",
  ]);
  const port = await new Promise((resolve, reject) => {
    chromium.stderr.on("data", (chunk) => {
      const match = /DevTools listening on ws:\/\/[^:]+:(\d+)\//.exec(String(chunk));
      if (match) resolve(match[1]);
    });
    chromium.on("exit", (code) => reject(new Error(`chromium exited ${code}`)));
  });
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
  await new Promise((resolve) => ws.addEventListener("open", resolve));
  let nextId = 0;
  const pending = new Map();
  ws.addEventListener("message", ({ data }) => {
    const msg = JSON.parse(data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    } else if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
      console.log(`[${name} error]`, msg.params.args.map((a) => a.value ?? a.description).join(" ").slice(0, 300));
    } else if (msg.method === "Runtime.exceptionThrown") {
      console.log(`[${name} exception]`, msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      pending.set(++nextId, { resolve, reject });
      ws.send(JSON.stringify({ id: nextId, method, params }));
    });
  const evaluate = async (expression) => {
    const { result, exceptionDetails } = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
    return result.value;
  };
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: `${APP_URL}/?scene=${encodeURIComponent(sceneId)}&name=${name}&room=${ROOM}` });

  const client = {
    name,
    evaluate,
    text: () => evaluate("document.body.innerText"),
    // Waits until the page text matches; fails loudly with what the page says instead.
    async until(pattern, what, timeoutMs = 60000) {
      const t0 = Date.now();
      while (Date.now() - t0 < timeoutMs) {
        if (pattern.test(await client.text())) return;
        await sleep(250);
      }
      throw new Error(`${name}: timed out waiting for ${what}. Shared panel says: ${await client.section()}`);
    },
    section: () => evaluate(`(document.querySelector("section.shared")?.innerText ?? "no shared panel").replace(/\\s+/g, " ")`),
    async shoot(file) {
      const { data } = await send("Page.captureScreenshot", { format: "png" });
      writeFileSync(join(OUT_DIR, file), Buffer.from(data, "base64"));
      console.log("wrote", join(OUT_DIR, file));
    },
    click: (label) =>
      evaluate(`(() => { const b = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === ${JSON.stringify(label)});
        if (!b) throw new Error("no button " + ${JSON.stringify(label)}); b.click(); })()`),
    type: (selector, value) =>
      evaluate(`(() => { const input = document.querySelector(${JSON.stringify(selector)});
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, ${JSON.stringify(value)});
        input.dispatchEvent(new Event("input", { bubbles: true })); })()`),
    async chat(message) {
      await client.type(".chat-input input", message);
      await sleep(100);
      await evaluate(`document.querySelector(".chat-input").requestSubmit()`);
      await sleep(900);
      return evaluate(`[...document.querySelectorAll(".chat-message.from-rover .chat-text")].pop()?.innerText`);
    },
    // A real mouse at viewport pixel (x, y): moves, and presses when asked.
    async mouse(x, y, press = false) {
      await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
      if (!press) return;
      await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
      await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
    },
    view: (eye, target) => evaluate(`window.__sceneRoot.setViewSite(${JSON.stringify(eye)}, ${JSON.stringify(target)})`),
    scrollToShared: () => evaluate(`document.querySelector("section.shared").scrollIntoView()`),
    close() {
      ws.close();
      chromium.kill();
    },
  };
  return client;
}

const EYE = [75, -170, 120];
const TARGET = [75, 20, 0];
const clients = [];
const hideGrade = (c) =>
  c.evaluate(`(() => { const box = [...document.querySelectorAll("label.checkbox")].find((l) => l.textContent.includes("Show grade"))?.querySelector("input");
    if (box?.checked) box.click(); })()`);

async function offlineScenario() {
  const cy = await open("Cy");
  clients.push(cy);
  await cy.until(/offline, not shared/, "the offline chip", 120000);
  await cy.until(/Best sites[\s\S]*Site 1/i, "the scene to load", 120000);
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
  await cy.until(/live, 1 person/, "the chip to go live once the server is back", 120000);
  await cy.until(/Offline pin/, "the offline pin to come back from the table");
  await sleep(1000);
  console.log("back online   Cy:", await cy.section());
  await cy.shoot("mp-offline-2-live-again.png");
  console.log("offline: ok");
}

try {
  if (process.env.MODE === "offline") await offlineScenario();
  else await sharedScenario();
} finally {
  for (const c of clients) c.close();
}

async function sharedScenario() {
  const [ada, ben] = await Promise.all([open("Ada"), open("Ben")]);
  clients.push(ada, ben);
  for (const c of clients) await c.until(/live, 2 people/, "the live chip with both people", 120000);
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
  console.log("two clients: ok");
}

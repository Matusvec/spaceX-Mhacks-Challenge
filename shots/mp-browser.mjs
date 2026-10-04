// The headless browser used by shots/two-clients.mjs: one Chromium per person, driven over the DevTools protocol.
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const APP_URL = process.env.APP_URL ?? "http://127.0.0.1:5199";
export const ROOM = process.env.ROOM ?? `test-${Date.now()}`; // its own session, so a person using the app is not disturbed
const OUT_DIR = dirname(fileURLToPath(import.meta.url));
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const glFlags =
  process.env.GL === "sw" ? ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] : ["--use-angle=gl-egl", "--ignore-gpu-blocklist", "--enable-gpu"];

/** The organisations' access codes, from the file spacetime/seed-orgs.sh wrote outside the repo. */
export function loadCodes() {
  const file = process.env.CODES_FILE ?? join(homedir(), ".config/pss-studio/org-codes-pss-studio-mhacks.env");
  const codes = Object.fromEntries(readFileSync(file, "utf8").trim().split("\n").map((line) => line.split("=")));
  return { nasa: codes.PSS_CODE_NASA, spacex: codes.PSS_CODE_SPACEX, control: codes.PSS_CODE_CONTROL };
}

/** Opens the app in its own headless Chromium as `name` (a per-tab identity). `scene` deep-links to a scene. */
export async function open(name, { scene = null } = {}) {
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
  const urlFor = (sceneId) => `${APP_URL}/?name=${name}&room=${ROOM}${sceneId ? `&scene=${encodeURIComponent(sceneId)}` : ""}`;
  await send("Page.navigate", { url: urlFor(scene) });

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
      throw new Error(`${name}: timed out waiting for ${what}. The page says: ${(await client.text()).replace(/\s+/g, " ").slice(0, 500)}`);
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
    // Same tab, new address: the tab keeps its identity (sessionStorage), like a person pasting a link.
    navigate: (sceneId) => send("Page.navigate", { url: urlFor(sceneId) }),
    select: (selector, value) =>
      evaluate(`(() => { const select = document.querySelector(${JSON.stringify(selector)});
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(select, ${JSON.stringify(value)});
        select.dispatchEvent(new Event("change", { bubbles: true })); })()`),
    // Fills the sign-in form the way a person would.
    // The landing page: the access code alone picks the organisation.
    async signIn(code) {
      await client.until(/Live session by SpacetimeDB · \d+/, "the landing page, connected");
      await client.type('input[name="signin-name"]', name);
      await client.type('input[name="signin-code"]', code);
      await sleep(150);
      await client.click("Enter");
    },
    sceneCards: () => evaluate(`[...document.querySelectorAll(".scene-card")].map((c) => c.dataset.scene)`),
    close() {
      ws.close();
      chromium.kill();
    },
  };
  return client;
}

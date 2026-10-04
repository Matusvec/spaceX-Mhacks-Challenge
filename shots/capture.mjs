// Screenshots the viewer with headless Chromium over the DevTools protocol. No dependencies (Node 22+).
// Usage: node shots/capture.mjs <sceneId> <prefix> <name>=<ex,ey,ez>/<tx,ty,tz> ...
//   eye and target are site coordinates (m): +X east, +Y north, +Z up.
// Env: APP_URL (default http://127.0.0.1:5199), ROOM (shared-session room, default "shots"; the page opens with &solo=1, unshared and with no sign-in, unless SIGNED_IN=1), GL=hw|sw (default hw), SETTLE_MS (default 2500),
//   HIDE_ROVER=1 removes the rover model (it sits on the site origin, in the middle of the splat),
//   KEEP_GRADE=1 leaves the suitability map on,
//   PRESENTATION=off unticks "Presentation fill" (raw data only),
//   HIDE_PINS=1 hides the science pin markers, KEEP_CHAT=1 leaves the rover chat open,
//   CLICK="<button label>" presses that button and saves <prefix>-clicked.png,
//   SELECT=<option value>[|<value>...] picks options in order in the <select> that has each one,
//   RANGE=<value> sets the first slider; CLICK2=<label start> presses a second button (see below),
//   CAPTURE_VIEW=1 saves <prefix>-captureview.jpg, the image a concept render would send,
//   STEPS=<json> runs a scripted session of [javascript, shot name] pairs in one page (see below),
//   QUERY=<text> runs a text search in the Splat layers panel,
//   PANEL_SHOT=1 saves <prefix>-panel.png with the left panel scrolled to PANEL_Y,
//   SCROLL_PANEL=1 scrolls the left panel to its end,
//   EVAL=<js expression> prints its JSON value once the scene has loaded,
//   UNCAPPED=1 turns vsync off so the fps figures show headroom above 60.
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const [sceneId, prefix, ...viewArgs] = process.argv.slice(2);
if (!sceneId || !prefix) throw new Error("usage: capture.mjs <sceneId> <prefix> <name>=<eye>/<target> ...");
const APP_URL = process.env.APP_URL ?? "http://127.0.0.1:5199";
const SIZE = (process.env.SIZE ?? "1600x1000").split("x").map(Number); // window size, for example SIZE=1366x768
const SETTLE_MS = Number(process.env.SETTLE_MS ?? 2500);
const OUT_DIR = dirname(fileURLToPath(import.meta.url));
const views = viewArgs.map((arg) => {
  const [name, rest] = arg.split("=");
  const [eye, target] = rest.split("/").map((v) => v.split(",").map(Number));
  return { name, eye, target };
});

const glFlags =
  process.env.GL === "sw"
    ? ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]
    : ["--use-angle=gl-egl", "--ignore-gpu-blocklist", "--enable-gpu"];
const chromium = spawn("/usr/lib/chromium/chromium", [
  "--headless=new", "--remote-debugging-port=0", `--window-size=${SIZE.join(",")}`, "--hide-scrollbars",
  `--user-data-dir=${mkdtempSync(join(tmpdir(), "pss-shot-"))}`, ...glFlags,
  ...(process.env.UNCAPPED === "1" ? ["--disable-gpu-vsync", "--disable-frame-rate-limit"] : []), "about:blank",
]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
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
    } else if (msg.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(msg.params.type)) {
      console.log(`[page ${msg.params.type}]`, msg.params.args.map((a) => a.value ?? a.description).join(" "));
    } else if (msg.method === "Runtime.exceptionThrown") {
      console.log("[page exception]", msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
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
  const shoot = async (name) => {
    const { data } = await send("Page.captureScreenshot", { format: "png" });
    const file = join(OUT_DIR, `${prefix}-${name}.png`);
    writeFileSync(file, Buffer.from(data, "base64"));
    console.log("wrote", file);
  };
  // Frames per second of the app's own render loop, over about two seconds.
  const fps = () =>
    evaluate(`new Promise((done) => { let n = 0; const t0 = performance.now();
      const tick = () => { n++; const dt = performance.now() - t0; dt > 2000 ? done(Math.round(n / dt * 10000) / 10) : requestAnimationFrame(tick); };
      requestAnimationFrame(tick); })`);

  await send("Runtime.enable");
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: SIZE[0], height: SIZE[1], deviceScaleFactor: 1, mobile: false });
  // A shared-session room of its own, so nothing a capture does shows up on other people's screens.
  const ROOM = process.env.ROOM ?? "shots";
  await send("Page.navigate", { url: `${APP_URL}/?scene=${encodeURIComponent(sceneId)}&room=${encodeURIComponent(ROOM)}${process.env.SIGNED_IN === "1" ? "" : "&solo=1"}` });

  // Loaded = terrain is in the scene, every /scenes/ fetch finished, and the splat panel is no longer loading.
  const loadedCheck = `(() => {
    const text = document.body.innerText;
    const fetched = performance.getEntriesByType("resource").filter((e) => e.name.includes("/scenes/"));
    return { text, files: fetched.map((e) => new URL(e.name).host + "/" + e.name.split("/").pop() + ":" + Math.round(e.duration) + "ms"),
      ready: !!window.__sceneRoot && fetched.some((e) => /\\.(jpg|png)$/.test(e.name)) && !/Loading/.test(text) };
  })()`;
  let state;
  for (let i = 0; i < 600; i++) {
    await sleep(500);
    state = await evaluate(loadedCheck);
    if (state.ready || /Could not load/.test(state.text)) break;
  }
  await sleep(SETTLE_MS);
  state = await evaluate(loadedCheck);
  console.log("files:", state.files.join(" "));
  console.log("panel text:", state.text.replace(/\s+/g, " ").slice(0, 600));
  console.log("gl:", await evaluate(`(() => { const gl = document.createElement("canvas").getContext("webgl2");
    const ext = gl && gl.getExtension("WEBGL_debug_renderer_info"); return gl ? gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) : "no webgl2"; })()`));

  if (process.env.STEPS) {
    // A scripted session in one page: a JSON list of [javascript, shot name]. The script is awaited, then
    // <prefix>-<name>.png is saved (no shot for an empty name). "SIZE:1366x768" as the script resizes the window.
    for (const [script, name] of JSON.parse(process.env.STEPS)) {
      if (script.startsWith("SIZE:")) {
        const [width, height] = script.slice(5).split("x").map(Number);
        await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
      } else {
        const result = await evaluate(script);
        if (result !== undefined && result !== null) console.log(`step ${name || "-"}:`, JSON.stringify(result));
      }
      await sleep(SETTLE_MS);
      if (name) await shoot(name);
    }
    ws.close();
    chromium.kill();
    process.exit(0);
  }
  await shoot("default");
  if (process.env.KEEP_UI === "1") views.length = 0; // only the untouched default view
  // The rest are taken with the suitability tint off and the chat minimized, so the terrain texture is visible.
  await evaluate(`(() => { const boxFor = (label) => [...document.querySelectorAll("label.checkbox")].find((l) => l.textContent.includes(label))?.querySelector("input");
    const box = boxFor("Show grade"); if (box && box.checked && ${process.env.KEEP_GRADE !== "1"}) box.click();
    const fill = boxFor("Presentation fill"); if (fill && fill.checked && ${process.env.PRESENTATION === "off"}) fill.click();
    if (${process.env.KEEP_CHAT !== "1"}) document.querySelector('button[aria-label="Minimize chat"]')?.click();
    if (${process.env.HIDE_ROVER === "1"}) window.__sceneRoot.setRover(null);
    if (${process.env.HIDE_PINS === "1"}) window.__sceneRoot.siteRoot.getObjectByName("pins").visible = false; })()`);
  if (process.env.EVAL) console.log("eval:", JSON.stringify(await evaluate(process.env.EVAL)));
  // Chooses options by value, in order, in whichever <select> offers each one
  // (for example SELECT="slope_deg" or SELECT="slope_deg|" to pick a layer and then "None").
  for (const value of process.env.SELECT === undefined ? [] : process.env.SELECT.split("|")) {
    await evaluate(`(() => { const value = ${JSON.stringify(value)};
      const select = [...document.querySelectorAll("select")].find((s) => [...s.options].some((o) => o.value === value));
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(select, value);
      select.dispatchEvent(new Event("change", { bubbles: true })); })()`);
    await sleep(SETTLE_MS);
  }
  if (process.env.QUERY) {
    // Types into the "Find by description" box and submits it, then waits for the answer.
    const t0 = Date.now();
    await evaluate(`(() => { const input = document.querySelector('input[name="splat-query"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, ${JSON.stringify(process.env.QUERY)});
      input.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    await sleep(200);
    await evaluate(`document.querySelector('input[name="splat-query"]').form.requestSubmit()`);
    for (let i = 0; i < 300; i++) {
      await sleep(100);
      if (await evaluate(`/highlighted for|failed|Could not/.test(document.body.innerText)`)) break;
    }
    console.log(`query "${process.env.QUERY}" answered and painted after ${Date.now() - t0} ms:`,
      await evaluate(`(document.body.innerText.match(/[\\d,]+ of [\\d,]+ Gaussians[^\\n]*|Search failed[^\\n]*/) || ["no result text"])[0]`));
    await sleep(SETTLE_MS);
  }
  if (process.env.SCROLL_PANEL === "1") await evaluate(`document.querySelector(".panel").scrollTo(0, 1e6)`);
  if (process.env.CLICK) {
    // Presses a button by its label, the way a person would (for example CLICK="Frame splat").
    await evaluate(`[...document.querySelectorAll("button")].find((b) => b.textContent.trim() === ${JSON.stringify(process.env.CLICK)}).click()`);
    await sleep(SETTLE_MS);
    console.log(`after "${process.env.CLICK}": ${await fps()} fps`);
    await shoot("clicked");
  }
  if (process.env.RANGE) {
    // Moves the first slider on the page to a value, the way dragging it would.
    await evaluate(`(() => { const input = document.querySelector('input[type="range"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, ${JSON.stringify(process.env.RANGE)});
      input.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    await sleep(500);
  }
  if (process.env.CLICK2) {
    // A second press after CLICK, matched by the start of the label (for example CLICK2="Show all").
    await evaluate(`[...document.querySelectorAll("button, summary")].find((b) => b.textContent.trim().startsWith(${JSON.stringify(process.env.CLICK2)})).click()`);
    await sleep(800);
    if (process.env.SCROLL_PANEL === "1") await evaluate(`document.querySelector(".panel").scrollTo(0, ${Number(process.env.PANEL_Y ?? 1e6)})`);
    await shoot("clicked2");
  } else if (process.env.RANGE) {
    if (process.env.SCROLL_PANEL === "1") await evaluate(`document.querySelector(".panel").scrollTo(0, ${Number(process.env.PANEL_Y ?? 1e6)})`);
    await shoot("range");
  }
  if (process.env.PANEL_SHOT === "1") {
    // The left panel scrolled to PANEL_Y, after the steps above.
    await evaluate(`document.querySelector(".panel").scrollTo(0, ${Number(process.env.PANEL_Y ?? 1e6)})`);
    await sleep(300);
    await shoot("panel");
  }
  for (const view of views) {
    await evaluate(`window.__sceneRoot.setViewSite(${JSON.stringify(view.eye)}, ${JSON.stringify(view.target)})`);
    await sleep(SETTLE_MS); // lets Spark re-sort the splats for the new camera
    console.log(`${view.name}: ${await fps()} fps`);
    await shoot(view.name);
  }
  if (process.env.CAPTURE_VIEW === "1") {
    // What "Concept render" would send: SceneRoot.captureView(), read in the same task.
    const jpeg = await evaluate(`window.__sceneRoot.captureView().toDataURL("image/jpeg", 0.9)`);
    const file = join(OUT_DIR, `${prefix}-captureview.jpg`);
    writeFileSync(file, Buffer.from(jpeg.split(",")[1], "base64"));
    console.log("wrote", file);
  }
  ws.close();
} finally {
  chromium.kill();
}

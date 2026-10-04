// Accounts part of shots/two-clients.mjs: who sees which scenes, switching scenes in one tab, and the server
// refusing a member who acts on a scene their organisation does not have.
import { open, sleep } from "./mp-browser.mjs";

export async function accountsScenario(codes, clients) {
  const [nia, sam, mia] = await Promise.all([open("Nia"), open("Sam"), open("Mia")]);
  clients.push(nia, sam, mia);

  // a. A wrong code is refused by the server, with its reason on the form.
  await nia.until(/Live session by SpacetimeDB · \d+/, "the landing page, connected");
  await sleep(1500); // the background image
  await nia.shoot("mp-acc-0-landing.png");
  await sam.signIn("0000-0000-0000");
  await sam.until(/that access code is not recognised/, "the wrong-code message");
  await sam.shoot("mp-acc-1-wrong-code.png");

  // b. Each organisation sees exactly its own scenes.
  await nia.signIn(codes.nasa);
  await sam.signIn(codes.spacex);
  await mia.signIn(codes.control);
  const expect = { Nia: ["mars-hero-01"], Sam: ["moon-malapert-01"], Mia: ["mars-hero-01", "moon-malapert-01"] };
  for (const c of [nia, sam, mia]) {
    await c.until(/Your scenes/, "the scene list");
    await c.until(/terrain at/, "the scene cards to fill in");
    const cards = await c.sceneCards();
    if (JSON.stringify(cards) !== JSON.stringify(expect[c.name])) throw new Error(`${c.name} sees ${cards}, expected ${expect[c.name]}`);
    console.log(`a. scenes     ${c.name}:`, cards.join(", "));
  }
  await nia.shoot("mp-acc-2-nasa-scenes.png");
  await sam.shoot("mp-acc-2-spacex-scenes.png");
  await mia.shoot("mp-acc-2-mission-control-scenes.png");

  // c. Mission control opens Mars, then hops to the Moon in the same tab: no page load in between.
  await mia.evaluate(`window.__sameDocument = true`);
  await mia.evaluate(`document.querySelector('.scene-card[data-scene="mars-hero-01"]').click()`);
  await mia.until(/live, 1 person/, "Mars to open live", 120000);
  await mia.until(/Best sites[\s\S]*Site 1/i, "the Mars scene to load", 120000);
  // Presence on the scene list: NASA's Mars card names who is in there right now.
  await nia.until(/1 live\s*Mia/, "Mia shown live on Nia's Mars card");
  await sleep(3000);
  await mia.shoot("mp-acc-3-mission-control-mars.png");
  await mia.select('select[name="scene-switcher"]', "moon-malapert-01");
  await mia.until(/Malapert Massif[\s\S]*live, 1 person/i, "the Moon to open live", 120000);
  await mia.until(/Best sites[\s\S]*Site 1/i, "the Moon scene to load", 120000);
  await sleep(3000);
  if (!(await mia.evaluate(`window.__sameDocument === true && location.search.includes("scene=moon-malapert-01")`))) {
    throw new Error("the scene switch reloaded the page or did not update the address");
  }
  console.log("c. switched   Mia: Mars -> Moon in the same document; address:", await mia.evaluate("location.search"));
  await mia.shoot("mp-acc-4-mission-control-moon.png");

  // d. NASA follows a link to the Moon scene: refused in the UI...
  await nia.navigate("moon-malapert-01");
  await nia.until(/Your organisation does not have the scene/, "the no-access message");
  await nia.shoot("mp-acc-5-nasa-denied-moon.png");
  // ...and by the server, when the client calls the reducer anyway (what a modified client would do).
  const attempt = await nia.evaluate(`window.__spacetime.reducers.addPin({ sceneId: "moon-malapert-01", x: 0, y: 0, z: 0, note: "should not exist" })
    .then(() => "ACCEPTED", (err) => "rejected: " + (err?.message ?? err))`);
  console.log("d. reducer    Nia:", attempt);
  if (!/rejected: .*does not have the scene/.test(attempt)) throw new Error("the server accepted a pin from an organisation without access");
  const drive = await nia.evaluate(`window.__spacetime.reducers.driveRover({ sceneId: "moon-malapert-01", fromX: 0, fromY: 0, toX: 5, toY: 5, label: "x" })
    .then(() => "ACCEPTED", (err) => "rejected: " + (err?.message ?? err))`);
  console.log("d. reducer    Nia:", drive);
  if (!drive.startsWith("rejected")) throw new Error("the server accepted a rover drive from an organisation without access");
  await sleep(800);
  if (/should not exist/.test(await mia.text())) throw new Error("the refused pin shows up on the Moon scene");

  // e. Sign out: back to the form, and the server no longer knows this identity as a member.
  await nia.click("Sign out");
  await nia.until(/Live session by SpacetimeDB/, "the landing page after signing out");
  const after = await nia.evaluate(`window.__spacetime.reducers.addPin({ sceneId: "mars-hero-01", x: 0, y: 0, z: 0, note: "signed out" })
    .then(() => "ACCEPTED", (err) => "rejected: " + (err?.message ?? err))`);
  console.log("e. signed out Nia:", after);
  if (!/rejected: .*sign in/.test(after)) throw new Error("a signed-out identity could still write");
  console.log("accounts: ok");
  for (const c of [nia, sam, mia]) c.close();
  clients.length = 0;
}

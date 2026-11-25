// Screenshots of every screen, to compare before and after each step of PLAN-MODERNIZACION.md.
//
// 1. Start the demo app (its own data, never the real ones) with the inspector port open, from Git Bash:
//      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9223" ZEEBOARD_IPAD_BIND=127.0.0.1 \
//        npx tauri dev --config scripts/demo.conf.json
// 2. node scripts/capturas.mjs <step>        e.g. node scripts/capturas.mjs M0
//
// Saves capturas/<step>/<theme>-<width>-<screen>.png: 8 screens + the new-commission form, at 1440×900 and
// 1024×680, in light and dark (36 images). The theme is switched like Settings does (data-theme) and put back after.
import { mkdirSync, writeFileSync } from "node:fs";

const step = process.argv[2];
if (!step) {
  console.error("Usage: node scripts/capturas.mjs <step>   (e.g. M0, M1.1)");
  process.exit(1);
}
const folder = new URL(`../capturas/${step}/`, import.meta.url);
mkdirSync(folder, { recursive: true });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let page;
for (let tries = 0; !page; tries++) {
  page = await fetch("http://127.0.0.1:9223/json")
    .then((response) => response.json())
    .then((pages) => pages.find((p) => p.type === "page" && p.url.includes("localhost:1431")))
    .catch(() => null);
  if (page) break;
  if (tries === 0) console.log("Waiting for the demo app on port 9223…");
  if (tries > 120) throw new Error("The demo app isn't running with the inspector port (see step 1 at the top).");
  await sleep(2000);
}

const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve) => (socket.onopen = resolve));
let lastId = 0;
const waiting = new Map();
socket.onmessage = ({ data }) => {
  const message = JSON.parse(data);
  waiting.get(message.id)?.(message);
};
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = ++lastId;
    waiting.set(id, resolve);
    socket.send(JSON.stringify({ id, method, params }));
  });
const run = async (body) => {
  const { result } = await send("Runtime.evaluate", { expression: `(async () => { ${body} })()`, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
};
const shot = async (name) => {
  const { result } = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(new URL(`${name}.png`, folder), Buffer.from(result.data, "base64"));
};
// Clicks the sidebar entry or button whose text starts with `text`, then waits for the screen to settle
const click = (selector, text) =>
  run(`
    const target = [...document.querySelectorAll(${JSON.stringify(selector)})].find((el) => el.textContent.trim().startsWith(${JSON.stringify(text)}));
    if (!target) return false;
    target.click();
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return true;
  `);

const screens = ["Dashboard", "Commissions", "Requests", "Clients", "Finished", "Catalog", "Statistics", "Settings"];
const nav = "aside button, nav button";

// The window opens before the app has loaded its data: wait for the sidebar
for (let tries = 0; !(await run(`return document.querySelectorAll(${JSON.stringify(nav)}).length > 0;`)); tries++) {
  if (tries > 60) throw new Error("The app opened but its sidebar never appeared.");
  await sleep(1000);
}
await sleep(1500);
const themeBefore = await run(`return document.documentElement.dataset.theme ?? null;`);
let saved = 0;

for (const theme of ["light", "dark"]) {
  await run(`document.documentElement.dataset.theme = ${JSON.stringify(theme)};`);
  for (const [width, height] of [[1440, 900], [1024, 680]]) {
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    await sleep(600);
    for (const screen of screens) {
      // A screen that no longer has its own sidebar entry (e.g. Finished after M2.5) is simply skipped
      if (await click(nav, screen)) {
        await shot(`${theme}-${width}-${screen}`);
        saved++;
      }
    }
    await click(nav, "Commissions");
    if (await click("button", "New commission")) {
      await shot(`${theme}-${width}-NewCommission`);
      saved++;
      await run(`document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));`);
      await sleep(500);
    }
  }
}

await run(themeBefore ? `document.documentElement.dataset.theme = ${JSON.stringify(themeBefore)};` : `delete document.documentElement.dataset.theme;`);
await send("Emulation.clearDeviceMetricsOverride");
socket.close();
console.log(`${saved} screenshots in capturas/${step}/`);

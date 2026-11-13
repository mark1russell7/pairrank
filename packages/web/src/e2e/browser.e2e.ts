/**
 * The browser check of the browser host. It starts the host with the built page and two local sites, and opens the page
 * in a headless Chrome. Site A shows in a frame. Site B sends `X-Frame-Options: DENY`, so its slot shows a still picture.
 *
 * - On the Look screen, the slot of site A is shown and tall, and its frame covers the slot.
 * - In the duel, the two slots are shown. Site B has no frame, and its slot shows the picture of the capture.
 * - The capture is a fake capture with a picture of one pixel. Thus the check examines the page, not a browser capture.
 * - The host reads the local sites: its `fetch` accepts `127.0.0.1` for this check only.
 * - The slot starts locked. The page moves the frame of site A, and the lock loads site A again. After an unlock, the
 *   frame stays on its new page (R23).
 *
 * CI starts it with `pnpm --filter @pairrank/web e2e`. The variable `CHROME_PATH` gives the browser. The default is
 * `google-chrome`.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeProcess } from "@mark1russell7/service/testing";
import { capturePool } from "@pairrank/host/pictures";
import { openStore } from "@pairrank/store";
import { Client, HttpTransport, pathToMethod } from "@procedures/client";
import { createHostFetch } from "@procedures/http";
import { runProcedureHost } from "@procedures/server";
import { API_PATH, webHost } from "../index.ts";

/** The lowest height of a slot, in CSS pixels. A window of 1400 by 900 gives each slot more than this. */
const MIN_HEIGHT = 200;
const LIMIT_MS = 20_000;

interface Target {
  readonly type: string;
  readonly url: string;
  readonly webSocketDebuggerUrl: string;
}

interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));
const started = Date.now();
const say = (text: string): void => console.log(`${String(Date.now() - started).padStart(6)} ms  ${text}`);

/** A connection to one target of the debug port, with `Runtime.evaluate`. */
async function connect(target: Target): Promise<{ evaluate: <T>(expression: string) => Promise<T>; close: () => void }> {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((done, fail) => {
    socket.addEventListener("open", done, { once: true });
    socket.addEventListener("error", fail, { once: true });
  });
  let next = 0;
  const waiting = new Map<number, (value: unknown) => void>();
  socket.addEventListener("message", (message) => {
    const data = JSON.parse(String(message.data)) as { id?: number; result?: { result?: { value?: unknown } } };
    if (data.id !== undefined) waiting.get(data.id)?.(data.result?.result?.value);
  });
  return {
    evaluate: <T>(expression: string) =>
      new Promise<T>((done) => {
        const id = ++next;
        waiting.set(id, (value) => done(value as T));
        socket.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, returnByValue: true } }));
      }),
    close: () => socket.close(),
  };
}

/** This function waits until `test` gives a value that is not `undefined`, or throws after the time limit. */
async function until<T>(what: string, test: () => Promise<T | undefined>): Promise<T> {
  const end = Date.now() + LIMIT_MS;
  while (Date.now() < end) {
    const found = await test();
    if (found !== undefined) return found;
    await sleep(200);
  }
  throw new Error(`No ${what} in ${LIMIT_MS} ms.`);
}

/** This function gives a free port of the loopback address. */
async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const { port } = server.address() as AddressInfo;
  await new Promise((done) => server.close(done));
  return port;
}

/** The addresses that the local sites got, in order. */
const requests: string[] = [];
const sites = createServer((request, response) => {
  requests.push(request.url ?? "");
  const refuses = request.url === "/b";
  response.writeHead(200, { "content-type": "text/html; charset=utf-8", ...(refuses ? { "x-frame-options": "DENY" } : {}) });
  response.end(`<!doctype html><title>Site ${refuses ? "B" : "A"}</title><body style="margin:0;background:#cde"><h1>A site</h1></body>`);
});
await new Promise<void>((done) => sites.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${(sites.address() as AddressInfo).port}`;

/** A PNG picture of one pixel: the picture of the fake capture. */
const PIXEL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
/** The addresses that the fake capture took, in order. */
const captured: string[] = [];
const pictures = capturePool(async (url) => {
  captured.push(url);
  return { ok: true, picture: PIXEL, title: "Site B" };
}, 2);

const folder = mkdtempSync(join(tmpdir(), "pairrank-web-e2e-"));
const store = openStore(join(folder, "store.sqlite"));
const page = join(import.meta.dirname, "..", "..", "build", "page");
const running = await runProcedureHost({
  name: "pairrank-web-e2e",
  host: webHost({ store, page, port: 0, fetch: createHostFetch({ allow: ["127.0.0.1"] }), pictures }),
  mode: "foreground",
  run: { process: fakeProcess() },
});
const address = running.host.info.endpoints().find((endpoint) => endpoint.type === "static")?.address;
if (address === undefined) throw new Error("The host has no endpoint of the page.");
const host = new URL(address).origin;

const client = new Client(new HttpTransport({ baseUrl: `${host}${API_PATH}` }));
await client.call(pathToMethod(["pairrank", "import", "apply"]), {
  list: { format: "pairrank.sites", version: 1, source: "e2e", sites: [{ url: `${origin}/a` }, { url: `${origin}/b` }] },
});

const debugPort = await freePort();
const chrome = spawn(
  process.env["CHROME_PATH"] ?? "google-chrome",
  ["--headless=new", `--remote-debugging-port=${debugPort}`, `--user-data-dir=${join(folder, "chrome")}`, "--no-first-run", "--window-size=1400,900", `${host}/`],
  { stdio: ["ignore", "ignore", "inherit"] },
);

const targets = async (): Promise<Target[]> => {
  try {
    return (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()) as Target[];
  } catch {
    return [];
  }
};

type Page = Awaited<ReturnType<typeof connect>>;

interface Seen {
  readonly slots: readonly { state: string; box: Box; url: string; picture: string }[];
  readonly frames: readonly { src: string; box: Box; shown: boolean }[];
}

/** This expression gives the slots and the frames of the page. */
const SEEN = `(() => {
  const boxOf = (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
  return {
    slots: Array.from(document.querySelectorAll('.slot')).map((s) => {
      const img = s.querySelector('.slot-picture img');
      return { state: s.dataset.state, box: boxOf(s), url: s.querySelector('.slot-url')?.textContent ?? '', picture: img && img.complete && img.naturalWidth > 0 ? img.src : '' };
    }),
    frames: Array.from(document.querySelectorAll('iframe')).map((f) => ({ src: f.src, box: boxOf(f), shown: f.style.display !== 'none' })),
  };
})()`;

/** The expression that moves the frame of the Look screen to another page of site A, as a link of the site does. */
const moveTo = (path: string): string => `document.querySelector('iframe').contentWindow.location.href = ${JSON.stringify(`${origin}${path}`)}`;
/** The expression that gives the text of the notice of the slot, or an empty text. */
const NOTICE = `document.querySelector('.slot-notice-text')?.textContent ?? ''`;

/**
 * This function examines the lock of the frame on the Look screen. A locked frame that moves to another page comes back
 * to the site, and the slot tells it. After an unlock, the frame stays on the new page.
 */
async function examineLock(view: Page): Promise<void> {
  const lock = `document.querySelector('.slot-bar [role=switch]')`;
  await until("locked slot", async () => ((await view.evaluate<string | null>(`${lock}?.getAttribute('aria-checked') ?? null`)) === "true" ? true : undefined));
  await view.evaluate(moveTo("/a?moved"));
  await until("return of the frame to the site", async () => (requests.slice(requests.indexOf("/a?moved") + 1).includes("/a") && requests.includes("/a?moved") ? true : undefined));
  await until("notice of the lock", async () => ((await view.evaluate<string>(NOTICE)).startsWith("The lock kept the site on its page") ? true : undefined));
  say("Look: the lock brought the frame back to the site");
  await view.evaluate(`${lock}.click()`);
  const sandbox = await until("unlocked frame", async () => {
    const value = await view.evaluate<string>(`document.querySelector('iframe').getAttribute('sandbox') ?? ''`);
    return value.split(" ").includes("allow-popups") ? value : undefined;
  });
  say(`Look: the unlocked frame has the sandbox "${sandbox}"`);
  const before = requests.length;
  await view.evaluate(moveTo("/a?free"));
  await until("move of the unlocked frame", async () => (requests.slice(before).includes("/a?free") ? true : undefined));
  await sleep(1000);
  const after = requests.slice(requests.lastIndexOf("/a?free") + 1);
  if (after.includes("/a")) throw new Error(`Look: the unlocked frame came back to the site: ${JSON.stringify(after)}.`);
  say("Look: the unlocked frame stayed on its new page");
}

/** This function tells if two boxes are the same, with one pixel of tolerance for the rounding. */
const same = (a: Box, b: Box): boolean => Math.abs(a.x - b.x) <= 1 && Math.abs(a.y - b.y) <= 1 && Math.abs(a.w - b.w) <= 1 && Math.abs(a.h - b.h) <= 1;

/** This function waits until the slots of the screen have the states, and gives the slots and the frames. */
async function settle(view: Page, screen: string, states: readonly string[]): Promise<Seen> {
  const want = [...states].sort().join(",");
  await until(`slots ${want} on ${screen}`, async () => {
    const seen = await view.evaluate<Seen>(SEEN);
    return seen.slots.map((slot) => slot.state).sort().join(",") === want ? seen : undefined;
  });
  // A late fault comes just after the load, so the check waits a moment
  await sleep(1000);
  const seen = await view.evaluate<Seen>(SEEN);
  for (const slot of seen.slots) say(`${screen}: a slot is ${slot.state}, ${Math.round(slot.box.h)} px tall`);
  return seen;
}

/**
 * This function examines the live slot: the shown slot with no still picture. It is tall, and the one shown frame of the
 * site covers it. A shown slot has no text of its address, so the frame tells the site.
 */
function examineShown(screen: string, seen: Seen, url: string): void {
  const slot = seen.slots.find((each) => each.state === "shown" && each.picture === "");
  if (slot === undefined) throw new Error(`${screen}: no slot is shown.`);
  if (slot.box.h < MIN_HEIGHT) throw new Error(`${screen}: the shown slot is ${slot.box.h} px tall. It must be ${MIN_HEIGHT} px or more.`);
  const shown = seen.frames.filter((frame) => frame.shown);
  if (shown.length !== 1 || shown[0]?.src !== url) throw new Error(`${screen}: the shown frames are ${JSON.stringify(shown)}. One frame of ${url} must show.`);
  if (!same(shown[0].box, slot.box)) throw new Error(`${screen}: the frame is at ${JSON.stringify(shown[0].box)}, and its slot is at ${JSON.stringify(slot.box)}.`);
}

let code = 1;
try {
  const target = await until("page of the host", async () => (await targets()).find((each) => each.type === "page" && each.url.startsWith(host)));
  const view = await connect(target);
  const click = (name: string) =>
    until(`button ${name}`, () =>
      view.evaluate<true | undefined>(
        `(() => { const b = Array.from(document.querySelectorAll('nav button')).find((b) => b.textContent.trim() === ${JSON.stringify(name)} && !b.disabled); b?.click(); return b ? true : undefined; })()`,
      ),
    );
  await click("Look");
  examineShown("Look", await settle(view, "Look", ["shown"]), `${origin}/a`);
  await examineLock(view);
  await click("Duel");
  const duel = await settle(view, "Duel", ["shown", "shown"]);
  examineShown("Duel", duel, `${origin}/a`);
  const still = duel.slots.filter((slot) => slot.picture !== "");
  if (still.length !== 1 || still[0]?.picture !== PIXEL) throw new Error(`Duel: one slot must show the picture of the capture: ${JSON.stringify(duel.slots)}.`);
  if (captured.length === 0 || captured.some((url) => url !== `${origin}/b`)) throw new Error(`Duel: the capture took ${JSON.stringify(captured)}. It must take only ${origin}/b.`);
  if (duel.frames.some((frame) => frame.src === `${origin}/b`)) throw new Error("Duel: the site that refuses frames has a frame.");
  view.close();
  say("The browser check passed.");
  code = 0;
} catch (error) {
  console.error(`The browser check failed: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  chrome.kill();
  await running.life.shutdown("the check ended");
  await running.life.done;
  pictures.stop();
  store.close();
  sites.close();
  await sleep(500);
  rmSync(folder, { recursive: true, force: true });
}
process.exit(code);

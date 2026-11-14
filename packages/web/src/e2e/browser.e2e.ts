/**
 * The browser check of the browser host. It starts the host with the built page and two local sites, and opens the page
 * in a headless Chrome. Site A shows in a frame. Site B sends `X-Frame-Options: DENY`, so its slot shows a still picture.
 *
 * - On the Look screen, the slot of site A is shown and tall, and its frame covers the slot.
 * - In the duel, the two slots are shown. Site B has no frame, and its slot shows the picture of the capture.
 * - The capture is a fake capture with a picture of one pixel. Thus the check examines the page, not a browser capture.
 * - The host reads the local sites: its `fetch` and its still pictures accept `127.0.0.1` for this check only.
 * - The slot starts locked. The page moves the frame of site A, and the lock loads site A again. After an unlock, the
 *   frame stays on its new page (R23).
 * - At the end, the capture of `src/main.ts` takes a real picture of a local page of one color. The page of the host
 *   draws the picture on a canvas, and the check reads the color at its center (R22).
 *
 * CI starts it with `pnpm --filter @pairrank/web e2e`. The variable `CHROME_PATH` gives the browser. The default is
 * `google-chrome`.
 */
import { errorMessage } from "@mark1russell7/text";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeProcess } from "@mark1russell7/service/testing";
import { capturePool } from "@pairrank/host/pictures";
import { openStore } from "@pairrank/store";
import { SETTLE_MS } from "@pairrank/surfaces";
import { renderScreenshotBytes } from "@procedures/browser";
import { Client, HttpTransport, pathToMethod } from "@procedures/client";
import { createHostFetch } from "@procedures/http";
import { runProcedureHost } from "@procedures/server";
import { headlessCapture } from "../headless.ts";
import { API_PATH, LOAD_TIMEOUT_MS, webHost } from "../index.ts";

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

/** A connection to one target of the debug port, with `Runtime.evaluate`. A promise gives its value. */
async function connect(target: Target): Promise<{ evaluate: <T>(expression: string) => Promise<T>; close: () => void }> {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((done, fail) => {
    socket.addEventListener("open", done, { once: true });
    socket.addEventListener("error", fail, { once: true });
  });
  let next = 0;
  const waiting = new Map<number, (value: unknown) => void>();
  socket.addEventListener("message", (message) => {
    const data = JSON.parse(String(message.data)) as { id?: unknown; result?: { result?: { value?: unknown } } };
    // The message comes from outside, so only a number of a waiting call gives a function
    if (typeof data.id !== "number") return;
    const done = waiting.get(data.id);
    if (typeof done !== "function") return;
    waiting.delete(data.id);
    done(data.result?.result?.value);
  });
  return {
    evaluate: <T>(expression: string) =>
      new Promise<T>((done) => {
        const id = ++next;
        waiting.set(id, (value) => done(value as T));
        socket.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, returnByValue: true, awaitPromise: true } }));
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

/** The color of the page `/color`, for the real capture. */
const COLOR = [0, 128, 255] as const;
/** The largest difference of a channel of the picture from the color of the page. A JPEG changes the color a little. */
const MAX_COLOR_ERROR = 12;

/** The addresses that the local sites got, in order. */
const requests: string[] = [];
const sites = createServer((request, response) => {
  requests.push(request.url ?? "");
  if (request.url === "/color") {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(`<!doctype html><title>Color</title><body style="margin:0;background:rgb(${COLOR.join(",")})"></body>`);
    return;
  }
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
  host: webHost({ store, page, port: 0, fetch: createHostFetch({ allow: ["127.0.0.1"] }), pictures, pictureHosts: ["127.0.0.1"] }),
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

/**
 * This function takes a real picture of the page `/color` with the capture of `src/main.ts`. The page of the host draws
 * the picture on a canvas. Thus the check reads the color at its center with no decoder of its own.
 */
async function examineCapture(view: Page): Promise<void> {
  const executable = process.env["CHROME_PATH"];
  const capture = headlessCapture({ render: (request) => renderScreenshotBytes({ ...request, executable }), timeoutMs: LOAD_TIMEOUT_MS });
  const result = await capture(`${origin}/color`, { w: 640, h: 400 }, new AbortController().signal);
  if (!result.ok) throw new Error(`Capture: the real capture failed: ${result.reason}, ${result.detail ?? "no detail"}.`);
  const center = await view.evaluate<{ w: number; h: number; rgb: number[] } | string>(`new Promise((done) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0);
      const pixel = context.getImageData(canvas.width >> 1, canvas.height >> 1, 1, 1).data;
      done({ w: canvas.width, h: canvas.height, rgb: [pixel[0], pixel[1], pixel[2]] });
    };
    image.onerror = () => done('The page cannot decode the picture.');
    image.src = ${JSON.stringify(result.picture)};
  })`);
  if (typeof center === "string") throw new Error(`Capture: ${center}`);
  say(`Capture: a picture of ${center.w} by ${center.h}, with the color ${center.rgb.join(", ")} at its center`);
  if (center.rgb.some((value, index) => Math.abs(value - (COLOR[index] ?? 0)) > MAX_COLOR_ERROR)) {
    throw new Error(`Capture: the center of the picture is ${center.rgb.join(", ")}. The page is ${COLOR.join(", ")}.`);
  }
}

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
  // A load soon after the last load is a redirect of the site, so the move waits for the quiet time
  await sleep(SETTLE_MS + 500);
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
  await examineCapture(view);
  view.close();
  say("The browser check passed.");
  code = 0;
} catch (error) {
  console.error(`The browser check failed: ${errorMessage(error)}`);
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

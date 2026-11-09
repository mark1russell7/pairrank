/**
 * The layout check of the desktop app. It starts the built app with two local sites, and opens the Look screen and the
 * duel. Each slot must be shown and tall after its load. The page tests have no layout, so only this check finds a slot
 * with no height. The check also writes the visibility of the page of each site. On Linux with a virtual display,
 * Chromium tells `hidden` for a view on the screen, so the visibility is not a condition. CI starts it with `pnpm --filter @pairrank/desktop e2e`.
 *
 * At the end, the check zooms the page out with the item `zoomOut` of the default menu (Ctrl+-). Then the view of each
 * site covers its slot. Its width in the pixels of the window is the width of the slot times the zoom (B4). A key event
 * of the debug port goes to the page and not to the menu. Thus the check clicks the item through the inspector of the
 * main process.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pairrankModule } from "@pairrank/host";
import { openStore } from "@pairrank/store";
import { callerOf } from "@procedures/client";
import electron from "electron";

/** The lowest height of a slot, in CSS pixels. A window of 1400 by 900 gives each slot more than this. */
const MIN_HEIGHT = 200;
/** The largest difference between the width of a view and the width of its slot times the zoom, in pixels of the window. */
const MAX_WIDTH_ERROR = 2;
const LIMIT_MS = 20_000;

interface Target {
  readonly type: string;
  readonly url: string;
  readonly webSocketDebuggerUrl: string;
}

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));
const started = Date.now();
const say = (text: string): void => console.log(`${String(Date.now() - started).padStart(6)} ms  ${text}`);

/** A connection to one target of a debug port: `Runtime.evaluate`, and `send` for another method. */
interface Connection {
  evaluate<T>(expression: string): Promise<T>;
  /** This function sends a method, and gives the value of its result, if it has one. */
  send(method: string, params: Record<string, unknown>): Promise<unknown>;
  close(): void;
}

/** This function connects to one target of the debug port. */
async function connect(target: Target): Promise<Connection> {
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
  const call = (method: string, params: Record<string, unknown>): Promise<unknown> =>
    new Promise((done) => {
      const id = ++next;
      waiting.set(id, done);
      socket.send(JSON.stringify({ id, method, params }));
    });
  return {
    evaluate: async <T>(expression: string) => (await call("Runtime.evaluate", { expression, returnByValue: true })) as T,
    send: (method, params) => call(method, params),
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

const sites = createServer((request, response) => {
  const name = request.url === "/b" ? "Site B" : "Site A";
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(`<!doctype html><title>${name}</title><body style="margin:0;background:#cde"><h1>${name}</h1></body>`);
});
await new Promise<void>((done) => sites.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${(sites.address() as AddressInfo).port}`;

const folder = mkdtempSync(join(tmpdir(), "pairrank-e2e-"));
const storeFile = join(folder, "store.sqlite");
const store = openStore(storeFile);
const caller = callerOf(pairrankModule(store, { key: (url) => url }));
await caller(["pairrank", "import", "apply"], { list: { format: "pairrank.sites", version: 1, source: "e2e", sites: [{ url: `${origin}/a` }, { url: `${origin}/b` }] } });
store.close();

const debugPort = await freePort();
const inspectPort = await freePort();
const main = join(import.meta.dirname, "..", "..", "build", "main", "main.js");
const app = spawn(electron as unknown as string, [`--inspect=${inspectPort}`, `--remote-debugging-port=${debugPort}`, `--user-data-dir=${join(folder, "data")}`, main], {
  env: { ...process.env, PAIRRANK_STORE: storeFile },
  stdio: ["ignore", "inherit", "inherit"],
});

const targets = async (): Promise<Target[]> => {
  try {
    return (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()) as Target[];
  } catch {
    return [];
  }
};

/** This function examines the slots of the screen: each is shown and tall. It writes the visibility of each page. */
async function examine(page: Connection, screen: string, count: number, urls: readonly string[]): Promise<void> {
  const slots = `Array.from(document.querySelectorAll('.slot')).map((s) => ({ state: s.dataset.state, height: s.getBoundingClientRect().height }))`;
  await until(`${count} shown slots on ${screen}`, async () => {
    const found = await page.evaluate<{ state: string; height: number }[]>(slots);
    return found.length === count && found.every((slot) => slot.state === "shown") ? found : undefined;
  });
  // The fault came just after the load, so the check waits a moment
  await sleep(1000);
  for (const slot of await page.evaluate<{ state: string; height: number }[]>(slots)) {
    say(`${screen}: a slot is ${slot.state}, ${Math.round(slot.height)} px tall`);
    if (slot.state !== "shown" || slot.height < MIN_HEIGHT) throw new Error(`${screen}: a slot is ${slot.state} and ${slot.height} px tall. It must be shown and ${MIN_HEIGHT} px or more.`);
  }
  for (const url of urls) {
    const target = await until(`page of ${url}`, async () => (await targets()).find((each) => each.type === "page" && each.url === url));
    const site = await connect(target);
    const state = await site.evaluate<string>("document.visibilityState");
    site.close();
    say(`${screen}: the page of ${url} tells ${state}`);
  }
}

/** This function gives the width of the window of the page of each address, in its CSS pixels: the pixels of the window. */
async function siteWidths(urls: readonly string[]): Promise<number[]> {
  const widths: number[] = [];
  for (const url of urls) {
    const target = await until(`page of ${url}`, async () => (await targets()).find((each) => each.type === "page" && each.url === url));
    const site = await connect(target);
    widths.push(await site.evaluate<number>("window.innerWidth"));
    site.close();
  }
  return widths;
}

/**
 * The click of the item `zoomOut` of the application menu, in the main process. The item gets the window of the page,
 * as after Ctrl+- in that window. The value is `true`, or the text of the fault.
 */
const ZOOM_OUT = `(() => {
  try {
    const { BrowserWindow, Menu } = require("electron");
    const find = (menu) => {
      for (const item of menu?.items ?? []) {
        if (String(item.role).toLowerCase() === "zoomout") return item;
        const inner = find(item.submenu);
        if (inner) return inner;
      }
    };
    const item = find(Menu.getApplicationMenu());
    const window = BrowserWindow.getAllWindows()[0];
    if (!item) return "The application menu has no item zoomOut.";
    if (!window) return "The app has no window.";
    item.click(undefined, window, window.webContents);
    return true;
  } catch (error) {
    return String(error);
  }
})()`;

/** This function zooms the page out with the menu, and checks that the view of each site still covers its slot (B4). */
async function examineZoom(page: Connection, main: Connection, urls: readonly string[]): Promise<void> {
  const ratio = () => page.evaluate<number>("window.devicePixelRatio");
  const before = await ratio();
  // The command line of the inspector gives require()
  const clicked = await main.send("Runtime.evaluate", { expression: ZOOM_OUT, returnByValue: true, includeCommandLineAPI: true });
  if (clicked !== true) throw new Error(`The zoom out of the menu failed: ${String(clicked)}`);
  const zoom = await until("change of the zoom of the page after the zoom out of the menu", async () => {
    const now = await ratio();
    return Math.abs(now - before) > 0.01 ? now / before : undefined;
  });
  // The page sends the boxes again after the resize of the zoom
  await sleep(1000);
  const slots = await page.evaluate<number[]>(`Array.from(document.querySelectorAll('.slot')).map((s) => s.getBoundingClientRect().width)`);
  const expected = slots.map((width) => width * zoom).sort((a, b) => a - b);
  const got = (await siteWidths(urls)).sort((a, b) => a - b);
  say(`zoom ${zoom.toFixed(2)}: the slots want ${expected.map((width) => width.toFixed(1)).join(", ")} px, the views are ${got.join(", ")} px`);
  for (const [index, width] of got.entries()) {
    const want = expected[index] ?? Number.NaN;
    if (!(Math.abs(width - want) <= MAX_WIDTH_ERROR)) throw new Error(`zoom ${zoom.toFixed(2)}: a view is ${width} px wide. Its slot wants ${want.toFixed(1)} px.`);
  }
}

let code = 1;
try {
  const target = await until("page of the app", async () => (await targets()).find((each) => each.url.startsWith("app://page")));
  const page = await connect(target);
  const click = (name: string) =>
    until(`button ${name}`, () =>
      page.evaluate<true | undefined>(
        `(() => { const b = Array.from(document.querySelectorAll('nav button')).find((b) => b.textContent.trim() === ${JSON.stringify(name)} && !b.disabled); b?.click(); return b ? true : undefined; })()`,
      ),
    );
  await click("Look");
  await examine(page, "Look", 1, [`${origin}/a`]);
  await click("Duel");
  await examine(page, "Duel", 2, [`${origin}/a`, `${origin}/b`]);
  const inspector = await until("inspector of the main process", async () => {
    try {
      return ((await (await fetch(`http://127.0.0.1:${inspectPort}/json/list`)).json()) as Target[])[0];
    } catch {
      return undefined;
    }
  });
  const main = await connect(inspector);
  await examineZoom(page, main, [`${origin}/a`, `${origin}/b`]);
  main.close();
  page.close();
  say("The layout check passed.");
  code = 0;
} catch (error) {
  console.error(`The layout check failed: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  app.kill();
  sites.close();
  await sleep(500);
  rmSync(folder, { recursive: true, force: true });
}
process.exit(code);

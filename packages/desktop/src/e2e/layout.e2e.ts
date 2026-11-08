/**
 * The layout check of the desktop app. It starts the built app with two local sites, and opens the Look screen and the
 * duel. Each slot must be tall, and the page of each site must be visible after its load. The page tests have no
 * layout, so only this check finds a slot with no height. CI starts it with `pnpm --filter @pairrank/desktop e2e`.
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
const LIMIT_MS = 20_000;

interface Target {
  readonly type: string;
  readonly url: string;
  readonly webSocketDebuggerUrl: string;
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
const main = join(import.meta.dirname, "..", "..", "build", "main", "main.js");
const app = spawn(electron as unknown as string, [`--remote-debugging-port=${debugPort}`, `--user-data-dir=${join(folder, "data")}`, main], {
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

/** This function examines the slots of the screen: each is shown and tall, and the page of each site is visible. */
async function examine(page: Awaited<ReturnType<typeof connect>>, screen: string, count: number, urls: readonly string[]): Promise<void> {
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
    say(`${screen}: the page of ${url} is ${state}`);
    if (state !== "visible") throw new Error(`${screen}: the page of ${url} is ${state}. It must be visible.`);
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

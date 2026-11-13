/**
 * The check of the lock and the tabs of the desktop app (R23, R24). It starts the built app with one local site, and
 * opens the Look screen. CI starts it with `pnpm --filter @pairrank/desktop e2e`.
 *
 * The site goes to its page with a script in its first load, and the lock lets that go. Then the locked slot keeps the
 * site on its page, and opens no window. After an unlock, a link goes to another page, Back comes back, and a new window
 * opens as a tab of the slot. "Add this page" adds the page of the slot to the list.
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
import { type Connection, connect, freePort, say, sleep, targetsOf, until } from "./debug.ts";

/** The pages of the site. The first page goes to `/a` with a script, and `/a` has a link and a link to a new window. */
const PAGES: Readonly<Record<string, string>> = {
  "/start": `<title>Start</title><script>location.replace("/a")</script>`,
  "/a": `<title>Site A</title><a id="next" href="/b">Next</a> <a id="win" href="/c" target="_blank">Window</a>`,
  "/b": `<title>Site B</title><h1>B</h1>`,
  "/c": `<title>Site C</title><h1>C</h1>`,
};

const sites = createServer((request, response) => {
  const page = PAGES[request.url ?? ""];
  response.writeHead(page === undefined ? 404 : 200, { "content-type": "text/html; charset=utf-8" });
  response.end(`<!doctype html>${page ?? "<title>No page</title>"}`);
});
await new Promise<void>((done) => sites.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${(sites.address() as AddressInfo).port}`;

const folder = mkdtempSync(join(tmpdir(), "pairrank-e2e-"));
const storeFile = join(folder, "store.sqlite");
const store = openStore(storeFile);
const caller = callerOf(pairrankModule(store, { key: (url) => url }));
await caller(["pairrank", "import", "apply"], { list: { format: "pairrank.sites", version: 1, source: "e2e", sites: [{ url: `${origin}/start` }] } });
store.close();

const debugPort = await freePort();
const main = join(import.meta.dirname, "..", "..", "build", "main", "main.js");
const app = spawn(electron as unknown as string, [`--remote-debugging-port=${debugPort}`, `--user-data-dir=${join(folder, "data")}`, main], {
  env: { ...process.env, PAIRRANK_STORE: storeFile },
  stdio: ["ignore", "inherit", "inherit"],
});

/** This function gives the addresses of the pages of the sites, in the order of the debug port. */
const sitePages = async (): Promise<string[]> => (await targetsOf(debugPort)).filter((each) => each.type === "page" && each.url.startsWith(origin)).map((each) => each.url);

/** This function waits until the pages of the sites are the pages of the addresses, in any order. */
async function pagesAre(paths: readonly string[]): Promise<void> {
  const want = paths.map((path) => `${origin}${path}`).sort();
  await until(`pages ${paths.join(", ")}`, async () => {
    const found = (await sitePages()).sort();
    return found.length === want.length && found.every((url, index) => url === want[index]) ? true : undefined;
  });
  say(`the pages of the sites are ${paths.join(", ")}`);
}

/** This function waits until an expression of the page of the app gives the value. */
async function appShows(page: Connection, what: string, expression: string, value: unknown): Promise<void> {
  await until(`${what} (${JSON.stringify(value)})`, async () => ((await page.evaluate<unknown>(expression)) === value ? true : undefined));
  say(`the app shows ${what}: ${JSON.stringify(value)}`);
}

/** This function clicks an element of the page of the app. */
async function press(page: Connection, selector: string): Promise<void> {
  await until(`an enabled ${selector}`, () =>
    page.evaluate<true | undefined>(`(() => { const b = document.querySelector(${JSON.stringify(selector)}); if (!b || b.disabled) return undefined; b.click(); return true; })()`),
  );
}

/** This function clicks a link of the site, as a person does. */
async function follow(id: string): Promise<void> {
  const target = await until("page of the site", async () => (await targetsOf(debugPort)).find((each) => each.type === "page" && each.url === `${origin}/a`));
  const site = await connect(target);
  await site.evaluate(`document.getElementById(${JSON.stringify(id)}).click()`, true);
  site.close();
}

const LOCK = ".slot-bar [role=switch]";
const text = (selector: string): string => `document.querySelector(${JSON.stringify(selector)})?.textContent ?? null`;

let code = 1;
try {
  const target = await until("page of the app", async () => (await targetsOf(debugPort)).find((each) => each.url.startsWith("app://page")));
  const page = await connect(target);
  await until("button Look", () =>
    page.evaluate<true | undefined>(`(() => { const b = Array.from(document.querySelectorAll('nav button')).find((b) => b.textContent.trim() === "Look" && !b.disabled); b?.click(); return b ? true : undefined; })()`),
  );

  // The script of the first load goes on, and the slot starts locked
  await pagesAre(["/a"]);
  await appShows(page, "the state of the slot", `document.querySelector('.slot')?.dataset.state`, "shown");
  await appShows(page, "the lock", `document.querySelector(${JSON.stringify(LOCK)})?.getAttribute('aria-checked')`, "true");

  // The lock keeps the site on its page, and opens no window
  await follow("next");
  await appShows(page, "the notice", `(${text(".slot-notice-text")} ?? "").startsWith("The lock kept the site on its page")`, true);
  await follow("win");
  await appShows(page, "the notice", `(${text(".slot-notice-text")} ?? "").startsWith("The lock stopped a new window")`, true);
  await sleep(1000);
  await pagesAre(["/a"]);

  // After an unlock, the site goes to another page, and Back comes back
  await press(page, LOCK);
  await appShows(page, "the lock", `document.querySelector(${JSON.stringify(LOCK)})?.getAttribute('aria-checked')`, "false");
  await follow("next");
  await pagesAre(["/b"]);
  await appShows(page, "the address", `document.querySelector('.slot-address')?.title`, `${origin}/b`);
  await press(page, ".slot-history button[aria-label=Back]");
  await pagesAre(["/a"]);

  // A new window opens as a tab of the slot, and its close removes its page
  await follow("win");
  await pagesAre(["/a", "/c"]);
  await appShows(page, "the count of tabs", `document.querySelectorAll('.slot-tab').length`, 2);
  await press(page, ".slot-tab .slot-close");
  await pagesAre(["/a"]);
  await appShows(page, "the count of tabs", `document.querySelectorAll('.slot-tab').length`, 0);

  // "Add this page" adds the page of the slot to the list
  await follow("next");
  await pagesAre(["/b"]);
  await appShows(page, "the button", text(".slot-add"), "Add this page");
  await press(page, ".slot-add");
  await appShows(page, "the button", text(".slot-add"), "Added");
  await appShows(page, "the count", `(${text("header .count")} ?? "").startsWith("2 sites")`, true);

  // "Return to the site" loads the site again
  await press(page, ".slot-home");
  await pagesAre(["/a"]);
  page.close();
  say("The check of the lock and the tabs passed.");
  code = 0;
} catch (error) {
  console.error(`The check of the lock and the tabs failed: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  app.kill();
  sites.close();
  await sleep(500);
  rmSync(folder, { recursive: true, force: true });
}
process.exit(code);

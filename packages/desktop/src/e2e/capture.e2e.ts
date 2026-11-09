/**
 * The capture check of the desktop app. It is a main process of Electron with no page. It captures local sites in
 * windows off the screen, and examines each result:
 *
 * - A page gives a JPEG picture with the color of the page, its title and its address after a redirect.
 * - A closed port gives the reason `refused`, and a page with no answer gives `timeout`.
 * - A new capture in a full pool stops the oldest capture.
 *
 * After the checks, no window of a capture stays open. `tsdown -c tsdown.e2e.config.ts` builds this file, and CI starts it with
 * `pnpm --filter @pairrank/desktop e2e`.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type CaptureResult, PICTURE_SIZE } from "@pairrank/surfaces";
import { BrowserWindow, app, nativeImage } from "electron";
import { electronCapture } from "../capture.ts";
import { PAINT_DELAY_MS, PICTURE_QUALITY } from "../index.ts";
import { REPLACED, capturePool } from "../pictures.ts";

/** The color of the page of the check, as red, green and blue. */
const COLOR = [0x33, 0x66, 0xcc] as const;
/** The largest difference of one channel of the picture from the color. JPEG changes the color a little. */
const TOLERANCE = 24;

const folder = mkdtempSync(join(tmpdir(), "pairrank-capture-"));
app.setPath("userData", folder);
// The check closes each window of a capture, and the app must not stop then
app.on("window-all-closed", () => undefined);

const started = Date.now();
const say = (text: string): void => console.log(`${String(Date.now() - started).padStart(6)} ms  ${text}`);

/** This function throws when a condition is false. */
function check(condition: boolean, what: string): void {
  if (!condition) throw new Error(what);
  say(`passed: ${what}`);
}

const sites = createServer((request, response) => {
  if (request.url === "/hang") return; // This page never answers
  if (request.url === "/old") {
    response.writeHead(302, { location: "/" });
    response.end();
    return;
  }
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(`<!doctype html><title>Capture</title><body style="margin:0;height:100vh;background:rgb(${COLOR.join(",")})"></body>`);
});

/** This function gives a port of the loopback address that nothing listens on. */
async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const { port } = server.address() as AddressInfo;
  await new Promise((done) => server.close(done));
  return port;
}

/** This function gives the color at the center of a picture, as red, green and blue. */
function centerOf(picture: string): { width: number; rgb: [number, number, number] } {
  const image = nativeImage.createFromDataURL(picture);
  const { width, height } = image.getSize();
  const bitmap = image.toBitmap();
  const at = (Math.floor(height / 2) * width + Math.floor(width / 2)) * 4;
  // The bitmap of Electron has the order blue, green, red and alpha
  return { width, rgb: [bitmap[at + 2] ?? 0, bitmap[at + 1] ?? 0, bitmap[at] ?? 0] };
}

const describe = (result: CaptureResult): string => (result.ok ? `a picture of ${result.picture.length} characters` : `${result.reason}: ${result.detail ?? ""}`);

/** The time limit of the whole check. A hang then fails the check, and CI does not wait for the limit of the job. */
const CHECK_LIMIT_MS = 120_000;

/** This function does each check. It gives the exit code of the check. */
async function checks(): Promise<number> {
  await new Promise<void>((done) => sites.listen(0, "127.0.0.1", done));
  const origin = `http://127.0.0.1:${(sites.address() as AddressInfo).port}`;
  const capture = electronCapture({ timeoutMs: 15_000, paintDelayMs: PAINT_DELAY_MS, quality: PICTURE_QUALITY });
  const never = new AbortController().signal;

  const shown = await capture(`${origin}/old`, PICTURE_SIZE, never);
  say(`the page: ${describe(shown)}`);
  check(shown.ok, "the capture of a page gives a picture");
  if (shown.ok) {
    check(shown.picture.startsWith("data:image/jpeg;base64,"), "the picture is a JPEG image");
    check(shown.title === "Capture" && shown.url === `${origin}/`, "the result has the title, and the address after the redirect");
    const { width, rgb } = centerOf(shown.picture);
    say(`the picture is ${width} px wide, and its center is rgb(${rgb.join(", ")})`);
    check(width > 0 && width <= PICTURE_SIZE.w, "the picture is at most as wide as the window");
    check(
      rgb.every((channel, index) => Math.abs(channel - (COLOR[index] ?? 0)) <= TOLERANCE),
      "the picture has the color of the page",
    );
  }

  const refused = await capture(`http://127.0.0.1:${await closedPort()}/`, PICTURE_SIZE, never);
  say(`a closed port: ${describe(refused)}`);
  check(!refused.ok && refused.reason === "refused", "a closed port gives the reason refused");

  const slow = await electronCapture({ timeoutMs: 1500, paintDelayMs: PAINT_DELAY_MS, quality: PICTURE_QUALITY })(`${origin}/hang`, PICTURE_SIZE, never);
  say(`no answer: ${describe(slow)}`);
  check(!slow.ok && slow.reason === "timeout", "a page with no answer gives the reason timeout");

  const pool = capturePool(capture, 1);
  const [first, second] = await Promise.all([pool.capture(`${origin}/hang`, PICTURE_SIZE), pool.capture(`${origin}/`, PICTURE_SIZE)]);
  say(`the pool: ${describe(first)}, then ${describe(second)}`);
  check(!first.ok && first.detail === REPLACED && second.ok, "a new capture in a full pool stops the oldest capture");

  check(BrowserWindow.getAllWindows().length === 0, "no window of a capture stays open");
  say("The capture check passed.");
  return 0;
}

/** This function closes the server and the folder of the check, and stops Electron with the code. */
function finish(code: number): void {
  sites.closeAllConnections();
  sites.close();
  rmSync(folder, { recursive: true, force: true, maxRetries: 3 });
  app.exit(code);
}

setTimeout(() => {
  console.error(`The capture check failed: it did not end in ${CHECK_LIMIT_MS} ms.`);
  finish(1);
}, CHECK_LIMIT_MS);
say("The capture check starts.");
// Electron fires ready after the main module ends. Thus the module does not wait for ready at its top level.
void app
  .whenReady()
  .then(checks)
  .catch((error: unknown) => {
    console.error(`The capture check failed: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  })
  .then(finish);

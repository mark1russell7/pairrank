/**
 * This file is the entry of the main process of @pairrank/desktop. `tsdown` builds it to `build/main/main.js`, and
 * `pnpm start` starts it with Electron.
 *
 * - The main process opens the log of events. It serves the procedures of `@pairrank/host`, of the bookmarks
 *   (`@pairrank/host/bookmarks`) and of the still pictures (`@pairrank/host/pictures`) on one message port.
 * - A second port carries the commands of the surface of the page, and the events of the views of the sites.
 * - The environment variable `PAGE_URL` gives the address of a page server in development, for example Vite. Without
 *   it, the app shows the files of `build/page/` under `app://page/`.
 * - The environment variable `PAIRRANK_STORE` gives the file of the log. The default is `pairrank.sqlite` in the folder
 *   of the user data. A smoke run uses a log in memory.
 * - With the argument `--smoke`, the app stops with the exit code 0 after the first message of the page. It stops with
 *   1 after a fault, or after 30 seconds with no message. CI uses it.
 */
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pairrankModule } from "@pairrank/host";
import { bookmarksModule, chromeDataFolders, diskFiles } from "@pairrank/host/bookmarks";
import { MAX_CAPTURES, capturePool, picturesModule } from "@pairrank/host/pictures";
import { openStore } from "@pairrank/store";
import { applyCommand, parseCommand } from "@pairrank/surfaces";
import { PortTransport, ProcedureServer, createRegistry, electronPortOf } from "@procedures/client";
import { contentTypeOf } from "@procedures/peer";
import { BrowserWindow, MessageChannelMain, app, protocol, session } from "electron";
import { canonicalUrl } from "polite-crawler/urls";
import {
  CONTENT_SECURITY_POLICY,
  LOAD_TIMEOUT_MS,
  PAGE_SCHEME,
  PAGE_URL,
  PAINT_DELAY_MS,
  PICTURE_QUALITY,
  SHOW_TIMEOUT_MS,
  SITE_PARTITION,
  STORE_FILE,
  allowsNavigation,
  pageFile,
  showWhenReady,
  windowOptions,
} from "./index.ts";
import { electronCapture } from "./capture.ts";
import { siteViews } from "./views.ts";

const build = join(dirname(fileURLToPath(import.meta.url)), "..");
const page = process.env["PAGE_URL"] ?? PAGE_URL;
const smoke = process.argv.includes("--smoke");

/** This function stops the app with an exit code. It tells why on a fault, and in a smoke run. */
function stop(code: number, why: string): void {
  if (code !== 0) console.error(`desktop: ${why}`);
  else if (smoke) console.log(`smoke: ${why}`);
  app.exit(code);
}

// The scheme of the page is a standard and secure scheme, as https is. Electron needs this before the app is ready.
protocol.registerSchemesAsPrivileged([{ scheme: PAGE_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

// A helper process of Electron that stops is a cause of a fault that the person sees, so the terminal tells it
app.on("child-process-gone", (_event, details) => {
  if (details.reason !== "clean-exit") console.error(`desktop: the ${details.type} process stopped (${details.reason}, exit code ${String(details.exitCode)})`);
});

// The window of the app stays at the origin of its page. The views of the sites have their own rules (views.ts).
app.on("web-contents-created", (_event, contents) => {
  contents.on("will-attach-webview", (event) => event.preventDefault());
  if (contents.session !== session.defaultSession) return;
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("will-navigate", (event, url) => {
    if (!allowsNavigation(page, url)) event.preventDefault();
  });
});

/** This function serves the files of the page, with the content security policy. */
async function serveFile(request: Request): Promise<Response> {
  const file = pageFile(join(build, "page"), request.url);
  if (file === undefined) return new Response("Not found", { status: 404 });
  try {
    const body = await readFile(file);
    return new Response(body, { headers: { "content-type": contentTypeOf(file), "content-security-policy": CONTENT_SECURITY_POLICY } });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

async function start(): Promise<void> {
  // The page and the sites ask for no permission: the camera, the microphone, the notifications and the others get no.
  for (const each of [session.defaultSession, session.fromPartition(SITE_PARTITION)]) {
    each.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    each.setPermissionCheckHandler(() => false);
  }
  protocol.handle(PAGE_SCHEME, serveFile);

  const store = openStore(smoke ? ":memory:" : (process.env["PAIRRANK_STORE"] ?? join(app.getPath("userData"), STORE_FILE)));
  app.on("will-quit", () => store.close());
  const bookmarks = bookmarksModule({ folders: chromeDataFolders(process.platform, process.env, homedir()), files: diskFiles });
  const pictures = capturePool(electronCapture({ timeoutMs: LOAD_TIMEOUT_MS, paintDelayMs: PAINT_DELAY_MS, quality: PICTURE_QUALITY }), MAX_CAPTURES);
  const registry = createRegistry(pairrankModule(store, { key: canonicalUrl }), bookmarks, picturesModule(pictures.capture));
  const server = new ProcedureServer({ registry, autoRegister: true });

  const window = new BrowserWindow(windowOptions(join(build, "preload", "preload.cjs")));
  showWhenReady(window, SHOW_TIMEOUT_MS, (message) => console.error(`desktop: ${message}`));
  window.webContents.on("render-process-gone", (_event, details) => stop(1, `the page stopped (${details.reason})`));
  window.webContents.on("did-fail-load", (_event, code, text, url, mainFrame) => {
    // The code -3 (ERR_ABORTED) is a load that a new load replaced. It is not a fault.
    if (mainFrame && code !== -3) stop(1, `the page ${url} did not load (${code} ${text})`);
  });

  // Each load of the page gets new channels and new views, so a reload of the page works. The preload script gets one
  // end of each channel, and gives the two ends to the page.
  let disconnect = (): void => {};
  window.webContents.on("did-finish-load", () => {
    disconnect();
    const procedures = new MessageChannelMain();
    const surface = new MessageChannelMain();
    new PortTransport(electronPortOf(procedures.port1), { serve: server });
    if (smoke) procedures.port1.once("message", () => stop(0, "the page sent its first message"));

    const views = siteViews(
      window,
      (event) => surface.port1.postMessage(event),
      () => window.webContents.focus(),
      () => window.webContents.getZoomFactor(),
    );
    surface.port1.on("message", ({ data }) => {
      try {
        applyCommand(views, parseCommand(data));
      } catch (error) {
        // A command that is not valid is a fault of the page. The views do not change.
        console.error(`desktop: a command of the page was refused: ${String(error)}`);
      }
    });
    surface.port1.start();
    window.webContents.postMessage("ports", null, [procedures.port2, surface.port2]);
    disconnect = () => {
      views.dispose();
      procedures.port1.close();
      surface.port1.close();
    };
  });
  // The window closes its views and the windows of the captures before it goes. A view does not close with its window,
  // and the app stops only after its last window closes.
  window.on("close", () => {
    disconnect();
    pictures.stop();
  });
  if (smoke) setTimeout(() => stop(1, "no message from the page in 30 seconds"), 30_000).unref();
  await window.loadURL(page);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const [window] = BrowserWindow.getAllWindows();
    if (window?.isMinimized()) window.restore();
    window?.focus();
  });
  app.on("window-all-closed", () => app.quit());
  app
    .whenReady()
    .then(start)
    .catch((error: unknown) => stop(1, String(error)));
}

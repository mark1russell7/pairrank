/**
 * The rules of the desktop app @pairrank/desktop, as data and pure functions. The main process (`main.ts`) applies them.
 * Thus a test examines each rule with no Electron process.
 *
 * @packageDocumentation
 */
import { join, normalize } from "node:path";
import { isInside } from "@mark1russell7/files";
import { type Rect, type SizedRect, scaleRect, snapRect, toSizedRect } from "@mark1russell7/layout-contract";
import type { FailReason } from "@pairrank/surfaces";
import type { BrowserWindowConstructorOptions, WebPreferences } from "electron";

export * from "./constants.ts";

/** The scheme of the page of the app. The main process serves the folder of the page under `app://page/`. */
export const PAGE_SCHEME = "app";

/** The address of the first page of the app. */
export const PAGE_URL = "app://page/index.html";

/** The session of the views of the sites. It keeps the logins of the sites, and it is not the session of the page. */
export const SITE_PARTITION = "persist:sites";

/** The name of the file of the log of events, in the folder of the user data of the app. */
export const STORE_FILE = "pairrank.sqlite";

/**
 * The content security policy of each file of the page. The page loads only its own scripts and styles. It has no
 * inline script and no connection to a server.
 */
export const CONTENT_SECURITY_POLICY: string = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

/**
 * This function gives the options of the window. The page has no Node.js, operates in a sandbox, and is isolated from the
 * preload script. Only the preload script gets the message ports of the main process.
 */
export function windowOptions(preload: string): BrowserWindowConstructorOptions {
  return {
    width: 1400,
    height: 900,
    minWidth: 720,
    minHeight: 480,
    show: false,
    title: "pairrank",
    webPreferences: {
      preload,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
    },
  };
}

/** This function gives the options of the view of a site: no preload script, no Node.js, a sandbox, and its own session. */
export function siteViewPreferences(): WebPreferences {
  return {
    partition: SITE_PARTITION,
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    webSecurity: true,
    allowRunningInsecureContent: false,
    webviewTag: false,
  };
}

/**
 * The longest time that the window of the app stays hidden, in milliseconds. The window shows at the first paint of its
 * page. A fault of the GPU process can stop that paint, so after this time the window shows without it.
 */
export const SHOW_TIMEOUT_MS = 4000;

/** The part of a window that `showWhenReady` uses. */
export interface ShownWindow {
  once(event: "ready-to-show", listener: () => void): unknown;
  isDestroyed(): boolean;
  isVisible(): boolean;
  show(): void;
}

/**
 * This function shows a hidden window at the first paint of its page. Without a paint in `timeoutMs`, it shows the
 * window all the same and tells `log` why. A window that closed before stays closed.
 */
export function showWhenReady(window: ShownWindow, timeoutMs: number, log: (message: string) => void): void {
  const show = (): void => {
    if (!window.isDestroyed() && !window.isVisible()) window.show();
  };
  window.once("ready-to-show", show);
  setTimeout(() => {
    if (window.isDestroyed() || window.isVisible()) return;
    log(`the page did not paint in ${String(timeoutMs)} ms, so the window shows before its first paint`);
    show();
  }, timeoutMs).unref();
}

/** The time from the end of the load of a capture to its picture, in milliseconds. The page paints in this time. */
export const PAINT_DELAY_MS = 600;

/** The quality of the JPEG picture of a capture, from 0 to 100. */
export const PICTURE_QUALITY = 80;

/** The frames each second of the window of a capture. The capture needs only the last frame. */
export const CAPTURE_FRAME_RATE = 10;

/**
 * This function gives the options of the window of a capture. The window renders off the screen, with the options and
 * the session of the views of the sites. It has no place in the taskbar, and it cannot get the keys.
 */
export function captureWindowOptions(size: { readonly w: number; readonly h: number }): BrowserWindowConstructorOptions {
  return {
    width: size.w,
    height: size.h,
    useContentSize: true,
    show: false,
    skipTaskbar: true,
    focusable: false,
    webPreferences: { ...siteViewPreferences(), offscreen: true },
  };
}

/** This function gives the origin of an address, or `undefined` when the text is not an address. */
function originOf(address: string): string | undefined {
  try {
    const url = new URL(address);
    // A standard scheme such as app: has the origin "null" in Node.js, so the origin is the scheme and the host
    return `${url.protocol}//${url.host}`;
  } catch {
    return undefined;
  }
}

/** This function tells if the window of the app can go to an address. The window stays at the origin of its page. */
export function allowsNavigation(page: string, target: string): boolean {
  const origin = originOf(page);
  return origin !== undefined && originOf(target) === origin;
}

/** This function tells if the view of a site can go to an address. A site goes only to `http` and `https` addresses. */
export function allowsSiteNavigation(target: string): boolean {
  try {
    const { protocol } = new URL(target);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

/** The most tabs of one slot. A site that opens more windows gets a `blocked` event, so a flood of windows stops. */
export const MAX_TABS = 8;

/**
 * The decision for a navigation of a site in its view: `allow` it, `refuse` it (not a web address), or `block` it (the
 * lock stops it).
 */
export type NavigationDecision = "allow" | "refuse" | "block";

/** The inputs that arm the lock at once. Each is a press of a key, a mouse button, a finger or a pen. */
const ARMING_INPUTS: ReadonlySet<string> = new Set(["mouseDown", "rawKeyDown", "keyDown", "touchStart", "gestureTapDown", "pointerDown"]);

/** This function tells if an input event of a view arms the lock of its tab. A move or a scroll does not arm it. */
export function armsLock(type: string): boolean {
  return ARMING_INPUTS.has(type);
}

/**
 * This function decides a navigation that a site starts in its view: a click, a script or a form. A tab that is still
 * in its first load is not armed, so the redirects of that load go on. After the first load, a locked slot blocks each
 * navigation to another page.
 */
export function navigationOf(target: string, locked: boolean, armed: boolean): NavigationDecision {
  if (!allowsSiteNavigation(target)) return "refuse";
  return locked && armed ? "block" : "allow";
}

/**
 * This function gives the tab to show after a close, from the tabs in their order. The close of a tab that the slot does
 * not show keeps the open tab. The close of the open tab shows the tab before it. The first tab (the site) stays.
 */
export function tabAfterClose(tabs: readonly number[], active: number, closed: number): number {
  const index = tabs.indexOf(closed);
  if (index <= 0 || closed !== active) return active;
  return tabs[index - 1] ?? active;
}

/**
 * This function gives the reason of a failed load from its Chromium error code. The code -3 (`ERR_ABORTED`) is a load
 * that a new load replaced, so it gives `undefined`.
 */
export function failureOf(code: number): FailReason | undefined {
  switch (code) {
    case -3:
      return undefined;
    case -7: // ERR_TIMED_OUT
    case -118: // ERR_CONNECTION_TIMED_OUT
      return "timeout";
    case -10: // ERR_ACCESS_DENIED
    case -20: // ERR_BLOCKED_BY_CLIENT
    case -27: // ERR_BLOCKED_BY_RESPONSE
    case -102: // ERR_CONNECTION_REFUSED
      return "refused";
    default:
      return "network";
  }
}

/**
 * This function gives the bounds of a view from the box of its slot. The page sends the box in CSS pixels, and a view
 * is in the pixels of the window. Thus the box gets the zoom factor of the page first. Then each edge goes to a whole
 * pixel, so two boxes that touch still touch.
 */
export function viewBounds(box: Rect, zoom: number): SizedRect {
  return toSizedRect(snapRect(scaleRect(box, zoom)));
}

/** The fields of a key press of Electron (`before-input-event`) that the rules read. */
export interface KeyInput {
  readonly type: string;
  readonly key: string;
  readonly control: boolean;
  readonly alt: boolean;
  readonly meta: boolean;
}

/**
 * This function tells if a key press in the view of a site gives the keys back to the app. A click on a site gives
 * the keys to the site, and `Escape` gives them back.
 */
export function returnsKeys(input: KeyInput): boolean {
  return input.type === "keyDown" && input.key === "Escape" && !input.control && !input.alt && !input.meta;
}

/**
 * This function gives the file of a request to the page scheme. It gives `undefined` when the request is not for a
 * file in the folder of the page. A path that goes out of the folder, also with an encoded `..`, gives `undefined`. A
 * backslash also gives `undefined`, so the rule is the same on Windows and on Linux.
 */
export function pageFile(root: string, address: string): string | undefined {
  let url: URL;
  let path: string;
  try {
    url = new URL(address);
    path = decodeURIComponent(url.pathname);
  } catch {
    return undefined;
  }
  if (url.protocol !== `${PAGE_SCHEME}:` || url.host !== "page" || path.includes("\0") || path.includes("\\")) return undefined;
  const base = normalize(root);
  const file = normalize(join(base, path === "/" ? "index.html" : path));
  return isInside(base, file) ? file : undefined;
}

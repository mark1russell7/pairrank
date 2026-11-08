/**
 * The rules of the desktop app @pairrank/desktop, as data and pure functions. The main process (`main.ts`) applies them.
 * Thus a test examines each rule with no Electron process.
 *
 * @packageDocumentation
 */
import { extname, join, normalize, sep } from "node:path";
import type { Rect } from "@mark1russell7/layout-contract";
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
 * This function gives the bounds of a view in whole pixels. It rounds each edge, so two boxes that touch still touch.
 * TEMP: this function moves to `snapRect` of `@mark1russell7/layout-contract`, the home of boxes.
 */
export function boundsOf(box: Rect): { x: number; y: number; width: number; height: number } {
  const left = Math.round(box.x);
  const top = Math.round(box.y);
  return { x: left, y: top, width: Math.max(0, Math.round(box.x + box.w) - left), height: Math.max(0, Math.round(box.y + box.h) - top) };
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

/** A message port of the main process of Electron (`MessagePortMain`): an event has its message in `data`. */
export interface MainPort {
  postMessage(message: unknown): void;
  on(type: "message", listener: (event: { readonly data: unknown }) => void): unknown;
  start(): void;
}

/**
 * This function gives a port of the main process in the form that `PortTransport` reads: the Node form, which gives
 * the message itself to the listener. TEMP: this adapter moves to `@procedures/client`, the home of the ports.
 */
export function portOf(port: MainPort): { postMessage(message: unknown): void; on(type: "message", listener: (data: unknown) => void): unknown; start(): void } {
  return {
    postMessage: (message) => port.postMessage(message),
    on: (type, listener) => port.on(type, (event) => listener(event.data)),
    start: () => port.start(),
  };
}

/**
 * This function gives the file of a request to the page scheme, or `undefined` when the request is not for a file in
 * the folder of the page. A path that goes out of the folder, also with an encoded `..`, gives `undefined`. A
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
  return file.startsWith(base.endsWith(sep) ? base : base + sep) ? file : undefined;
}

/** The content type of each kind of file of the page. A module script must have a JavaScript type. */
const TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

/** This function gives the content type of a file of the page. An unknown kind gives `application/octet-stream`. */
export function contentType(file: string): string {
  return TYPES[extname(file).toLowerCase()] ?? "application/octet-stream";
}

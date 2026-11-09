/**
 * The browser host of pairrank. One listener on this computer serves the page of `@pairrank/ui`, the procedures of
 * `@pairrank/host`, the bookmarks files of Chrome and the frame check. The page shows each site in an iframe, not in a
 * view of Electron. With a capture, the host also gives still pictures of the sites that refuse the frame.
 *
 * - The listener is on `127.0.0.1` only. The browser checks of the host refuse a page of another origin, and the check
 *   of the `Host` header stops DNS rebinding.
 * - The page gets a strict content security policy. Only its frames can show other origins.
 * - Only the entry (`main.ts`) starts the host.
 */
import { homedir } from "node:os";
import { pairrankModule } from "@pairrank/host";
import { type Files, bookmarksModule, chromeDataFolders, diskFiles } from "@pairrank/host/bookmarks";
import { type CapturePool, picturesModule } from "@pairrank/host/pictures";
import type { Store } from "@pairrank/store";
import { createRegistry } from "@procedures/client";
import { type HostFetch, createHostFetch } from "@procedures/http";
import { type HostListener, LOCAL_LISTENER_KNOBS, type ProcedureHostOptions, httpFace, staticFace } from "@procedures/peer";
import { canonicalUrl } from "polite-crawler/urls";
import { API_PATH, CHECK_TIMEOUT_MS } from "./constants.ts";
import { frameCheck, framesModule } from "./frames.ts";

export { API_PATH, CHECK_TIMEOUT_MS, LOAD_TIMEOUT_MS } from "./constants.ts";
export { type FrameCheckOptions, frameCheck, framesModule } from "./frames.ts";

/** The default port of the listener. */
export const DEFAULT_PORT = 4800;

/** The default name of the file of the log of events. */
export const STORE_FILE = "pairrank.sqlite";

/**
 * The content security policy of the page. The page loads only its own files, and sends its calls only to its own
 * origin. A frame can show each `http` or `https` site. No other page can show this page in a frame.
 */
export const CONTENT_SECURITY_POLICY: string = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "frame-src http: https:",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

/** The headers of each file of the page. */
export const PAGE_HEADERS: Readonly<Record<string, string>> = {
  "content-security-policy": CONTENT_SECURITY_POLICY,
  "referrer-policy": "no-referrer",
  "cross-origin-opener-policy": "same-origin",
};

/** The options of `webHost`. */
export interface WebHostOptions {
  /** The log of events. The caller opens it and closes it. */
  readonly store: Store;
  /** The folder of the built page: `build/page`. */
  readonly page: string;
  /** The port of the listener. 0 gives a free port. */
  readonly port: number;
  /** The `fetch` of the frame check. The default is `createHostFetch()` of `@procedures/http`. */
  readonly fetch?: HostFetch | undefined;
  /** The folders of the user data of Chrome. The default is the folders of this computer and user. */
  readonly chromeFolders?: readonly string[] | undefined;
  /** The file operations of the bookmarks procedures. The default is the disk. */
  readonly files?: Files | undefined;
  /**
   * The captures of the still pictures (`capturePool` of `@pairrank/host/pictures`). The caller makes the pool and stops
   * it. Without it, the host has no procedure `pictures.capture`, and a refused site stays failed.
   */
  readonly pictures?: CapturePool | undefined;
}

/**
 * This function gives the options of the procedures host. The faces are the procedures over HTTP under `API_PATH`,
 * and the files of the page under `/`. It starts nothing.
 */
export function webHost(options: WebHostOptions): ProcedureHostOptions {
  const { store, page, port, fetch = createHostFetch(), files = diskFiles } = options;
  const folders = options.chromeFolders ?? chromeDataFolders(process.platform, process.env, homedir());
  const listener: HostListener = { port, host: "127.0.0.1", knobs: LOCAL_LISTENER_KNOBS };
  // A site compares its frame-ancestors with the origin of the page. With the port 0, the origin is not known before
  // the start, and the check uses the default port. No site names a loopback origin, so the decision is the same.
  const ancestor = `http://127.0.0.1:${port === 0 ? DEFAULT_PORT : port}`;
  const check = frameCheck({ fetch, ancestor, timeoutMs: CHECK_TIMEOUT_MS });
  return {
    name: "pairrank-web",
    registry: createRegistry(
      pairrankModule(store, { key: canonicalUrl }),
      bookmarksModule({ folders, files }),
      framesModule(check),
      ...(options.pictures === undefined ? [] : [picturesModule(options.pictures.capture)]),
    ),
    faces: { http: httpFace({ basePath: API_PATH }), page: staticFace({ root: page, headers: PAGE_HEADERS }) },
    listen: [listener],
  };
}

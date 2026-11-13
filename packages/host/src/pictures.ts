/**
 * The still pictures of the sites, as a procedure. A host captures a site: the desktop app in a window off the screen,
 * the browser host in a headless browser. The page shows the picture when the site cannot show. Both hosts use this
 * module, and it has no code of a host.
 */
import { PreemptedError, preemptivePool } from "@mark1russell7/service/channel";
import { type Capture, type CaptureResult, MAX_URL, type PictureSize } from "@pairrank/surfaces";
import { isWebUrl } from "@pairrank/input";
import { type ProcedureModule, createProcedure, defineModule, typed } from "@procedures/client";
import { isPublicAddress, parseAddress, specialClass } from "@procedures/http";
import { z } from "zod";

/** A capture that a signal stops. When the signal stops it, the capture closes its window, and ends soon. */
export type StoppableCapture = (url: string, size: PictureSize, signal: AbortSignal) => Promise<CaptureResult>;

/** The captures of a host. */
export interface CapturePool {
  /** This function captures a site. When `max` captures operate, it stops the oldest capture first. */
  readonly capture: Capture;
  /** This function stops each capture that operates. */
  stop(): void;
}

/** The most captures that operate at the same time in a host. A new capture stops the oldest capture. */
export const MAX_CAPTURES = 2;

/** The detail of a capture that a newer capture stopped. */
export const REPLACED = "A newer capture replaced this capture.";

/** The detail of a capture that the host stopped. */
export const STOPPED = "The host stopped the capture.";

/** This function gives the text of an error. */
const textOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * This function gives captures that operate `max` at a time. A new capture stops the oldest capture, because the page
 * ignores the picture of an earlier load. Thus a fast change of sites does not start many windows or browsers. The pool is
 * `preemptivePool` of `@mark1russell7/service`. This function only changes each stop and each error to a failure.
 *
 * A stopped capture ends at once with a failure. A capture that throws ends with the reason `network`.
 */
export function capturePool(run: StoppableCapture, max: number): CapturePool {
  // preemptivePool throws a RangeError when max is not an integer of 1 or more
  const pool = preemptivePool(max);
  const failure = (error: unknown): CaptureResult => {
    // The pool stops the oldest capture with its own error. The page gets the text of this app.
    return { ok: false, reason: "network", detail: error instanceof PreemptedError ? REPLACED : textOf(error) };
  };
  return {
    capture: (url, size) => pool.run((signal) => run(url, size, signal)).catch(failure),
    stop: () => pool.stop(new Error(STOPPED)),
  };
}

/** The smallest and the largest side of the window of a capture, in CSS pixels. */
export const CAPTURE_SIDES = { min: 64, max: 4096 } as const;

/** The domains of the names of this computer and of the local network. */
const LOCAL_DOMAINS: readonly string[] = ["localhost", "local", "internal", "home.arpa"];

/**
 * This function tells if a host name is a name of this computer or of the local network. Such a name is `localhost` or
 * a name in the domain `localhost`, `local` (mDNS), `internal` or `home.arpa`. A final dot changes nothing.
 *
 * TEMP: this function moves to @procedures/http, in the client pull request of the bookmark reader (R28).
 */
export function isLocalName(hostname: string): boolean {
  const name = hostname.toLowerCase().replace(/\.$/, "");
  return LOCAL_DOMAINS.some((domain) => name === domain || name.endsWith(`.${domain}`));
}

/**
 * This function gives the reason that a still picture refuses the host of an address, or `undefined` for a public host.
 * It refuses a name of this computer or of the local network. It also refuses an IP address that is not public, also in
 * an IPv6 form. Examples are loopback, private and link-local addresses and `0.0.0.0`. `isPublicAddress` of
 * `@procedures/http` has all the ranges.
 *
 * The function reads no DNS. `publicCapture` examines the addresses of a name.
 *
 * @param allow - The hosts that pass all the same, as `URL` writes them: `127.0.0.1` or `[::1]`. Only a test of local sites gives them.
 */
export function hostRefusal(address: string, allow: readonly string[] = []): string | undefined {
  let hostname: string;
  try {
    // The URL parser writes each form of an IPv4 address in dotted decimal: 2130706433 and 0x7f.1 are 127.0.0.1
    hostname = new URL(address).hostname;
  } catch {
    return "The address of a capture is not a valid address.";
  }
  if (allow.includes(hostname)) return undefined;
  const ip = parseAddress(hostname);
  if (ip !== undefined) {
    return isPublicAddress(ip) ? undefined : `A still picture shows only a public site. The address ${hostname} is not public (${specialClass(ip) ?? "special"}).`;
  }
  return isLocalName(hostname) ? `A still picture shows only a public site. The host ${hostname} is a name of this computer or of the local network.` : undefined;
}

/**
 * This function gives the addresses of a host name. `systemResolver` of `@procedures/http` is one, and the session of
 * Electron gives another (`resolveHost`).
 */
export type AddressLookup = (hostname: string) => Promise<readonly { readonly address: string }[]>;

/**
 * This function gives a capture that first finds the addresses of the host name with `resolve`. When an address is on
 * this computer or on the local network, the capture gives a failure and opens no window. A lookup that fails does not
 * stop the capture: the browser finds the address again, and it gives its own failure.
 */
export function publicCapture(run: StoppableCapture, resolve: AddressLookup): StoppableCapture {
  return async (url, size, signal) => {
    const refusal = hostRefusal(url) ?? (await nameRefusal(new URL(url).hostname, resolve));
    return refusal === undefined ? run(url, size, signal) : { ok: false, reason: "network", detail: refusal };
  };
}

/** This function gives the reason to refuse a host name with an address that is not public, or `undefined`. */
async function nameRefusal(hostname: string, resolve: AddressLookup): Promise<string | undefined> {
  // An IP address has no name to find
  if (parseAddress(hostname) !== undefined) return undefined;
  let found: readonly { readonly address: string }[];
  try {
    found = await resolve(hostname);
  } catch {
    return undefined;
  }
  const local = found.find((each) => !isPublicAddress(each.address));
  return local === undefined ? undefined : `A still picture shows only a public site. The host ${hostname} has the address ${local.address}, which is not public.`;
}

const URL_ERROR = "The address of a capture is an http or https address.";
const SIDE_ERROR = `The width and the height of a capture are integers from ${CAPTURE_SIDES.min} to ${CAPTURE_SIDES.max}.`;
const SideSchema = z.int({ error: SIDE_ERROR }).min(CAPTURE_SIDES.min, { error: SIDE_ERROR }).max(CAPTURE_SIDES.max, { error: SIDE_ERROR });

/** This function gives the schema of the input of `pictures.capture`. The hosts of `allow` pass the rule of `hostRefusal`. */
function captureInput(allow: readonly string[]) {
  return z.strictObject({
    url: z
      .string({ error: URL_ERROR })
      .max(MAX_URL, { error: `The address of a capture is a text of ${MAX_URL} characters or fewer.` })
      .refine(isWebUrl, { error: URL_ERROR, abort: true })
      .superRefine((url, context) => {
        const refusal = hostRefusal(url, allow);
        if (refusal !== undefined) context.addIssue({ code: "custom", message: refusal });
      }),
    // A size that is not an object gets the message of the sides. An extra key keeps its own message.
    size: z.strictObject({ w: SideSchema, h: SideSchema }, { error: (issue) => (issue.code === "invalid_type" ? SIDE_ERROR : undefined) }),
  });
}

/** The options of `picturesModule`. */
export interface PicturesOptions {
  /**
   * The hosts on this computer or on the local network that a capture can show all the same, as `URL` writes them: for
   * example `127.0.0.1`. The default is none. Only a check of local sites gives them.
   */
  readonly allow?: readonly string[] | undefined;
}

/**
 * This function gives the module of the procedure `pictures.capture`. The procedure loads a site out of the view of
 * the user, and gives a picture of it. A capture does not throw: a failure is a result with a reason.
 */
export function picturesModule(capture: Capture, options: PicturesOptions = {}): ProcedureModule {
  return defineModule("@pairrank/host/pictures", [
    createProcedure()
      .path(["pictures", "capture"])
      .input(captureInput(options.allow ?? []))
      .output(typed<CaptureResult>())
      .meta({
        description: "Load a site out of the view of the user, and give a still picture of it",
        // The site can set its cookies, as in the view of the site
        effects: { reads: ["network"], writes: ["sites.session"], idempotent: false, destructive: false },
      })
      .handler(({ url, size }) => capture(url, size))
      .build(),
  ]);
}

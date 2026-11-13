/**
 * The frame check of the browser host. A page cannot see why a frame stays empty: a refusal by `frame-ancestors` or
 * `X-Frame-Options` also gives a `load` event. Thus, before each load, the page asks the host. The host reads the
 * headers of the site through the host policy of `@procedures/http`, and `frameRefusal` gives the decision of a browser.
 *
 * - The check reads only the headers (`HEAD`). A server that refuses `HEAD` gets a `GET`.
 * - The check has no cookies of the browser. A site can send other headers to a user that is signed in. Thus a pass
 *   of the check is not a promise, and the time limit of the load still applies.
 * - The host policy refuses a private address, for example a router on the local network. The host does not read
 *   such an address, and the check passes: the browser decides.
 */
import { errorMessage } from "@mark1russell7/text";
import { type FrameCheck, type FrameCheckResult, MAX_URL, refusalOf } from "@pairrank/surfaces";
import { type ProcedureModule, createProcedure, defineModule, typed } from "@procedures/client";
import { type HostFetch, type HostFetchResponse, frameRefusal, isHostNotAllowed } from "@procedures/http";
import { z } from "zod";

/** The options of `frameCheck`. */
export interface FrameCheckOptions {
  /** The `fetch` through the host policy: `createHostFetch()` of `@procedures/http`. */
  readonly fetch: HostFetch;
  /** The origin of the page that holds the frames: the origin of the host, for example `http://127.0.0.1:4800`. */
  readonly ancestor: string;
  /** The longest time of one request of the check, in milliseconds. */
  readonly timeoutMs: number;
}

/** This function tells if an error is the end of a time limit (`AbortSignal.timeout`). */
const isTimeout = (error: unknown): boolean => (error as { name?: unknown } | null)?.name === "TimeoutError";

/** This function gives the check of a site before its load in a frame. The check does not throw. */
export function frameCheck({ fetch, ancestor, timeoutMs }: FrameCheckOptions): FrameCheck {
  return async (url: string): Promise<FrameCheckResult> => {
    const reason = refusalOf(url);
    if (reason !== undefined) return { ok: false, reason };
    let response: HostFetchResponse;
    try {
      response = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(timeoutMs) });
      // 405 and 501 tell that the server does not know HEAD
      if (response.status === 405 || response.status === 501) response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      if (isHostNotAllowed(error)) return { ok: true };
      if (isTimeout(error)) return { ok: false, reason: "timeout", detail: errorMessage(error) };
      return { ok: false, reason: "network", detail: errorMessage(error) };
    }
    const decision = frameRefusal(response.headers, { ancestor, page: response.url });
    return decision.refused ? { ok: false, reason: "refused", detail: decision.detail } : { ok: true, url: response.url };
  };
}

const URL_ERROR = `The address of a frame check is a text of 1 to ${MAX_URL} characters.`;

/** The input of `frames.check`. `refusalOf` of `@pairrank/surfaces` examines the address in the check. */
const CheckInput = z.strictObject({ url: z.string({ error: URL_ERROR }).min(1, { error: URL_ERROR }).max(MAX_URL, { error: URL_ERROR }) });

/** This function gives the module of the procedure `frames.check`: the check of a site before its load in a frame. */
export function framesModule(check: FrameCheck): ProcedureModule {
  return defineModule("@pairrank/web/frames", [
    createProcedure()
      .path(["frames", "check"])
      .input(CheckInput)
      .output(typed<FrameCheckResult>())
      .meta({
        description: "Tell if a site refuses to show in a frame of the page",
        effects: { reads: ["network"], writes: [], idempotent: true, destructive: false },
      })
      .handler(({ url }) => check(url))
      .build(),
  ]);
}

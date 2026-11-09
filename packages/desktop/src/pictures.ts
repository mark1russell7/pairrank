/**
 * The still pictures of the sites, as a procedure. The main process captures a site in a window off the screen. The
 * page shows the picture when the view of the site fails. This module has no Electron code, so a test examines it.
 */
import { PreemptedError, preemptivePool } from "@mark1russell7/service/channel";
import type { Capture, CaptureResult, PictureSize } from "@pairrank/surfaces";
import { type ProcedureModule, createProcedure, defineModule, zodAdapter } from "@procedures/client";
import { allowsSiteNavigation } from "./index.ts";

/** A capture that a signal stops. When the signal stops it, the capture closes its window, and ends soon. */
export type StoppableCapture = (url: string, size: PictureSize, signal: AbortSignal) => Promise<CaptureResult>;

/** The captures of the main process. */
export interface CapturePool {
  /** This function captures a site. When `max` captures operate, it stops the oldest capture first. */
  readonly capture: Capture;
  /** This function stops each capture that operates. */
  stop(): void;
}

/** The detail of a capture that a newer capture stopped. */
export const REPLACED = "A newer capture replaced this capture.";

/** The detail of a capture that the app stopped. */
export const STOPPED = "The app stopped the capture.";

/** This function gives the text of an error. */
const textOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * This function gives captures that operate `max` at a time. A new capture stops the oldest capture, because the page
 * ignores the picture of an earlier load. Thus a fast change of sites does not start many windows. The pool is
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

const isSide = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= CAPTURE_SIDES.min && (value as number) <= CAPTURE_SIDES.max;

const CaptureInput = zodAdapter<{ url: string; size: PictureSize }>({
  parse: (value: unknown) => {
    const { url, size } = (value ?? {}) as { url?: unknown; size?: unknown };
    if (typeof url !== "string" || !allowsSiteNavigation(url)) throw new Error("The address of a capture is an http or https address.");
    const { w, h } = (size ?? {}) as { w?: unknown; h?: unknown };
    if (!isSide(w) || !isSide(h)) throw new Error(`The width and the height of a capture are integers from ${CAPTURE_SIDES.min} to ${CAPTURE_SIDES.max}.`);
    return { url, size: { w, h } };
  },
});

const as = <T>() => zodAdapter<T>({ parse: (value: unknown) => value as T });

/**
 * This function gives the module of the procedure `pictures.capture`. The procedure loads a site in a window off the
 * screen, and gives a picture of the window. A capture does not throw: a failure is a result with a reason.
 */
export function picturesModule(capture: Capture): ProcedureModule {
  return defineModule("@pairrank/desktop/pictures", [
    createProcedure()
      .path(["pictures", "capture"])
      .input(CaptureInput)
      .output(as<CaptureResult>())
      .meta({
        description: "Load a site in a window off the screen, and give a still picture of it",
        // The site can set its cookies, as in the view of the site
        effects: { reads: ["network"], writes: ["sites.session"], idempotent: false, destructive: false },
      })
      .handler(({ url, size }) => capture(url, size))
      .build(),
  ]);
}

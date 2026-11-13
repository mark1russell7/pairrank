/**
 * The capture of the browser host. A headless browser of the system loads the site and gives a JPEG picture of the
 * window. The capture gives the picture as a `data:` address.
 *
 * - The render is `renderScreenshotBytes` of `@procedures/browser`. It writes the picture in its own temporary folder,
 *   and removes the folder. This module takes the render as an option, so the tests give a fake render and start no browser.
 * - The listener of the host is on `127.0.0.1` only. Thus the browser of the capture loads only the sites that the user
 *   can also open in their own browser.
 * - A headless browser also makes a picture of its own error page. The page sends only a refused site to the capture,
 *   and a refused site answered the frame check. Thus the site is on the network.
 */
import { errorMessage } from "@mark1russell7/text";
import type { StoppableCapture } from "@pairrank/host/pictures";
import type { CaptureResult } from "@pairrank/surfaces";

/** The virtual time that the scripts and the timers of a site get before the picture, in milliseconds. */
export const CAPTURE_BUDGET_MS = 2_000;

/** The options that the capture gives to a render. They are a part of the options of `renderScreenshotBytes`. */
export interface ScreenshotRequest {
  /** The address of the site. The procedure accepts only `http` and `https` addresses. */
  readonly url: string;
  /** The format of the picture. */
  readonly format: "jpeg";
  /** The size of the window, in CSS pixels. */
  readonly size: { readonly width: number; readonly height: number };
  /** The virtual time before the picture, in milliseconds. */
  readonly budget: number;
  /** The time limit of the render, in milliseconds. */
  readonly timeout: number;
  /** When the signal aborts, the browser stops. */
  readonly signal: AbortSignal;
}

/** A function that gives the bytes of a picture of a site. `renderScreenshotBytes` of `@procedures/browser` is one. */
export type ScreenshotRender = (request: ScreenshotRequest) => Promise<{ readonly data: Uint8Array }>;

/** The options of `headlessCapture`. */
export interface HeadlessCaptureOptions {
  /** The render of the picture. */
  readonly render: ScreenshotRender;
  /** The time limit of the load and the picture, in milliseconds. */
  readonly timeoutMs: number;
  /** The virtual time before the picture, in milliseconds. The default is `CAPTURE_BUDGET_MS`. */
  readonly budgetMs?: number;
  /** The clock of the time limit, in milliseconds. The tests give their own. */
  readonly now?: () => number;
}

/**
 * This function gives a capture with a headless browser.
 *
 * - A stopped capture gives the reason `network`, with the reason of the stop.
 * - A render that throws at the time limit or later gives the reason `timeout`.
 * - A render that throws before the time limit gives the reason `network`, with the text of the error.
 */
export function headlessCapture({ render, timeoutMs, budgetMs = CAPTURE_BUDGET_MS, now = Date.now }: HeadlessCaptureOptions): StoppableCapture {
  return async (url, size, signal): Promise<CaptureResult> => {
    const stopped = (): CaptureResult => ({ ok: false, reason: "network", detail: signal.reason instanceof Error ? signal.reason.message : "The capture stopped." });
    if (signal.aborted) return stopped();
    const start = now();
    try {
      const { data } = await render({ url, format: "jpeg", size: { width: size.w, height: size.h }, budget: budgetMs, timeout: timeoutMs, signal });
      if (signal.aborted) return stopped();
      if (data.length === 0) return { ok: false, reason: "network", detail: "The browser gave an empty picture." };
      return { ok: true, picture: `data:image/jpeg;base64,${Buffer.from(data).toString("base64")}` };
    } catch (error) {
      if (signal.aborted) return stopped();
      if (now() - start >= timeoutMs) return { ok: false, reason: "timeout", detail: `No picture in ${timeoutMs} ms.` };
      return { ok: false, reason: "network", detail: errorMessage(error) };
    }
  };
}

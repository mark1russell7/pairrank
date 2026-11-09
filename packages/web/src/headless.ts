/**
 * The capture of the browser host. A headless browser of the system loads the site and writes a JPEG picture of the
 * window. The capture gives the picture as a `data:` address, and deletes its temporary folder.
 *
 * - The render is `renderScreenshot` of `@procedures/browser`. This module takes the render as an option, so the tests
 *   give a fake render and start no browser.
 * - The listener of the host is on `127.0.0.1` only. Thus the browser of the capture loads only the sites that the user
 *   can also open in their own browser.
 * - A headless browser also writes a picture of its own error page. The page sends only a refused site to the capture,
 *   and a refused site answered the frame check. Thus the site is on the network.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StoppableCapture } from "@pairrank/host/pictures";
import type { CaptureResult } from "@pairrank/surfaces";

/** The virtual time that the scripts and the timers of a site get before the picture, in milliseconds. */
export const CAPTURE_BUDGET_MS = 2_000;

/** The options that the capture gives to a render. They are a part of the options of `renderScreenshot`. */
export interface ScreenshotRequest {
  /** The address of the site. The procedure accepts only `http` and `https` addresses. */
  readonly url: string;
  /** The path of the picture. The extension `.jpg` sets the format. */
  readonly output: string;
  /** The size of the window, in CSS pixels. */
  readonly size: { readonly width: number; readonly height: number };
  /** The virtual time before the picture, in milliseconds. */
  readonly budget: number;
  /** The time limit of the render, in milliseconds. */
  readonly timeout: number;
  /** When the signal aborts, the browser stops. */
  readonly signal: AbortSignal;
}

/** A function that writes a picture of a site to the path `output`. `renderScreenshot` of `@procedures/browser` is one. */
export type ScreenshotRender = (request: ScreenshotRequest) => Promise<unknown>;

/** The options of `headlessCapture`. */
export interface HeadlessCaptureOptions {
  /** The render of the picture. */
  readonly render: ScreenshotRender;
  /** The time limit of the load and the picture, in milliseconds. */
  readonly timeoutMs: number;
  /** The virtual time before the picture, in milliseconds. The default is `CAPTURE_BUDGET_MS`. */
  readonly budgetMs?: number;
  /** The folder of the temporary folders. The default is the temporary folder of the system. */
  readonly folder?: string;
  /** The clock of the time limit, in milliseconds. The tests give their own. */
  readonly now?: () => number;
}

/** This function gives the text of an error. */
const textOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * This function gives a capture with a headless browser. Each capture writes its picture in a new temporary folder,
 * and deletes the folder when it ends, also after a failure or a stop.
 *
 * - A stopped capture gives the reason `network`, with the reason of the stop.
 * - A render that throws at the time limit or later gives the reason `timeout`.
 * - A render that throws before the time limit gives the reason `network`, with the text of the error.
 */
export function headlessCapture({ render, timeoutMs, budgetMs = CAPTURE_BUDGET_MS, folder = tmpdir(), now = Date.now }: HeadlessCaptureOptions): StoppableCapture {
  return async (url, size, signal): Promise<CaptureResult> => {
    const stopped = (): CaptureResult => ({ ok: false, reason: "network", detail: signal.reason instanceof Error ? signal.reason.message : "The capture stopped." });
    if (signal.aborted) return stopped();
    const dir = mkdtempSync(join(folder, "pairrank-capture-"));
    const start = now();
    try {
      const output = join(dir, "picture.jpg");
      await render({ url, output, size: { width: size.w, height: size.h }, budget: budgetMs, timeout: timeoutMs, signal });
      if (signal.aborted) return stopped();
      return { ok: true, picture: `data:image/jpeg;base64,${readFileSync(output).toString("base64")}` };
    } catch (error) {
      if (signal.aborted) return stopped();
      if (now() - start >= timeoutMs) return { ok: false, reason: "timeout", detail: `No picture in ${timeoutMs} ms.` };
      return { ok: false, reason: "network", detail: textOf(error) };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

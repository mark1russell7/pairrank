/**
 * The capture of a site in the main process. A window off the screen loads the site with the rules of the site views.
 * Then it gives its last frame as a JPEG picture.
 */
import type { CaptureResult } from "@pairrank/surfaces";
import { BrowserWindow, type NativeImage } from "electron";
import { CAPTURE_FRAME_RATE, allowsSiteNavigation, captureWindowOptions, failureOf } from "./index.ts";
import type { StoppableCapture } from "./pictures.ts";

/** The options of `electronCapture`. */
export interface ElectronCaptureOptions {
  /** The time limit of the load and the picture, in milliseconds. */
  readonly timeoutMs: number;
  /** The time from the end of the load to the picture, in milliseconds. */
  readonly paintDelayMs: number;
  /** The quality of the JPEG picture, from 0 to 100. */
  readonly quality: number;
}

/**
 * This function gives a capture of a site in a window off the screen. The window has no sound, and it opens no other
 * window. It goes only to `http` and `https` addresses. The capture closes the window when it ends, also after a
 * failure or a stop.
 */
export function electronCapture({ timeoutMs, paintDelayMs, quality }: ElectronCaptureOptions): StoppableCapture {
  return (url, size, signal) =>
    new Promise<CaptureResult>((resolve) => {
      const window = new BrowserWindow(captureWindowOptions(size));
      const contents = window.webContents;
      let painted: NativeImage | undefined;
      let frames = 0;
      let paintTimer: ReturnType<typeof setTimeout> | undefined;
      let ended = false;

      const end = (result: CaptureResult): void => {
        if (ended) return;
        ended = true;
        clearTimeout(limit);
        clearTimeout(paintTimer);
        signal.removeEventListener("abort", onStop);
        if (!window.isDestroyed()) window.destroy();
        resolve(result);
      };
      const onStop = (): void => end({ ok: false, reason: "network", detail: signal.reason instanceof Error ? signal.reason.message : "The capture stopped." });
      const limit = setTimeout(() => end({ ok: false, reason: "timeout", detail: `No picture in ${timeoutMs} ms.` }), timeoutMs);
      if (signal.aborted) return onStop();
      signal.addEventListener("abort", onStop, { once: true });

      /** This function gives the picture of the last frame, at most as wide as the window. */
      const picture = async (): Promise<void> => {
        try {
          let image = painted ?? (await contents.capturePage());
          if (ended) return;
          if (image.isEmpty()) return end({ ok: false, reason: "network", detail: "The page painted no picture." });
          if (image.getSize().width > size.w) image = image.resize({ width: size.w, quality: "good" });
          const data = image.toJPEG(quality).toString("base64");
          end({ ok: true, picture: `data:image/jpeg;base64,${data}`, url: contents.getURL(), title: contents.getTitle() });
        } catch (error) {
          const text = error instanceof Error ? error.message : String(error);
          end({ ok: false, reason: "network", detail: `The window painted ${frames} frames, and its capture failed: ${text}` });
        }
      };

      contents.setAudioMuted(true);
      contents.setFrameRate(CAPTURE_FRAME_RATE);
      contents.setWindowOpenHandler(() => ({ action: "deny" }));
      contents.on("will-navigate", (event, target) => {
        if (!allowsSiteNavigation(target)) event.preventDefault();
      });
      contents.on("paint", (_event, _dirty, image) => {
        painted = image;
        frames += 1;
      });
      contents.on("did-fail-load", (_event, code, text, _url, mainFrame) => {
        const reason = failureOf(code);
        if (mainFrame && reason !== undefined) end({ ok: false, reason, detail: `${text} (${code})` });
      });
      contents.on("render-process-gone", (_event, details) => end({ ok: false, reason: "crashed", detail: details.reason }));
      contents.on("did-finish-load", () => {
        // A redirect of the page loads again, so the picture waits for the last load
        clearTimeout(paintTimer);
        paintTimer = setTimeout(() => void picture(), paintDelayMs);
      });
      // A failure comes as did-fail-load, so the promise of loadURL changes nothing
      void contents.loadURL(url).catch(() => undefined);
    });
}

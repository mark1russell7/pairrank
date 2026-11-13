/**
 * The headless capture of the browser host, with a fake render.
 *
 * - The render gets the address, the format `jpeg`, the size, the budget, the time limit and the signal.
 * - The bytes of the picture come back as a `data:` address of a JPEG image.
 * - A stop, the time limit, an empty picture and another error each give a failure with a reason.
 */
import { describe, expect, it } from "vitest";
import { CAPTURE_BUDGET_MS, type ScreenshotRequest, headlessCapture } from "./headless.ts";

/** The first bytes of a JPEG file. */
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46]);
const URL = "https://example.com/a";
const SIZE = { w: 1280, h: 800 };

describe("headlessCapture", () => {
  it("gives the bytes of the render as a data address", async () => {
    const requests: ScreenshotRequest[] = [];
    const capture = headlessCapture({
      render: async (request) => {
        requests.push(request);
        return { data: new Uint8Array(JPEG) };
      },
      timeoutMs: 20_000,
    });
    const signal = new AbortController().signal;
    const result = await capture(URL, SIZE, signal);
    expect(result).toEqual({ ok: true, picture: `data:image/jpeg;base64,${JPEG.toString("base64")}` });
    expect(requests).toEqual([{ url: URL, format: "jpeg", size: { width: 1280, height: 800 }, budget: CAPTURE_BUDGET_MS, timeout: 20_000, signal }]);
  });

  it("gives the budget of the options to the render", async () => {
    let budget = 0;
    const capture = headlessCapture({
      render: async (request) => {
        budget = request.budget;
        return { data: JPEG };
      },
      timeoutMs: 1_000,
      budgetMs: 250,
    });
    await capture(URL, SIZE, new AbortController().signal);
    expect(budget).toBe(250);
  });

  it("gives the reason network with the text of an error before the time limit", async () => {
    const capture = headlessCapture({
      render: async () => {
        throw new Error("No browser found. Set PDF_BROWSER.");
      },
      timeoutMs: 20_000,
    });
    expect(await capture(URL, SIZE, new AbortController().signal)).toEqual({ ok: false, reason: "network", detail: "No browser found. Set PDF_BROWSER." });
  });

  it("gives the reason timeout to an error at the time limit or later", async () => {
    let time = 0;
    const capture = headlessCapture({
      render: async () => {
        time = 5_000;
        throw new Error("The command stopped.");
      },
      timeoutMs: 5_000,
      now: () => time,
    });
    expect(await capture(URL, SIZE, new AbortController().signal)).toEqual({ ok: false, reason: "timeout", detail: "No picture in 5000 ms." });
  });

  it("gives the reason of a stop, during the render and after it", async () => {
    const stops = new AbortController();
    const capture = headlessCapture({
      render: async () => {
        stops.abort(new Error("A newer capture replaced this capture."));
        return { data: JPEG };
      },
      timeoutMs: 20_000,
    });
    expect(await capture(URL, SIZE, stops.signal)).toEqual({ ok: false, reason: "network", detail: "A newer capture replaced this capture." });

    const thrown = new AbortController();
    const failing = headlessCapture({
      render: async () => {
        thrown.abort("no error");
        throw new Error("The command stopped.");
      },
      timeoutMs: 20_000,
    });
    expect(await failing(URL, SIZE, thrown.signal)).toEqual({ ok: false, reason: "network", detail: "The capture stopped." });
  });

  it("starts no render after a stop", async () => {
    let renders = 0;
    const capture = headlessCapture({
      render: async () => {
        renders += 1;
        return { data: JPEG };
      },
      timeoutMs: 20_000,
    });
    const stops = new AbortController();
    stops.abort(new Error("The host stopped the capture."));
    expect(await capture(URL, SIZE, stops.signal)).toEqual({ ok: false, reason: "network", detail: "The host stopped the capture." });
    expect(renders).toBe(0);
  });

  it("gives the reason network when the render gives an empty picture", async () => {
    const capture = headlessCapture({ render: async () => ({ data: new Uint8Array(0) }), timeoutMs: 20_000 });
    expect(await capture(URL, SIZE, new AbortController().signal)).toEqual({ ok: false, reason: "network", detail: "The browser gave an empty picture." });
  });
});

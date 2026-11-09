/**
 * The headless capture of the browser host, with a fake render.
 *
 * - The render gets the address, a `.jpg` path, the size, the budget, the time limit and the signal.
 * - The picture comes back as a `data:` address of a JPEG image, and the temporary folder goes.
 * - A stop, the time limit and another error each give a failure with a reason, and the folder goes.
 */
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { CAPTURE_BUDGET_MS, type ScreenshotRequest, headlessCapture } from "./headless.ts";

/** The first bytes of a JPEG file. */
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46]);
const URL = "https://example.com/a";
const SIZE = { w: 1280, h: 800 };

/** This function gives a new folder for the temporary folders of one test. */
const scratch = (): string => mkdtempSync(join(tmpdir(), "pairrank-headless-test-"));

describe("headlessCapture", () => {
  it("gives the picture of the render as a data address, and deletes its temporary folder", async () => {
    const folder = scratch();
    const requests: ScreenshotRequest[] = [];
    const capture = headlessCapture({
      render: async (request) => {
        requests.push(request);
        writeFileSync(request.output, JPEG);
      },
      timeoutMs: 20_000,
      folder,
    });
    const signal = new AbortController().signal;
    const result = await capture(URL, SIZE, signal);
    expect(result).toEqual({ ok: true, picture: `data:image/jpeg;base64,${JPEG.toString("base64")}` });
    const [request] = requests;
    expect(request).toMatchObject({ url: URL, size: { width: 1280, height: 800 }, budget: CAPTURE_BUDGET_MS, timeout: 20_000, signal });
    expect(extname(request!.output)).toBe(".jpg");
    expect(dirname(dirname(request!.output))).toBe(folder);
    expect(readdirSync(folder)).toEqual([]);
  });

  it("gives the budget of the options to the render", async () => {
    let budget = 0;
    const capture = headlessCapture({
      render: async (request) => {
        budget = request.budget;
        writeFileSync(request.output, JPEG);
      },
      timeoutMs: 1_000,
      budgetMs: 250,
      folder: scratch(),
    });
    await capture(URL, SIZE, new AbortController().signal);
    expect(budget).toBe(250);
  });

  it("gives the reason network with the text of an error before the time limit", async () => {
    const folder = scratch();
    const capture = headlessCapture({
      render: async () => {
        throw new Error("No browser found. Set PDF_BROWSER.");
      },
      timeoutMs: 20_000,
      folder,
    });
    expect(await capture(URL, SIZE, new AbortController().signal)).toEqual({ ok: false, reason: "network", detail: "No browser found. Set PDF_BROWSER." });
    expect(readdirSync(folder)).toEqual([]);
  });

  it("gives the reason timeout to an error at the time limit or later", async () => {
    const folder = scratch();
    let time = 0;
    const capture = headlessCapture({
      render: async () => {
        time = 5_000;
        throw new Error("The command stopped.");
      },
      timeoutMs: 5_000,
      folder,
      now: () => time,
    });
    expect(await capture(URL, SIZE, new AbortController().signal)).toEqual({ ok: false, reason: "timeout", detail: "No picture in 5000 ms." });
    expect(readdirSync(folder)).toEqual([]);
  });

  it("gives the reason of a stop, during the render and after it, and deletes the folder", async () => {
    const folder = scratch();
    const stops = new AbortController();
    const capture = headlessCapture({
      render: async (request) => {
        writeFileSync(request.output, JPEG);
        stops.abort(new Error("A newer capture replaced this capture."));
      },
      timeoutMs: 20_000,
      folder,
    });
    expect(await capture(URL, SIZE, stops.signal)).toEqual({ ok: false, reason: "network", detail: "A newer capture replaced this capture." });

    const thrown = new AbortController();
    const failing = headlessCapture({
      render: async () => {
        thrown.abort("no error");
        throw new Error("The command stopped.");
      },
      timeoutMs: 20_000,
      folder,
    });
    expect(await failing(URL, SIZE, thrown.signal)).toEqual({ ok: false, reason: "network", detail: "The capture stopped." });
    expect(readdirSync(folder)).toEqual([]);
  });

  it("starts no render and makes no folder after a stop", async () => {
    const folder = scratch();
    let renders = 0;
    const capture = headlessCapture({
      render: async () => {
        renders += 1;
      },
      timeoutMs: 20_000,
      folder,
    });
    const stops = new AbortController();
    stops.abort(new Error("The host stopped the capture."));
    expect(await capture(URL, SIZE, stops.signal)).toEqual({ ok: false, reason: "network", detail: "The host stopped the capture." });
    expect(renders).toBe(0);
    expect(readdirSync(folder)).toEqual([]);
  });

  it("gives the reason network when the render writes no picture", async () => {
    const folder = scratch();
    const capture = headlessCapture({ render: async () => undefined, timeoutMs: 20_000, folder });
    const result = await capture(URL, SIZE, new AbortController().signal);
    expect(result).toMatchObject({ ok: false, reason: "network" });
    expect(existsSync(folder) && readdirSync(folder)).toEqual([]);
  });
});

import type { CaptureResult, PictureSize } from "@pairrank/surfaces";
import { callerOf } from "@procedures/client";
import { describe, expect, it } from "vitest";
import { REPLACED, STOPPED, type StoppableCapture, capturePool, picturesModule } from "./pictures.ts";

const size: PictureSize = { w: 1280, h: 800 };
const PICTURE = "data:image/jpeg;base64,/9j/";

/** A capture that a test ends by hand, with the calls that it got. */
function handRun() {
  const calls: { url: string; signal: AbortSignal; end(result: CaptureResult): void }[] = [];
  const run: StoppableCapture = (url, _size, signal) => new Promise((resolve) => calls.push({ url, signal, end: resolve }));
  return { run, calls };
}

describe("capturePool", () => {
  it("stops the oldest capture when a new capture comes and the pool is full", async () => {
    const { run, calls } = handRun();
    const pool = capturePool(run, 2);
    const first = pool.capture("https://a.example/", size);
    const second = pool.capture("https://b.example/", size);
    const third = pool.capture("https://c.example/", size);
    await Promise.resolve();
    expect(calls.map((call) => [call.url, call.signal.aborted])).toEqual([
      ["https://a.example/", true],
      ["https://b.example/", false],
      ["https://c.example/", false],
    ]);
    expect(await first).toEqual({ ok: false, reason: "network", detail: REPLACED });
    calls[1]?.end({ ok: true, picture: PICTURE });
    calls[2]?.end({ ok: false, reason: "refused" });
    expect(await second).toEqual({ ok: true, picture: PICTURE });
    expect(await third).toEqual({ ok: false, reason: "refused" });
    // The pool has room again, so a new capture stops nothing
    const fourth = pool.capture("https://d.example/", size);
    await Promise.resolve();
    expect(calls.map((call) => call.signal.aborted)).toEqual([true, false, false, false]);
    calls[3]?.end({ ok: true, picture: PICTURE });
    await fourth;
  });

  it("stops each capture, and gives a failure for a capture that throws", async () => {
    const { run, calls } = handRun();
    const pool = capturePool(run, 2);
    const open = pool.capture("https://a.example/", size);
    pool.stop();
    expect(await open).toEqual({ ok: false, reason: "network", detail: STOPPED });
    expect(calls[0]?.signal.aborted).toBe(true);

    const throwing = capturePool(() => {
      throw new Error("No window.");
    }, 1);
    expect(await throwing.capture("https://a.example/", size)).toEqual({ ok: false, reason: "network", detail: "No window." });
    expect(() => capturePool(run, 0)).toThrow(RangeError);
  });
});

describe("picturesModule", () => {
  it("gives the capture of the host to the caller of the procedure pictures.capture", async () => {
    const asked: [string, PictureSize][] = [];
    const caller = callerOf(
      picturesModule(async (url, at) => {
        asked.push([url, at]);
        return { ok: true, picture: PICTURE, title: "A" };
      }),
    );
    expect(await caller(["pictures", "capture"], { url: "https://a.example/", size })).toEqual({ ok: true, picture: PICTURE, title: "A" });
    expect(asked).toEqual([["https://a.example/", size]]);
  });

  it("refuses an address that is not http or https, and a size out of its range", async () => {
    const caller = callerOf(picturesModule(async () => ({ ok: true, picture: PICTURE })));
    await expect(caller(["pictures", "capture"], { url: "file:///etc/hosts", size })).rejects.toThrow("http or https");
    await expect(caller(["pictures", "capture"], { url: "javascript:alert(1)", size })).rejects.toThrow("http or https");
    await expect(caller(["pictures", "capture"], { url: "https://a.example/", size: { w: 10, h: 800 } })).rejects.toThrow("integers from 64 to 4096");
    await expect(caller(["pictures", "capture"], { url: "https://a.example/", size: { w: 1280.5, h: 800 } })).rejects.toThrow("integers");
    await expect(caller(["pictures", "capture"], { url: "https://a.example/" })).rejects.toThrow("integers");
  });
});

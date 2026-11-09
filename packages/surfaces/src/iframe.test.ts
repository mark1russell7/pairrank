import type { Rect } from "@mark1russell7/layout-contract";
import { describe, expect, it } from "vitest";
import { type FrameCheck, type FrameCheckResult, type MakeFrame, iframeSurface } from "./iframe.ts";
import { type Surface, type SurfaceEvent, trackSlots } from "./surface.ts";
import { withLoadTimeout } from "./timeout.ts";

const url = "https://a.example/";
const box: Rect = { x: 10, y: 20, w: 300, h: 200 };

/** A check that a test ends by hand, and the calls that it got. */
function handCheck() {
  const calls: { url: string; end(result: FrameCheckResult): void; fail(error: Error): void }[] = [];
  const check: FrameCheck = (address) =>
    new Promise((resolve, reject) => {
      calls.push({ url: address, end: resolve, fail: reject });
    });
  return { check, calls };
}

/** A frame in memory: its address, its boxes, and a `load` event that the test sends. */
interface FakeFrame {
  readonly url: string;
  readonly boxes: (Rect | undefined)[];
  removed: boolean;
  load(): void;
}

/** This function makes frames in memory, and keeps each frame that it made. */
function fakeFrames() {
  const made: FakeFrame[] = [];
  const frames: MakeFrame = (address, loaded) => {
    const frame: FakeFrame = { url: address, boxes: [], removed: false, load: loaded };
    made.push(frame);
    return {
      place: (next) => frame.boxes.push(next),
      remove: () => {
        frame.removed = true;
      },
    };
  };
  return { frames, made };
}

/** This function gives the events of a surface, in a list. */
function record(surface: Surface): SurfaceEvent[] {
  const events: SurfaceEvent[] = [];
  surface.subscribe((event) => events.push(event));
  return events;
}

/** This function lets the promises of the checks end. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** This function makes a surface with a check and frames that the test controls. */
function setup() {
  const { check, calls } = handCheck();
  const { frames, made } = fakeFrames();
  const surface = iframeSurface({ check, frames });
  return { surface, calls, made, events: record(surface) };
}

describe("iframeSurface", () => {
  it("checks the site, makes its frame, and sends shown at the load of the frame", async () => {
    const { surface, calls, made, events } = setup();
    expect(surface.kind).toBe("iframe");
    expect(surface.show("a", url)).toBe(1);
    expect(calls.map((call) => call.url)).toEqual([url]);
    expect(made).toEqual([]);
    calls[0]?.end({ ok: true, url: "https://a.example/home" });
    await settle();
    expect(made.map((frame) => frame.url)).toEqual([url]);
    made[0]?.load();
    made[0]?.load();
    expect(events).toEqual([
      { type: "loading", slot: "a", load: 1, url },
      { type: "shown", slot: "a", load: 1, url: "https://a.example/home" },
    ]);
  });

  it("sends the refusal of a site, and makes no frame for it", async () => {
    const { surface, calls, made, events } = setup();
    surface.show("a", url);
    calls[0]?.end({ ok: false, reason: "refused", detail: "The site sends frame-ancestors 'none'." });
    await settle();
    expect(made).toEqual([]);
    expect(events.at(-1)).toEqual({ type: "failed", slot: "a", load: 1, url, reason: "refused", detail: "The site sends frame-ancestors 'none'." });
  });

  it("gives the reason network to a check that throws", async () => {
    const { surface, calls, events } = setup();
    surface.show("a", url);
    calls[0]?.fail(new Error("The host did not answer."));
    await settle();
    expect(events.at(-1)).toEqual({ type: "failed", slot: "a", load: 1, url, reason: "network", detail: "The host did not answer." });
  });

  it("refuses an address that is not a web address before a check", () => {
    const { surface, calls, events } = setup();
    expect(surface.show("a", "file:///c:/a.html")).toBe(1);
    expect(calls).toEqual([]);
    expect(events).toEqual([{ type: "failed", slot: "a", load: 1, url: "file:///c:/a.html", reason: "not-web" }]);
  });

  it("ignores the check of an earlier load, and the load event of a removed frame", async () => {
    const { surface, calls, made, events } = setup();
    surface.show("a", url);
    calls[0]?.end({ ok: true });
    await settle();
    surface.show("a", "https://b.example/");
    made[0]?.load();
    calls[1]?.end({ ok: true });
    await settle();
    expect(made.map((frame) => [frame.url, frame.removed])).toEqual([
      [url, true],
      ["https://b.example/", false],
    ]);
    made[0]?.load();
    made[1]?.load();
    expect(events.filter((event) => event.type === "shown")).toEqual([{ type: "shown", slot: "a", load: 2, url: "https://b.example/" }]);

    surface.show("a", url);
    surface.show("a", "https://c.example/");
    calls[2]?.end({ ok: false, reason: "refused" });
    calls[3]?.end({ ok: true });
    await settle();
    expect(events.filter((event) => event.type === "failed")).toEqual([]);
    expect(made.map((frame) => frame.url)).toEqual([url, "https://b.example/", "https://c.example/"]);
  });

  it("puts the frame on the last box of its slot, and hides it for an empty box", async () => {
    const { surface, calls, made } = setup();
    surface.place("a", box);
    surface.show("a", url);
    calls[0]?.end({ ok: true });
    await settle();
    surface.place("a", { ...box, w: 0 });
    surface.place("a", undefined);
    surface.place("a", box);
    expect(made[0]?.boxes).toEqual([box, undefined, undefined, box]);
  });

  it("removes the frame at a clear, and drops the open check", async () => {
    const { surface, calls, made, events } = setup();
    surface.show("a", url);
    calls[0]?.end({ ok: true });
    await settle();
    surface.show("b", url);
    surface.clear("a");
    surface.clear("b");
    calls[1]?.end({ ok: true });
    await settle();
    expect(made.map((frame) => frame.removed)).toEqual([true]);
    expect(events.slice(-2)).toEqual([
      { type: "cleared", slot: "a", load: 1 },
      { type: "cleared", slot: "b", load: 1 },
    ]);
  });

  it("removes the frame of the earlier load at the start of a new load", async () => {
    const { surface, calls, made } = setup();
    surface.show("a", url);
    calls[0]?.end({ ok: true });
    await settle();
    surface.show("a", "mailto:a@a.example");
    expect(made[0]?.removed).toBe(true);
  });

  it("removes each frame and sends nothing after dispose", async () => {
    const { surface, calls, made, events } = setup();
    surface.show("a", url);
    surface.show("b", url);
    calls[0]?.end({ ok: true });
    await settle();
    const before = events.length;
    surface.dispose();
    calls[1]?.end({ ok: true });
    await settle();
    made[0]?.load();
    expect(surface.show("a", url)).toBe(2);
    expect(made.map((frame) => frame.removed)).toEqual([true]);
    expect(events.length).toBe(before);
  });

  it("follows the status of each slot in a tracker, with the time limit", async () => {
    const { check, calls } = handCheck();
    const { frames, made } = fakeFrames();
    const surface = withLoadTimeout(iframeSurface({ check, frames }), { ms: 1_000, timers: { set: () => 0, clear: () => undefined } });
    const tracker = trackSlots(surface);
    surface.show("a", url);
    expect(tracker.status("a")).toEqual({ state: "loading", load: 1, url });
    calls[0]?.end({ ok: true });
    await settle();
    made[0]?.load();
    expect(tracker.status("a")).toEqual({ state: "shown", load: 1, url });
    surface.dispose();
  });
});

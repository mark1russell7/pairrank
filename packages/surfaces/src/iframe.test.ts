import { fakeClock } from "@mark1russell7/algebra/clock";
import type { Rect } from "@mark1russell7/layout-contract";
import { describe, expect, it } from "vitest";
import { type FrameCheck, type FrameCheckResult, type MakeFrame, MAX_RETURNS, iframeSurface } from "./iframe.ts";
import { type BrowseState, SETTLE_MS, type Surface, type SurfaceEvent, trackSlots } from "./surface.ts";
import { withLoadTimeout } from "./timeout.ts";

const url = "https://a.example/";
const box: Rect = { x: 10, y: 20, w: 300, h: 200 };

/** The pages of a frame of `url`. */
const pagesOf = (locked: boolean): BrowseState => ({ locked, tabs: [{ id: 0, url, loading: false }], active: 0, back: false, forward: false, pages: false });

/** A check that a test ends by hand, and the calls that it got. */
function handCheck() {
  const calls: { url: string; end(result: FrameCheckResult): void; fail(error: Error): void }[] = [];
  const check: FrameCheck = (address) =>
    new Promise((resolve, reject) => {
      calls.push({ url: address, end: resolve, fail: reject });
    });
  return { check, calls };
}

/** A frame in memory: its address, its boxes, its locks, its reloads, and a `load` event that the test sends. */
interface FakeFrame {
  readonly url: string;
  readonly boxes: (Rect | undefined)[];
  readonly locks: boolean[];
  reloads: number;
  removed: boolean;
  load(): void;
}

/** This function makes frames in memory, and keeps each frame that it made. */
function fakeFrames() {
  const made: FakeFrame[] = [];
  const frames: MakeFrame = (address, loaded) => {
    const frame: FakeFrame = { url: address, boxes: [], locks: [], reloads: 0, removed: false, load: loaded };
    made.push(frame);
    return {
      place: (next) => void frame.boxes.push(next),
      lock: (locked) => void frame.locks.push(locked),
      reload: () => {
        frame.reloads += 1;
      },
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

/** This function makes a surface with a check, frames and a clock that the test controls. */
function setup() {
  const { check, calls } = handCheck();
  const { frames, made } = fakeFrames();
  const clock = fakeClock();
  const surface = iframeSurface({ check, frames, now: clock.now });
  return { surface, calls, made, clock, events: record(surface) };
}

describe("iframeSurface", () => {
  it("checks the site, makes its frame, and sends shown at the load of the frame", async () => {
    const { surface, calls, made, clock, events } = setup();
    expect(surface.kind).toBe("iframe");
    expect(surface.show("a", url)).toBe(1);
    expect(calls.map((call) => call.url)).toEqual([url]);
    expect(made).toEqual([]);
    calls[0]?.end({ ok: true, url: "https://a.example/home" });
    await settle();
    expect(made.map((frame) => frame.url)).toEqual([url]);
    made[0]?.load();
    clock.block(SETTLE_MS);
    made[0]?.load();
    expect(events).toEqual([
      { type: "loading", slot: "a", load: 1, url },
      { type: "browse", slot: "a", load: 1, browse: pagesOf(true) },
      { type: "shown", slot: "a", load: 1, url: "https://a.example/home" },
      { type: "browse", slot: "a", load: 1, browse: pagesOf(true) },
      { type: "blocked", slot: "a", load: 1, blocked: { kind: "page" } },
    ]);
  });

  it("returns a locked frame to its site after a navigation, and tells the stop", async () => {
    const { surface, calls, made, clock, events } = setup();
    surface.show("a", url);
    calls[0]?.end({ ok: true });
    await settle();
    const frame = made[0];
    frame?.load();
    expect(frame?.locks).toEqual([]);
    // The site goes to another page: the frame loads the site again, and the load of the return is not a navigation
    clock.block(SETTLE_MS);
    frame?.load();
    frame?.load();
    expect(frame?.reloads).toBe(1);
    expect(events.filter((event) => event.type === "blocked")).toEqual([{ type: "blocked", slot: "a", load: 1, blocked: { kind: "page" } }]);
    // A site that leaves again after each return stays where it went after MAX_RETURNS returns
    for (let n = 0; n < MAX_RETURNS + 2; n += 1) {
      clock.block(SETTLE_MS);
      frame?.load();
      frame?.load();
    }
    expect(frame?.reloads).toBe(MAX_RETURNS);
  });

  it("lets the redirects of a script go after the first load and after each return, until a quiet time", async () => {
    const { surface, calls, made, clock, events } = setup();
    surface.show("a", url);
    calls[0]?.end({ ok: true });
    await settle();
    const frame = made[0];
    frame?.load();
    // The script of the site goes to another page soon after the load, and its next page does the same
    clock.block(SETTLE_MS - 1);
    frame?.load();
    clock.block(SETTLE_MS - 1);
    frame?.load();
    expect(frame?.reloads).toBe(0);
    // After a quiet time, a load is a navigation
    clock.block(SETTLE_MS);
    frame?.load();
    expect(frame?.reloads).toBe(1);
    // The return loads the site, and the script of the site goes again
    frame?.load();
    frame?.load();
    expect(frame?.reloads).toBe(1);
    clock.block(SETTLE_MS);
    frame?.load();
    expect(frame?.reloads).toBe(2);
    expect(events.filter((event) => event.type === "blocked")).toHaveLength(2);
  });

  it("unlocks a frame, so its site navigates and opens windows", async () => {
    const { surface, calls, made, events } = setup();
    surface.show("a", url);
    surface.act("a", { type: "lock", locked: false });
    calls[0]?.end({ ok: true });
    await settle();
    // The unlock before the frame holds for the frame
    expect(made[0]?.locks).toEqual([false]);
    made[0]?.load();
    made[0]?.load();
    expect(made[0]?.reloads).toBe(0);
    surface.act("a", { type: "lock", locked: false });
    surface.act("a", { type: "lock", locked: true });
    expect(made[0]?.locks).toEqual([false, true]);
    expect(events.filter((event) => event.type === "browse")).toEqual([
      { type: "browse", slot: "a", load: 1, browse: pagesOf(true) },
      { type: "browse", slot: "a", load: 1, browse: pagesOf(false) },
      { type: "browse", slot: "a", load: 1, browse: pagesOf(false) },
      { type: "browse", slot: "a", load: 1, browse: pagesOf(true) },
    ]);
    expect(events.some((event) => event.type === "blocked")).toBe(false);
  });

  it("loads the site again for home, with no notice, and ignores the actions that a frame cannot do", async () => {
    const { surface, calls, made, events } = setup();
    surface.act("a", { type: "home" });
    surface.show("a", url);
    surface.act("a", { type: "home" });
    calls[0]?.end({ ok: true });
    await settle();
    made[0]?.load();
    surface.act("a", { type: "home" });
    made[0]?.load();
    // The script of the site goes to its page again after home
    made[0]?.load();
    for (const action of [{ type: "back" }, { type: "forward" }, { type: "select", tab: 0 }, { type: "close", tab: 1 }, { type: "open", url, where: "tab" }] as const) surface.act("a", action);
    expect(made[0]?.reloads).toBe(1);
    expect(events.map((event) => event.type)).toEqual(["loading", "browse", "shown", "browse"]);
  });

  it("starts each load locked", async () => {
    const { surface, calls, made } = setup();
    surface.show("a", url);
    surface.act("a", { type: "lock", locked: false });
    surface.show("a", url);
    calls[1]?.end({ ok: true });
    await settle();
    expect(made[0]?.locks).toEqual([]);
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
    const clock = fakeClock();
    const surface = withLoadTimeout(iframeSurface({ check, frames, now: clock.now }), { ms: 1_000, clock });
    const tracker = trackSlots(surface);
    surface.show("a", url);
    expect(tracker.status("a")).toEqual({ state: "loading", load: 1, url, browse: pagesOf(true) });
    calls[0]?.end({ ok: true });
    await settle();
    made[0]?.load();
    expect(tracker.status("a")).toEqual({ state: "shown", load: 1, url, browse: pagesOf(true) });
    clock.block(SETTLE_MS);
    made[0]?.load();
    expect(tracker.status("a")).toEqual({ state: "shown", load: 1, url, browse: pagesOf(true), blocked: { kind: "page" } });
    surface.act("a", { type: "lock", locked: false });
    expect(tracker.status("a")).toEqual({ state: "shown", load: 1, url, browse: pagesOf(false) });
    surface.dispose();
  });
});

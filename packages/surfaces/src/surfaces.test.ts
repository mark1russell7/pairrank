import { fakeClock } from "@mark1russell7/algebra/clock";
import { describe, expect, it } from "vitest";
import { memorySurface } from "./memory.ts";
import { type BrowseState, EMPTY, type SlotStatus, type SurfaceEvent, nextStatus, refusalOf, trackSlots } from "./surface.ts";
import { withLoadTimeout } from "./timeout.ts";

const url = "https://a.example/";

const fold = (events: readonly SurfaceEvent[]): SlotStatus => events.reduce(nextStatus, EMPTY);

describe("nextStatus", () => {
  it("goes from loading to shown, and follows a navigation", () => {
    expect(
      fold([
        { type: "loading", slot: "a", load: 1, url },
        { type: "shown", slot: "a", load: 1, url: "https://a.example/home", title: "A" },
        { type: "navigated", slot: "a", load: 1, url: "https://a.example/about" },
      ]),
    ).toEqual({ state: "shown", load: 1, url: "https://a.example/about", title: "A" });
  });

  it("ignores the events of an earlier load", () => {
    const status = fold([
      { type: "loading", slot: "a", load: 1, url },
      { type: "loading", slot: "a", load: 2, url: "https://b.example/" },
      { type: "shown", slot: "a", load: 1, url },
      { type: "failed", slot: "a", load: 1, url, reason: "network" },
    ]);
    expect(status).toEqual({ state: "loading", load: 2, url: "https://b.example/" });
  });

  it("keeps a failure, but a late page replaces a timeout", () => {
    const failed = fold([
      { type: "loading", slot: "a", load: 1, url },
      { type: "failed", slot: "a", load: 1, url, reason: "refused" },
      { type: "shown", slot: "a", load: 1, url },
    ]);
    expect(failed).toMatchObject({ state: "failed", reason: "refused" });
    const late = fold([
      { type: "loading", slot: "a", load: 1, url },
      { type: "failed", slot: "a", load: 1, url, reason: "timeout" },
      { type: "shown", slot: "a", load: 1, url },
    ]);
    expect(late).toEqual({ state: "shown", load: 1, url });
  });

  it("empties the slot on cleared, and a navigation changes nothing that is not shown", () => {
    expect(fold([{ type: "loading", slot: "a", load: 1, url }, { type: "cleared", slot: "a", load: 1 }])).toEqual({ state: "empty", load: 1 });
    expect(fold([{ type: "loading", slot: "a", load: 1, url }, { type: "navigated", slot: "a", load: 1, url: "https://x.example/" }])).toMatchObject({
      state: "loading",
      url,
    });
  });
});

describe("nextStatus and the pages of a slot", () => {
  const pages = (locked: boolean): BrowseState => ({ locked, tabs: [{ id: 0, url, loading: false }], active: 0, back: false, forward: false, pages: true });
  const loading: SurfaceEvent = { type: "loading", slot: "a", load: 1, url };
  const browse = (locked: boolean, load = 1): SurfaceEvent => ({ type: "browse", slot: "a", load, browse: pages(locked) });
  const stop: SurfaceEvent = { type: "blocked", slot: "a", load: 1, blocked: { kind: "window", url: "https://x.example/" } };

  it("keeps the pages from loading to shown, and through a navigation", () => {
    const status = fold([loading, browse(true), { type: "shown", slot: "a", load: 1, url, title: "A" }, { type: "navigated", slot: "a", load: 1, url: "https://a.example/b" }]);
    expect(status).toEqual({ state: "shown", load: 1, url: "https://a.example/b", title: "A", browse: pages(true) });
  });

  it("keeps a stop while the slot is locked, and an unlock removes it", () => {
    expect(fold([loading, browse(true), stop, browse(true)])).toEqual({ state: "loading", load: 1, url, browse: pages(true), blocked: stop.type === "blocked" ? stop.blocked : undefined });
    expect(fold([loading, browse(true), stop, browse(false)])).toEqual({ state: "loading", load: 1, url, browse: pages(false) });
    // An unlocked slot stops a window only at its limit of tabs, and keeps that notice
    expect(fold([loading, browse(false), stop, browse(false)])).toMatchObject({ blocked: { kind: "window" } });
  });

  it("ignores the pages of another load, of a failure, of an empty slot and of a picture", () => {
    expect(fold([loading, browse(true, 0)])).toEqual({ state: "loading", load: 1, url });
    expect(fold([browse(true)])).toEqual(EMPTY);
    expect(fold([loading, { type: "failed", slot: "a", load: 1, url, reason: "network" }, browse(true), stop])).toMatchObject({ state: "failed" });
    const picture = fold([loading, browse(true), { type: "shown", slot: "a", load: 1, url, picture: "data:image/png;base64,AA==" }, browse(true), stop]);
    expect(picture).toEqual({ state: "shown", load: 1, url, picture: "data:image/png;base64,AA==" });
  });

  it("drops the pages at a new load and at a clear", () => {
    expect(fold([loading, browse(true), stop, { type: "loading", slot: "a", load: 2, url }])).toEqual({ state: "loading", load: 2, url });
    expect(fold([loading, browse(true), { type: "cleared", slot: "a", load: 1 }])).toEqual({ state: "empty", load: 1 });
  });

  it("keeps each action of a memory surface, in its order", () => {
    const memory = memorySurface();
    memory.surface.act("a", { type: "back" });
    memory.surface.act("b", { type: "lock", locked: false });
    memory.surface.dispose();
    memory.surface.act("a", { type: "home" });
    expect(memory.actions).toEqual([
      { slot: "a", action: { type: "back" } },
      { slot: "b", action: { type: "lock", locked: false } },
    ]);
  });
});

describe("refusalOf", () => {
  it("refuses each address that is not a web address", () => {
    expect(refusalOf(url)).toBeUndefined();
    expect(refusalOf("file:///C:/secret.txt")).toBe("not-web");
    expect(refusalOf("javascript:alert(1)")).toBe("not-web");
  });
});

describe("memorySurface and trackSlots", () => {
  it("keeps the status of each slot, and tells each change once", () => {
    const memory = memorySurface();
    const slots = trackSlots(memory.surface);
    const changes: string[] = [];
    slots.subscribe((slot, status) => changes.push(`${slot}:${status.state}`));
    const a = memory.surface.show("a", url);
    memory.surface.show("b", "chrome://settings");
    memory.emit({ type: "shown", slot: "a", load: a, url });
    memory.emit({ type: "shown", slot: "a", load: a, url });
    memory.surface.place("a", { x: 0, y: 40, w: 600, h: 760 });
    expect(slots.status("a")).toEqual({ state: "shown", load: 1, url });
    expect(slots.status("b")).toMatchObject({ state: "failed", reason: "not-web" });
    expect(slots.status("c")).toBe(EMPTY);
    expect(changes).toEqual(["a:loading", "b:failed", "a:shown"]);
    expect(memory.boxes.get("a")).toEqual({ x: 0, y: 40, w: 600, h: 760 });
    slots.stop();
    memory.surface.dispose();
    expect(memory.disposed()).toBe(true);
  });
});

describe("withLoadTimeout", () => {
  it("fails a load with no page in the time limit, and a late page still shows", async () => {
    const memory = memorySurface();
    const clock = fakeClock();
    const surface = withLoadTimeout(memory.surface, { ms: 15_000, clock });
    const slots = trackSlots(surface);
    const load = surface.show("a", url);
    expect(clock.pending).toBe(1);
    await clock.advance(14_999);
    expect(slots.status("a")).toMatchObject({ state: "loading" });
    await clock.advance(1);
    expect(slots.status("a")).toMatchObject({ state: "failed", reason: "timeout", detail: "No page in 15000 ms." });
    memory.emit({ type: "shown", slot: "a", load, url });
    expect(slots.status("a")).toMatchObject({ state: "shown" });
  });

  it("stops the timer when the page comes, at a new load, and at clear", async () => {
    const memory = memorySurface();
    const clock = fakeClock();
    const surface = withLoadTimeout(memory.surface, { ms: 1000, clock });
    const slots = trackSlots(surface);
    const first = surface.show("a", url);
    memory.emit({ type: "shown", slot: "a", load: first, url });
    expect(clock.pending).toBe(0);
    surface.show("a", url);
    surface.show("a", "https://b.example/");
    expect(clock.pending).toBe(1);
    surface.clear("a");
    expect(clock.pending).toBe(0);
    await clock.advance(1000);
    expect(slots.status("a")).toMatchObject({ state: "empty" });
  });

  it("starts no timer for a load that the inner surface refused in show", () => {
    const memory = memorySurface();
    const clock = fakeClock();
    const surface = withLoadTimeout(memory.surface, { ms: 1000, clock });
    surface.show("a", "about:blank");
    expect(clock.pending).toBe(0);
    surface.show("b", url);
    surface.dispose();
    expect(clock.pending).toBe(0);
    expect(memory.disposed()).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { memorySurface } from "./memory.ts";
import { EMPTY, type SlotStatus, type SurfaceEvent, nextStatus, refusalOf, trackSlots } from "./surface.ts";
import { type Timers, withLoadTimeout } from "./timeout.ts";

const url = "https://a.example/";

/** Fake timers: a test starts each due callback with `run`. */
function fakeTimers(): Timers & { run(): void; open(): number } {
  const due = new Map<number, () => void>();
  let next = 0;
  return {
    set: (callback) => {
      due.set(++next, callback);
      return next;
    },
    clear: (handle) => void due.delete(handle as number),
    run: () => {
      const callbacks = [...due.values()];
      due.clear();
      for (const callback of callbacks) callback();
    },
    open: () => due.size,
  };
}

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
  it("fails a load with no page in the time limit, and a late page still shows", () => {
    const memory = memorySurface();
    const timers = fakeTimers();
    const surface = withLoadTimeout(memory.surface, { ms: 15_000, timers });
    const slots = trackSlots(surface);
    const load = surface.show("a", url);
    expect(timers.open()).toBe(1);
    timers.run();
    expect(slots.status("a")).toMatchObject({ state: "failed", reason: "timeout", detail: "No page in 15000 ms." });
    memory.emit({ type: "shown", slot: "a", load, url });
    expect(slots.status("a")).toMatchObject({ state: "shown" });
  });

  it("stops the timer when the page comes, at a new load, and at clear", () => {
    const memory = memorySurface();
    const timers = fakeTimers();
    const surface = withLoadTimeout(memory.surface, { ms: 1000, timers });
    const slots = trackSlots(surface);
    const first = surface.show("a", url);
    memory.emit({ type: "shown", slot: "a", load: first, url });
    expect(timers.open()).toBe(0);
    surface.show("a", url);
    surface.show("a", "https://b.example/");
    expect(timers.open()).toBe(1);
    surface.clear("a");
    expect(timers.open()).toBe(0);
    timers.run();
    expect(slots.status("a")).toMatchObject({ state: "empty" });
  });

  it("starts no timer for a load that the inner surface refused in show", () => {
    const memory = memorySurface();
    const timers = fakeTimers();
    const surface = withLoadTimeout(memory.surface, { ms: 1000, timers });
    surface.show("a", "about:blank");
    expect(timers.open()).toBe(0);
    surface.show("b", url);
    surface.dispose();
    expect(timers.open()).toBe(0);
    expect(memory.disposed()).toBe(true);
  });
});

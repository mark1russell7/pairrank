import { describe, expect, it } from "vitest";
import { withFallback } from "./fallback.ts";
import { memorySurface } from "./memory.ts";
import { type Capture, type CaptureResult, PICTURE_SIZE, isPicture, pictureSurface } from "./picture.ts";
import { type Surface, type SurfaceEvent, trackSlots } from "./surface.ts";

const url = "https://a.example/";
const PNG = "data:image/png;base64,iVBORw0KGgo=";

/** A capture that a test ends by hand, and the calls that it got. */
function handCapture() {
  const calls: { url: string; size: { w: number; h: number }; end(result: CaptureResult): void; fail(error: Error): void }[] = [];
  const capture: Capture = (address, size) =>
    new Promise((resolve, reject) => {
      calls.push({ url: address, size, end: resolve, fail: reject });
    });
  return { capture, calls };
}

/** This function gives the events of a surface, in a list. */
function record(surface: Surface): SurfaceEvent[] {
  const events: SurfaceEvent[] = [];
  surface.subscribe((event) => events.push(event));
  return events;
}

/** This function lets the promises of the captures end. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("isPicture", () => {
  it("accepts only a data address of a PNG or JPEG image", () => {
    expect([PNG, "data:image/jpeg;base64,/9j/"].map(isPicture)).toEqual([true, true]);
    expect(["data:image/svg+xml;base64,PHN2Zz4=", "https://a.example/a.png", "data:text/html;base64,PGI+", ""].map(isPicture)).toEqual([false, false, false, false]);
  });
});

describe("pictureSurface", () => {
  it("captures the site at the size of a desktop window, and sends the picture", async () => {
    const { capture, calls } = handCapture();
    const surface = pictureSurface(capture);
    const events = record(surface);
    expect(surface.show("a", url)).toBe(1);
    expect(calls.map((call) => [call.url, call.size])).toEqual([[url, PICTURE_SIZE]]);
    calls[0]?.end({ ok: true, picture: PNG, url: "https://a.example/home", title: "A" });
    await settle();
    expect(events).toEqual([
      { type: "loading", slot: "a", load: 1, url },
      { type: "shown", slot: "a", load: 1, url: "https://a.example/home", title: "A", picture: PNG },
    ]);
  });

  it("sends the failure of a capture, and refuses a picture that is not an image", async () => {
    const { capture, calls } = handCapture();
    const surface = pictureSurface(capture, { size: { w: 800, h: 600 } });
    const events = record(surface);
    surface.show("a", url);
    surface.show("b", url);
    surface.show("c", url);
    expect(calls[0]?.size).toEqual({ w: 800, h: 600 });
    calls[0]?.end({ ok: false, reason: "timeout", detail: "No page in 20 s." });
    calls[1]?.end({ ok: true, picture: "data:text/html;base64,PGI+" });
    calls[2]?.fail(new Error("The window closed."));
    await settle();
    expect(events.filter((event) => event.type === "failed")).toEqual([
      { type: "failed", slot: "a", load: 1, url, reason: "timeout", detail: "No page in 20 s." },
      { type: "failed", slot: "b", load: 1, url, reason: "network", detail: "The capture gave no PNG or JPEG picture." },
      { type: "failed", slot: "c", load: 1, url, reason: "network", detail: "The window closed." },
    ]);
  });

  it("ignores the capture of an earlier load, and the capture after a clear", async () => {
    const { capture, calls } = handCapture();
    const surface = pictureSurface(capture);
    const tracker = trackSlots(surface);
    surface.show("a", url);
    surface.show("a", "https://b.example/");
    calls[0]?.end({ ok: true, picture: PNG });
    await settle();
    expect(tracker.status("a")).toEqual({ state: "loading", load: 2, url: "https://b.example/" });
    surface.clear("a");
    calls[1]?.end({ ok: true, picture: PNG });
    await settle();
    expect(tracker.status("a")).toEqual({ state: "empty", load: 2 });
  });

  it("refuses an address that is not a web address, with no capture, and stops after dispose", async () => {
    const { capture, calls } = handCapture();
    const surface = pictureSurface(capture);
    const events = record(surface);
    surface.show("a", "file:///etc/passwd");
    expect(calls).toEqual([]);
    expect(events).toEqual([{ type: "failed", slot: "a", load: 1, url: "file:///etc/passwd", reason: "not-web" }]);
    surface.show("a", url);
    surface.dispose();
    calls[0]?.end({ ok: true, picture: PNG });
    await settle();
    expect(events).toHaveLength(2);
  });
});

describe("withFallback", () => {
  /** A live surface in memory, a picture surface with a hand capture, and the fallback of the two on `refused` and `crashed`. */
  function setup() {
    const live = memorySurface("live");
    const { capture, calls } = handCapture();
    const pictures = pictureSurface(capture);
    const surface = withFallback(live.surface, pictures, ["refused", "crashed"]);
    const tracker = trackSlots(surface);
    const events = record(surface);
    return { live, calls, surface, tracker, events };
  }

  const box = { x: 0, y: 0, w: 640, h: 480 };

  it("passes the events of the first surface, with its own numbers", () => {
    const { live, surface, tracker, events } = setup();
    surface.show("a", url);
    surface.place("a", box);
    live.emit({ type: "shown", slot: "a", load: 1, url, title: "A" });
    expect(tracker.status("a")).toEqual({ state: "shown", load: 1, url, title: "A" });
    expect(live.boxes.get("a")).toEqual(box);
    // A failure for a reason with no fallback passes as it is
    surface.show("a", "https://b.example/");
    live.emit({ type: "failed", slot: "a", load: 2, url: "https://b.example/", reason: "network" });
    expect(tracker.status("a")).toMatchObject({ state: "failed", load: 2, reason: "network" });
    expect(events.map((event) => event.type)).toEqual(["loading", "shown", "loading", "failed"]);
  });

  it("shows a picture when the first surface refuses the site, and moves the box to the picture", async () => {
    const { live, calls, surface, tracker } = setup();
    surface.show("a", url);
    surface.place("a", box);
    live.emit({ type: "failed", slot: "a", load: 1, url, reason: "refused", detail: "X-Frame-Options" });
    // The slot stays loading, and the live view of the slot hides
    expect(tracker.status("a")).toEqual({ state: "loading", load: 1, url });
    expect(live.boxes.get("a")).toBeUndefined();
    expect(calls.map((call) => call.url)).toEqual([url]);
    surface.place("a", { ...box, w: 600 });
    expect(live.boxes.get("a")).toBeUndefined();
    calls[0]?.end({ ok: true, picture: PNG, title: "A" });
    await settle();
    expect(tracker.status("a")).toEqual({ state: "shown", load: 1, url, title: "A", picture: PNG });

    // The next load goes to the first surface again, with the box of the slot
    surface.show("a", "https://b.example/");
    expect(live.loads.get("a")).toEqual({ load: 2, url: "https://b.example/" });
    expect(live.boxes.get("a")).toEqual({ ...box, w: 600 });
    expect(tracker.status("a")).toEqual({ state: "loading", load: 2, url: "https://b.example/" });
  });

  it("gives the failure of the first surface, with the two details, when the picture also fails", async () => {
    const { live, calls, surface, tracker } = setup();
    surface.show("a", url);
    live.emit({ type: "failed", slot: "a", load: 1, url, reason: "crashed", detail: "oom" });
    calls[0]?.end({ ok: false, reason: "network", detail: "No route" });
    await settle();
    expect(tracker.status("a")).toEqual({ state: "failed", load: 1, url, reason: "crashed", detail: "oom The picture also failed: No route." });
  });

  it("does not fall back after the page showed, and ignores a picture of an earlier load", async () => {
    const { live, calls, surface, tracker } = setup();
    surface.show("a", url);
    live.emit({ type: "shown", slot: "a", load: 1, url });
    live.emit({ type: "failed", slot: "a", load: 1, url, reason: "crashed" });
    expect(calls).toEqual([]);

    surface.show("a", "https://b.example/");
    live.emit({ type: "failed", slot: "a", load: 2, url: "https://b.example/", reason: "refused" });
    surface.show("a", "https://c.example/");
    calls[0]?.end({ ok: true, picture: PNG });
    await settle();
    expect(tracker.status("a")).toEqual({ state: "loading", load: 3, url: "https://c.example/" });
    // A late event of the live load 2 changes nothing
    live.emit({ type: "shown", slot: "a", load: 2, url: "https://b.example/" });
    expect(tracker.status("a")).toEqual({ state: "loading", load: 3, url: "https://c.example/" });
  });

  it("clears the two surfaces, and disposes them", async () => {
    const { live, calls, surface, tracker } = setup();
    surface.show("a", url);
    live.emit({ type: "failed", slot: "a", load: 1, url, reason: "refused" });
    surface.clear("a");
    expect(tracker.status("a")).toEqual({ state: "empty", load: 1 });
    expect(live.loads.has("a")).toBe(false);
    calls[0]?.end({ ok: true, picture: PNG });
    await settle();
    expect(tracker.status("a")).toEqual({ state: "empty", load: 1 });
    surface.dispose();
    expect(live.disposed()).toBe(true);
  });
});

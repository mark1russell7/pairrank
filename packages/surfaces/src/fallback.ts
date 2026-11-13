/**
 * A fallback from one surface to another. When the first surface fails a load for a given reason, the second surface
 * shows the same address in the same slot. For example, a site that refuses a frame shows as a still picture.
 */
import { createEmitter } from "@mark1russell7/collections";
import type { Rect } from "@mark1russell7/layout-contract";
import type { FailReason, LoadId, SlotId, Surface, SurfaceEvent, SurfaceEvents } from "./surface.ts";

type Failed = Extract<SurfaceEvent, { type: "failed" }>;

/** The open load of a slot. */
interface Open {
  /** The number of the load that the user of the surface sees. */
  readonly load: LoadId;
  readonly url: string;
  /** The surface that shows the load at this time. */
  side: "primary" | "fallback";
  /** The number of the load in the surface of `side`. It is `undefined` while the call of `show` runs. */
  inner: LoadId | undefined;
  /** The first surface sent `shown`, so a later failure is not a reason to fall back. */
  shown: boolean;
  /** The failure of the first surface, after a fallback. */
  failure?: Failed;
}

/**
 * This function gives a surface that shows each load with `primary`. When `primary` fails a load for one of the
 * `reasons` before it shows the page, `fallback` shows the same address. The status of the slot stays `loading` until
 * the fallback ends. When the fallback also fails, the slot gets the failure of `primary`, with the two details.
 *
 * The surface gives its own number to each load. Each slot has the box of the surface that shows it, and the other
 * surface gets no box.
 */
export function withFallback(primary: Surface, fallback: Surface, reasons: readonly FailReason[]): Surface {
  const events = createEmitter<SurfaceEvents>();
  const counts = new Map<SlotId, LoadId>();
  const opens = new Map<SlotId, Open>();
  const boxes = new Map<SlotId, Rect | undefined>();
  let gone = false;
  const send = (event: SurfaceEvent): void => {
    if (!gone) events.emit("event", event);
  };
  /** This function gives the open load of an event of a side, or `undefined` for an event of another load. */
  const openOf = (side: Open["side"], event: SurfaceEvent): Open | undefined => {
    const open = opens.get(event.slot);
    if (open === undefined || open.side !== side) return undefined;
    // An event in the call of show is the first event of the new load
    if (open.inner === undefined) open.inner = event.load;
    return event.load === open.inner ? open : undefined;
  };

  const stopPrimary = primary.subscribe((event) => {
    // The surface sends its own `cleared`, with its own number
    if (event.type === "cleared") return;
    const open = openOf("primary", event);
    if (open === undefined) return;
    if (event.type === "shown") open.shown = true;
    if (event.type === "failed" && !open.shown && reasons.includes(event.reason)) {
      Object.assign(open, { side: "fallback", inner: undefined, failure: event });
      primary.place(event.slot, undefined);
      const inner = fallback.show(event.slot, open.url);
      open.inner ??= inner;
      fallback.place(event.slot, boxes.get(event.slot));
      return;
    }
    send({ ...event, load: open.load });
  });

  const stopFallback = fallback.subscribe((event) => {
    // The slot is already `loading`, and the surface sends its own `cleared`
    if (event.type === "cleared" || event.type === "loading") return;
    const open = openOf("fallback", event);
    if (open === undefined) return;
    if (event.type === "failed" && open.failure !== undefined) {
      const detail = [open.failure.detail, `The picture also failed: ${event.detail ?? event.reason}.`].filter((part) => part !== undefined).join(" ");
      send({ ...open.failure, load: open.load, detail });
      return;
    }
    send({ ...event, load: open.load });
  });

  return {
    kind: primary.kind,
    show(slot, url) {
      const load = (counts.get(slot) ?? 0) + 1;
      counts.set(slot, load);
      if (gone) return load;
      const fellBack = opens.get(slot)?.side === "fallback";
      if (fellBack) fallback.clear(slot);
      const open: Open = { load, url, side: "primary", inner: undefined, shown: false };
      opens.set(slot, open);
      const inner = primary.show(slot, url);
      if (open.side === "primary") {
        open.inner = inner;
        // The slot stays visible from load to load, so the first surface gets its box again
        if (fellBack) primary.place(slot, boxes.get(slot));
      }
      return load;
    },
    place(slot, box) {
      if (gone) return;
      boxes.set(slot, box);
      if (opens.get(slot)?.side === "fallback") fallback.place(slot, box);
      else primary.place(slot, box);
    },
    act(slot, action) {
      if (gone) return;
      if (opens.get(slot)?.side === "fallback") fallback.act(slot, action);
      else primary.act(slot, action);
    },
    clear(slot) {
      const open = opens.get(slot);
      opens.delete(slot);
      primary.clear(slot);
      if (open?.side === "fallback") fallback.clear(slot);
      send({ type: "cleared", slot, load: counts.get(slot) ?? 0 });
    },
    subscribe: (listener) => events.on("event", listener),
    dispose() {
      if (gone) return;
      gone = true;
      stopPrimary();
      stopFallback();
      events.dispose();
      opens.clear();
      primary.dispose();
      fallback.dispose();
    },
  };
}

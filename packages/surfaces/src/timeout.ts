/**
 * A time limit for the loads of a surface. A site that does not answer must not keep a slot in the status `loading`.
 */
import { type Cancel, type Clock, realClock } from "@mark1russell7/algebra/clock";
import { createEmitter } from "@mark1russell7/collections";
import type { LoadId, SlotId, Surface, SurfaceEvent, SurfaceEvents } from "./surface.ts";

/** The options of `withLoadTimeout`. */
export interface TimeoutOptions {
  /** The time limit of a load, in milliseconds. */
  readonly ms: number;
  /** The clock of the timers. The default is `realClock`. A test gives `fakeClock()`. */
  readonly clock?: Clock;
}

/**
 * This function gives a surface that sends `failed` with the reason `timeout` for a load with no `shown` and no `failed`
 * in the time limit. The page of the slot stays, so a late `shown` of the same load replaces the failure (`nextStatus`).
 */
export function withLoadTimeout(surface: Surface, { ms, clock = realClock }: TimeoutOptions): Surface {
  const events = createEmitter<SurfaceEvents>();
  /** The timer of the open load of each slot. */
  const pending = new Map<SlotId, { readonly load: LoadId; readonly cancel: Cancel }>();
  /** The last load of each slot that ended: `shown`, `failed` or `cleared`. */
  const ended = new Map<SlotId, LoadId>();
  const send = (event: SurfaceEvent): void => events.emit("event", event);
  const end = (slot: SlotId): void => {
    const entry = pending.get(slot);
    if (entry === undefined) return;
    entry.cancel();
    pending.delete(slot);
  };
  const stop = surface.subscribe((event) => {
    if (event.type === "shown" || event.type === "failed" || event.type === "cleared") {
      ended.set(event.slot, Math.max(event.load, ended.get(event.slot) ?? 0));
      const entry = pending.get(event.slot);
      if (entry !== undefined && event.load >= entry.load) end(event.slot);
    }
    send(event);
  });
  return {
    kind: surface.kind,
    show(slot, url) {
      end(slot);
      const load = surface.show(slot, url);
      // The inner surface can end the load in show, for example for an address that is not a web address
      if ((ended.get(slot) ?? 0) >= load) return load;
      const cancel = clock.after(ms, () => {
        pending.delete(slot);
        send({ type: "failed", slot, load, url, reason: "timeout", detail: `No page in ${ms} ms.` });
      });
      pending.set(slot, { load, cancel });
      return load;
    },
    place: (slot, box) => surface.place(slot, box),
    act: (slot, action) => surface.act(slot, action),
    clear(slot) {
      end(slot);
      surface.clear(slot);
    },
    subscribe: (listener) => events.on("event", listener),
    dispose() {
      for (const slot of [...pending.keys()]) end(slot);
      stop();
      events.dispose();
      surface.dispose();
    },
  };
}

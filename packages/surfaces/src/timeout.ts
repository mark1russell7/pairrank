/**
 * A time limit for the loads of a surface. A site that does not answer must not keep a slot in the status `loading`.
 */
import type { LoadId, SlotId, Surface, SurfaceEvent, SurfaceListener } from "./surface.ts";

/** The timers of the host. The package has no timers of its own, so a test gives fake timers. */
export interface Timers {
  set(callback: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

/** The options of `withLoadTimeout`. */
export interface TimeoutOptions {
  /** The time limit of a load, in milliseconds. */
  readonly ms: number;
  readonly timers: Timers;
}

/**
 * This function gives a surface that sends `failed` with the reason `timeout` for a load with no `shown` and no `failed`
 * in the time limit. The page of the slot stays, so a late `shown` of the same load replaces the failure (`nextStatus`).
 */
export function withLoadTimeout(surface: Surface, { ms, timers }: TimeoutOptions): Surface {
  const listeners = new Set<SurfaceListener>();
  /** The timer of the open load of each slot. */
  const pending = new Map<SlotId, { readonly load: LoadId; readonly handle: unknown }>();
  /** The last load of each slot that ended: `shown`, `failed` or `cleared`. */
  const ended = new Map<SlotId, LoadId>();
  const send = (event: SurfaceEvent): void => {
    for (const listener of listeners) listener(event);
  };
  const end = (slot: SlotId): void => {
    const entry = pending.get(slot);
    if (entry === undefined) return;
    timers.clear(entry.handle);
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
      const handle = timers.set(() => {
        pending.delete(slot);
        send({ type: "failed", slot, load, url, reason: "timeout", detail: `No page in ${ms} ms.` });
      }, ms);
      pending.set(slot, { load, handle });
      return load;
    },
    place: (slot, box) => surface.place(slot, box),
    act: (slot, action) => surface.act(slot, action),
    clear(slot) {
      end(slot);
      surface.clear(slot);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      for (const slot of [...pending.keys()]) end(slot);
      stop();
      listeners.clear();
      surface.dispose();
    },
  };
}

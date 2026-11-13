/**
 * A surface in memory, with no window. The tests of the interface and of the adapters use it. A test gives each event
 * of a site with `emit`.
 */
import { createEmitter } from "@mark1russell7/collections";
import type { Rect } from "@mark1russell7/layout-contract";
import { type LoadId, type SlotAction, type SlotId, type Surface, type SurfaceEvent, type SurfaceEvents, refusalOf } from "./surface.ts";

/** A surface in memory, and what it got. */
export interface MemorySurface {
  readonly surface: Surface;
  /** The last load of each slot, by slot. */
  readonly loads: ReadonlyMap<SlotId, { readonly load: LoadId; readonly url: string }>;
  /** The box of each slot, by slot. `undefined` is a hidden slot. */
  readonly boxes: ReadonlyMap<SlotId, Rect | undefined>;
  /** The actions of the person, in their order. The surface changes nothing for them: the test sends the events. */
  readonly actions: readonly { readonly slot: SlotId; readonly action: SlotAction }[];
  /** This function sends an event, as a site does. */
  emit(event: SurfaceEvent): void;
  /** This function tells if `dispose` stopped the surface. */
  disposed(): boolean;
}

/**
 * This function makes a surface in memory. `show` sends `loading`, or `failed` with the reason `not-web` for an address
 * that is not a web address. The test sends the other events with `emit`.
 */
export function memorySurface(kind = "memory"): MemorySurface {
  const events = createEmitter<SurfaceEvents>();
  const loads = new Map<SlotId, { load: LoadId; url: string }>();
  const boxes = new Map<SlotId, Rect | undefined>();
  const counts = new Map<SlotId, LoadId>();
  const actions: { slot: SlotId; action: SlotAction }[] = [];
  let gone = false;
  const emit = (event: SurfaceEvent): void => {
    if (!gone) events.emit("event", event);
  };
  const surface: Surface = {
    kind,
    show(slot, url) {
      const load = (counts.get(slot) ?? 0) + 1;
      counts.set(slot, load);
      if (gone) return load;
      loads.set(slot, { load, url });
      const reason = refusalOf(url);
      emit(reason === undefined ? { type: "loading", slot, load, url } : { type: "failed", slot, load, url, reason });
      return load;
    },
    place(slot, box) {
      if (!gone) boxes.set(slot, box);
    },
    clear(slot) {
      const load = counts.get(slot) ?? 0;
      loads.delete(slot);
      emit({ type: "cleared", slot, load });
    },
    act(slot, action) {
      if (!gone) actions.push({ slot, action });
    },
    subscribe: (listener) => events.on("event", listener),
    dispose() {
      gone = true;
      events.dispose();
      loads.clear();
      boxes.clear();
    },
  };
  return { surface, loads, boxes, actions, emit, disposed: () => gone };
}

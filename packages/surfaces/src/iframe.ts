/**
 * A surface of `iframe` elements, for a host with no Electron. A page cannot see why a frame shows no site: a refusal
 * and a network failure both give a `load` event. Thus the surface asks the host before each load. The host reads the
 * response of the site, and tells if the site refuses a frame.
 */
import type { Rect } from "@mark1russell7/layout-contract";
import { type FailReason, type LoadId, type SlotId, type Surface, type SurfaceEvent, type SurfaceListener, refusalOf } from "./surface.ts";

/** The result of a check of a site: the site accepts a frame, or the reason of a failure. */
export type FrameCheckResult =
  | {
      readonly ok: true;
      /** The address of the page after its redirects. */
      readonly url?: string;
    }
  | { readonly ok: false; readonly reason: FailReason; readonly detail?: string };

/** A function that asks the host if the site at an address shows in a frame of the page. */
export type FrameCheck = (url: string) => Promise<FrameCheckResult>;

/** A frame that shows one load of a slot. */
export interface Frame {
  /** This method puts the frame in a box of the window, in CSS pixels. `undefined` hides the frame and keeps its page. */
  place(box: Rect | undefined): void;
  /** This method removes the frame and its page. */
  remove(): void;
}

/** A function that makes a frame, and starts a load of the address in it. Each `load` event of the frame starts `loaded`. */
export type MakeFrame = (url: string, loaded: () => void) => Frame;

/** The options of `iframeSurface`. */
export interface IframeOptions {
  /** The check of each address before its load. */
  readonly check: FrameCheck;
  /** The function that makes the frames. The host gives it, because this package has no DOM. */
  readonly frames: MakeFrame;
  readonly kind?: string;
}

/** A slot with a frame. */
interface Entry {
  readonly frame: Frame;
  readonly load: LoadId;
}

/**
 * This function makes a surface of frames. `show` sends `loading`, and starts the check of the address. A refusal
 * gives `failed`. Else the surface makes a frame of the address, and its first `load` event gives `shown`. The page
 * of a cross-origin frame is not visible to the surface, so `shown` has no title, and a navigation gives no event.
 */
export function iframeSurface({ check, frames, kind = "iframe" }: IframeOptions): Surface {
  const listeners = new Set<SurfaceListener>();
  const counts = new Map<SlotId, LoadId>();
  /** The open check of each slot, by its load. */
  const checks = new Map<SlotId, LoadId>();
  const entries = new Map<SlotId, Entry>();
  const boxes = new Map<SlotId, Rect | undefined>();
  let gone = false;
  const emit = (event: SurfaceEvent): void => {
    if (gone) return;
    for (const listener of [...listeners]) listener(event);
  };
  /** This function removes the frame of a slot. */
  const drop = (slot: SlotId): void => {
    entries.get(slot)?.frame.remove();
    entries.delete(slot);
  };
  /** This function makes the frame of a load, after its check. */
  const open = (slot: SlotId, load: LoadId, url: string, shownUrl: string): void => {
    let ended = false;
    const frame = frames(url, () => {
      if (ended || entries.get(slot)?.load !== load) return;
      ended = true;
      emit({ type: "shown", slot, load, url: shownUrl });
    });
    entries.set(slot, { frame, load });
    frame.place(boxes.get(slot));
  };
  return {
    kind,
    show(slot, url) {
      const load = (counts.get(slot) ?? 0) + 1;
      counts.set(slot, load);
      if (gone) return load;
      // A new load removes the frame of the earlier load, so the earlier page sends no event
      drop(slot);
      const reason = refusalOf(url);
      if (reason !== undefined) {
        checks.delete(slot);
        emit({ type: "failed", slot, load, url, reason });
        return load;
      }
      checks.set(slot, load);
      emit({ type: "loading", slot, load, url });
      const fail = (reason: FailReason, detail: string | undefined): void => {
        if (checks.get(slot) !== load) return;
        checks.delete(slot);
        emit({ type: "failed", slot, load, url, reason, ...(detail === undefined ? {} : { detail }) });
      };
      check(url).then(
        (result) => {
          if (!result.ok) {
            fail(result.reason, result.detail);
            return;
          }
          if (checks.get(slot) !== load) return;
          checks.delete(slot);
          open(slot, load, url, result.url ?? url);
        },
        (error: unknown) => fail("network", error instanceof Error ? error.message : String(error)),
      );
      return load;
    },
    place(slot, box) {
      const visible = box === undefined || box.w <= 0 || box.h <= 0 ? undefined : box;
      boxes.set(slot, visible);
      entries.get(slot)?.frame.place(visible);
    },
    clear(slot) {
      checks.delete(slot);
      drop(slot);
      emit({ type: "cleared", slot, load: counts.get(slot) ?? 0 });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      gone = true;
      listeners.clear();
      checks.clear();
      for (const slot of [...entries.keys()]) drop(slot);
      boxes.clear();
    },
  };
}

/**
 * A surface of `iframe` elements, for a host with no Electron. A page cannot see why a frame shows no site: a refusal
 * and a network failure both give a `load` event. Thus the surface asks the host before each load. The host reads the
 * response of the site, and tells if the site refuses a frame.
 */
import type { Rect } from "@mark1russell7/layout-contract";
import { type BrowseState, type FailReason, type LoadId, SETTLE_MS, type SlotId, type Surface, type SurfaceEvent, type SurfaceListener, refusalOf } from "./surface.ts";

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
  /**
   * This method lets the site of the frame open windows (`false`), or stops them (`true`). A new frame starts locked. A
   * change holds from the next page of the frame.
   */
  lock(locked: boolean): void;
  /** This method loads the address of the frame again. */
  reload(): void;
  /** This method removes the frame and its page. */
  remove(): void;
}

/**
 * A function that makes a locked frame, and starts a load of the address in it. Each `load` event of the frame starts
 * `loaded`.
 */
export type MakeFrame = (url: string, loaded: () => void) => Frame;

/** The options of `iframeSurface`. */
export interface IframeOptions {
  /** The check of each address before its load. */
  readonly check: FrameCheck;
  /** The function that makes the frames. The host gives it, because this package has no DOM. */
  readonly frames: MakeFrame;
  readonly kind?: string;
  /** The clock of the lock, in milliseconds. The default is `Date.now`. */
  readonly now?: () => number;
}

/** The most times that a locked frame goes back to its site in one load. A site that leaves again after that stays where it went. */
export const MAX_RETURNS = 3;

/** A slot with a frame. */
interface Entry {
  readonly frame: Frame;
  readonly load: LoadId;
  /** The frame sent its first `load` event, so the slot shows the site. */
  ended: boolean;
  /** The count of the times that the locked frame went back to its site. */
  returns: number;
  /** The count of the `load` events still to come from these loads and from `home`. They are not navigations of the site. */
  skip: number;
  /** The first load of the site ended, so a later `load` event is a navigation of the site. A load by the surface makes it false again. */
  armed: boolean;
  /** The time of the last `load` event of the frame. */
  last: number;
}

/** The lock of the open load of a slot. */
interface Lock {
  readonly load: LoadId;
  readonly url: string;
  locked: boolean;
}

/** This function gives the pages of a frame: one tab, and no history, because the frame of another origin hides them. */
function browseOf({ url, locked }: Lock): BrowseState {
  return { locked, tabs: [{ id: 0, url, loading: false }], active: 0, back: false, forward: false, pages: false };
}

/**
 * This function makes a surface of frames. `show` sends `loading`, and starts the check of the address. A refusal
 * gives `failed`. Else the surface makes a frame of the address, and its first `load` event gives `shown`. The page
 * of a cross-origin frame is not visible to the surface, so `shown` has no title, and a navigation gives no event.
 *
 * Each load starts locked. A locked frame opens no window. A `load` event within `SETTLE_MS` of the last `load` event is
 * a redirect of a script, until the first quiet time. After that, a `load` event of a locked frame is a navigation of the
 * site. Then the surface loads the address of the site again, and sends `blocked`.
 *
 * The action `lock` changes the lock, and `home` loads the site again. The surface ignores the other actions, because a frame of another origin hides its
 * tabs and its history.
 */
export function iframeSurface({ check, frames, kind = "iframe", now = Date.now }: IframeOptions): Surface {
  const listeners = new Set<SurfaceListener>();
  const counts = new Map<SlotId, LoadId>();
  /** The open check of each slot, by its load. */
  const checks = new Map<SlotId, LoadId>();
  const entries = new Map<SlotId, Entry>();
  const locks = new Map<SlotId, Lock>();
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
    const frame = frames(url, () => {
      const entry = entries.get(slot);
      if (entry?.load !== load) return;
      const time = now();
      const quiet = time - entry.last;
      entry.last = time;
      if (!entry.ended) {
        entry.ended = true;
        emit({ type: "shown", slot, load, url: shownUrl });
        // A `shown` after the time limit replaces a failure, which has no pages, so the pages come again
        const lock = locks.get(slot);
        if (lock?.load === load) emit({ type: "browse", slot, load, browse: browseOf(lock) });
        return;
      }
      if (entry.skip > 0) {
        entry.skip -= 1;
        return;
      }
      // A load soon after the last load is a redirect of a script, so it is a part of the first load
      if (!entry.armed && quiet < SETTLE_MS) return;
      entry.armed = true;
      const lock = locks.get(slot);
      if (lock?.load !== load || !lock.locked || entry.returns >= MAX_RETURNS) return;
      entry.returns += 1;
      entry.skip += 1;
      entry.armed = false;
      entry.frame.reload();
      emit({ type: "blocked", slot, load, blocked: { kind: "page" } });
    });
    entries.set(slot, { frame, load, ended: false, returns: 0, skip: 0, armed: false, last: now() });
    if (locks.get(slot)?.locked === false) frame.lock(false);
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
      locks.delete(slot);
      const reason = refusalOf(url);
      if (reason !== undefined) {
        checks.delete(slot);
        emit({ type: "failed", slot, load, url, reason });
        return load;
      }
      checks.set(slot, load);
      const lock: Lock = { load, url, locked: true };
      locks.set(slot, lock);
      emit({ type: "loading", slot, load, url });
      emit({ type: "browse", slot, load, browse: browseOf(lock) });
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
    act(slot, action) {
      const lock = locks.get(slot);
      const entry = entries.get(slot);
      if (gone || lock === undefined) return;
      if (action.type === "lock") {
        if (lock.locked === action.locked) return;
        lock.locked = action.locked;
        if (entry?.load === lock.load) entry.frame.lock(action.locked);
        emit({ type: "browse", slot, load: lock.load, browse: browseOf(lock) });
      } else if (action.type === "home" && entry?.load === lock.load && entry.ended) {
        entry.skip += 1;
        entry.armed = false;
        entry.frame.reload();
      }
    },
    clear(slot) {
      checks.delete(slot);
      locks.delete(slot);
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
      locks.clear();
      for (const slot of [...entries.keys()]) drop(slot);
      boxes.clear();
    },
  };
}

/**
 * The contract of a surface: a thing that shows a site in a slot of the window. Each adapter (an Electron view, an
 * `iframe`, later a screenshot) obeys this contract, so the interface of the app does not know which adapter it uses.
 */
import type { Rect } from "@mark1russell7/layout-contract";
import { isWebUrl } from "@pairrank/input";

/** The name of a slot. A tag run has one slot, and a duel has two: `a` and `b`. */
export type SlotId = string;

/**
 * The number of a load in its slot. Each call of `show` gives a new number. An event of an earlier load of the slot is
 * stale, and the status of the slot does not change for it.
 */
export type LoadId = number;

/** The reason of a load that failed. */
export type FailReason =
  /** The site refused to show in a frame, or refused the connection. */
  | "refused"
  /** The network or the address failed: no name, no route, a bad certificate. */
  | "network"
  /** The site gave no page in the time limit. */
  | "timeout"
  /** The process of the page stopped. */
  | "crashed"
  /** The address is not an `http` or `https` address. The adapter does not open it. */
  | "not-web";

/** An event of a slot. */
export type SurfaceEvent =
  | { readonly type: "loading"; readonly slot: SlotId; readonly load: LoadId; readonly url: string }
  | { readonly type: "shown"; readonly slot: SlotId; readonly load: LoadId; readonly url: string; readonly title?: string }
  | { readonly type: "failed"; readonly slot: SlotId; readonly load: LoadId; readonly url: string; readonly reason: FailReason; readonly detail?: string }
  /** The site went to another address in its slot, for example after a click. */
  | { readonly type: "navigated"; readonly slot: SlotId; readonly load: LoadId; readonly url: string }
  | { readonly type: "cleared"; readonly slot: SlotId; readonly load: LoadId };

/**
 * This function gives the reason to refuse an address before a load, or `undefined` when an adapter can open it. Each
 * adapter opens only `http` and `https` addresses.
 */
export function refusalOf(url: string): FailReason | undefined {
  return isWebUrl(url) ? undefined : "not-web";
}

/** A function that gets each event of a surface. */
export type SurfaceListener = (event: SurfaceEvent) => void;

/**
 * A surface shows sites in slots. The interface lays out the slots, and gives the box of each slot to `place`. Thus
 * each adapter follows one layout: the layout of the interface.
 */
export interface Surface {
  /** The name of the adapter, for example `electron-view` or `iframe`. */
  readonly kind: string;
  /** This method starts a load of the address in the slot, and gives the number of the load. */
  show(slot: SlotId, url: string): LoadId;
  /** This method puts the slot in a box of the window, in CSS pixels. `undefined` hides the slot and keeps its page. */
  place(slot: SlotId, box: Rect | undefined): void;
  /** This method removes the page of the slot. */
  clear(slot: SlotId): void;
  /** This method adds a listener, and gives the function that removes it. */
  subscribe(listener: SurfaceListener): () => void;
  /** This method removes each slot and each listener. The surface does nothing after it. */
  dispose(): void;
}

/** The status of a slot, as the interface shows it. */
export type SlotStatus =
  | { readonly state: "empty"; readonly load: LoadId }
  | { readonly state: "loading"; readonly load: LoadId; readonly url: string }
  | { readonly state: "shown"; readonly load: LoadId; readonly url: string; readonly title?: string }
  | { readonly state: "failed"; readonly load: LoadId; readonly url: string; readonly reason: FailReason; readonly detail?: string };

/** The status of a slot before its first load. */
export const EMPTY: SlotStatus = { state: "empty", load: 0 };

/**
 * This function gives the status of a slot after an event. An event of an earlier load gives the same status. A load
 * that ended (`shown` or `failed`) changes only by a new load, a `navigated` event or `cleared`. One exception: a
 * `shown` event replaces the failure `timeout` of its load.
 */
export function nextStatus(status: SlotStatus, event: SurfaceEvent): SlotStatus {
  if (event.load < status.load) return status;
  switch (event.type) {
    case "loading":
      return event.load > status.load || status.state === "empty" ? { state: "loading", load: event.load, url: event.url } : status;
    case "shown":
      // A slow site that comes after the time limit replaces the timeout: the page is there
      if (event.load > status.load || status.state === "loading" || (status.state === "failed" && status.reason === "timeout")) {
        return { state: "shown", load: event.load, url: event.url, ...(event.title === undefined ? {} : { title: event.title }) };
      }
      return status;
    case "failed":
      if (event.load > status.load || status.state === "loading") {
        return { state: "failed", load: event.load, url: event.url, reason: event.reason, ...(event.detail === undefined ? {} : { detail: event.detail }) };
      }
      return status;
    case "navigated":
      return status.state === "shown" ? { ...status, url: event.url } : status;
    case "cleared":
      return { state: "empty", load: event.load };
  }
}

/** The slots of a surface, and their status. */
export interface SlotTracker {
  /** This method gives the status of a slot. */
  status(slot: SlotId): SlotStatus;
  /** This method adds a listener of the changes of status, and gives the function that removes it. */
  subscribe(listener: (slot: SlotId, status: SlotStatus) => void): () => void;
  /** This method stops the tracker. */
  stop(): void;
}

/** This function follows the events of a surface, and keeps the status of each slot. */
export function trackSlots(surface: Surface): SlotTracker {
  const statuses = new Map<SlotId, SlotStatus>();
  const listeners = new Set<(slot: SlotId, status: SlotStatus) => void>();
  const stop = surface.subscribe((event) => {
    const before = statuses.get(event.slot) ?? EMPTY;
    const after = nextStatus(before, event);
    if (after === before) return;
    statuses.set(event.slot, after);
    for (const listener of listeners) listener(event.slot, after);
  });
  return {
    status: (slot) => statuses.get(slot) ?? EMPTY,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    stop: () => {
      stop();
      listeners.clear();
    },
  };
}

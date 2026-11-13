/**
 * The contract of a surface: a thing that shows a site in a slot of the window. Each adapter (an Electron view, a
 * still picture, later an `iframe`) obeys this contract, so the interface of the app does not know which adapter it uses.
 *
 * An adapter with a view of its own puts the view on the box of the slot. An adapter with no view gives a still
 * picture in its `shown` event, and the page draws the picture in the slot.
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

/** The number of a tab in its slot. The tab 0 is the tab of the site of the load. Each new tab gets a new number. */
export type TabId = number;

/** A tab of a slot. */
export interface TabView {
  readonly id: TabId;
  /** The address of the page of the tab. */
  readonly url: string;
  readonly title?: string;
  /** The tab loads a page at this time. */
  readonly loading: boolean;
}

/**
 * The pages of a slot: its lock, its tabs and the history of the open tab. The adapter sends it in a `browse` event
 * after each change.
 */
export interface BrowseState {
  /**
   * The lock stops the site after its first load. Then the site cannot go to another page, and cannot open a tab or a
   * window. The actions of the person (`back`, `home`, `open` and the others) still work. Each load starts locked.
   */
  readonly locked: boolean;
  /** The tabs, in their order. The first tab is the tab of the site, and the slot always keeps it. */
  readonly tabs: readonly TabView[];
  /** The tab that the slot shows. */
  readonly active: TabId;
  /** The open tab has a page before its page in its history. */
  readonly back: boolean;
  /** The open tab has a page after its page in its history. */
  readonly forward: boolean;
  /**
   * The adapter knows the address of each page, and keeps the tabs and the history. An `iframe` of another origin does
   * not, so its slot has only the lock.
   */
  readonly pages: boolean;
}

/** A navigation or a window that the lock stopped. */
export interface Blocked {
  /** `page` is a navigation to another page. `window` is a new tab or a new window. */
  readonly kind: "page" | "window";
  /** The address that the site asked for, when the adapter knows it. */
  readonly url?: string;
}

/** An action of the person on the pages of a slot. An adapter that cannot do an action ignores it. */
export type SlotAction =
  | { readonly type: "lock"; readonly locked: boolean }
  | { readonly type: "back" }
  | { readonly type: "forward" }
  /** This action shows the tab of the site, at the address of the load. */
  | { readonly type: "home" }
  | { readonly type: "select"; readonly tab: TabId }
  /** This action closes a tab. The tab of the site stays. */
  | { readonly type: "close"; readonly tab: TabId }
  /** This action opens a web address in a new tab (`tab`), or in the open tab (`here`). */
  | { readonly type: "open"; readonly url: string; readonly where: "tab" | "here" };

/** An event of a slot. */
export type SurfaceEvent =
  | { readonly type: "loading"; readonly slot: SlotId; readonly load: LoadId; readonly url: string }
  | {
      readonly type: "shown";
      readonly slot: SlotId;
      readonly load: LoadId;
      readonly url: string;
      readonly title?: string;
      /** A still picture of the site, as a `data:` address of an image. Only an adapter with no view gives it. */
      readonly picture?: string;
    }
  | { readonly type: "failed"; readonly slot: SlotId; readonly load: LoadId; readonly url: string; readonly reason: FailReason; readonly detail?: string }
  /** The site went to another address in its slot, for example after a click. */
  | { readonly type: "navigated"; readonly slot: SlotId; readonly load: LoadId; readonly url: string }
  /** The lock, the tabs or the history of the slot changed. */
  | { readonly type: "browse"; readonly slot: SlotId; readonly load: LoadId; readonly browse: BrowseState }
  /** The lock stopped a navigation or a window of the site. */
  | { readonly type: "blocked"; readonly slot: SlotId; readonly load: LoadId; readonly blocked: Blocked }
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
  /** This method does an action of the person on the pages of the open load of the slot. */
  act(slot: SlotId, action: SlotAction): void;
  /** This method adds a listener, and gives the function that removes it. */
  subscribe(listener: SurfaceListener): () => void;
  /** This method removes each slot and each listener. The surface does nothing after it. */
  dispose(): void;
}

/** The pages of a slot that loads or shows a live site: the last `browse` state, and the last stop of the lock. */
export interface Pages {
  readonly browse?: BrowseState;
  /** The last navigation or window that the adapter stopped. An unlock removes it. */
  readonly blocked?: Blocked;
}

/** The status of a slot, as the interface shows it. */
export type SlotStatus =
  | { readonly state: "empty"; readonly load: LoadId }
  | ({ readonly state: "loading"; readonly load: LoadId; readonly url: string } & Pages)
  | ({ readonly state: "shown"; readonly load: LoadId; readonly url: string; readonly title?: string; readonly picture?: string } & Pages)
  | { readonly state: "failed"; readonly load: LoadId; readonly url: string; readonly reason: FailReason; readonly detail?: string };

/** The status of a slot before its first load. */
export const EMPTY: SlotStatus = { state: "empty", load: 0 };

/** This function gives the pages of a status of the load, or no pages. */
function pagesOf(status: SlotStatus, load: LoadId): Pages {
  if (status.load !== load || (status.state !== "loading" && status.state !== "shown")) return {};
  return { ...(status.browse === undefined ? {} : { browse: status.browse }), ...(status.blocked === undefined ? {} : { blocked: status.blocked }) };
}

/** This function tells if a status of the load shows a live site, so it can have pages. */
function live(status: SlotStatus, load: LoadId): status is Extract<SlotStatus, { state: "loading" | "shown" }> {
  return status.load === load && (status.state === "loading" || (status.state === "shown" && status.picture === undefined));
}

/**
 * This function gives the status of a slot after an event. An event of an earlier load gives the same status. A load
 * that ended (`shown` or `failed`) changes only by a new load, a `navigated`, `browse` or `blocked` event, or
 * `cleared`. One exception: a `shown` event replaces the failure `timeout` of its load.
 *
 * A slot that loads or shows a live site keeps its pages (`browse` and `blocked`). A still picture has no pages.
 */
export function nextStatus(status: SlotStatus, event: SurfaceEvent): SlotStatus {
  if (event.load < status.load) return status;
  switch (event.type) {
    case "loading":
      return event.load > status.load || status.state === "empty" ? { state: "loading", load: event.load, url: event.url } : status;
    case "shown":
      // A slow site that comes after the time limit replaces the timeout: the page is there
      if (event.load > status.load || status.state === "loading" || (status.state === "failed" && status.reason === "timeout")) {
        return {
          state: "shown",
          load: event.load,
          url: event.url,
          ...(event.title === undefined ? {} : { title: event.title }),
          ...(event.picture === undefined ? pagesOf(status, event.load) : { picture: event.picture }),
        };
      }
      return status;
    case "failed":
      if (event.load > status.load || status.state === "loading") {
        return { state: "failed", load: event.load, url: event.url, reason: event.reason, ...(event.detail === undefined ? {} : { detail: event.detail }) };
      }
      return status;
    case "navigated":
      return status.state === "shown" ? { ...status, url: event.url } : status;
    case "browse": {
      if (!live(status, event.load)) return status;
      // An unlock removes the notice of the lock. An unlocked slot keeps its notice of a stop at the limit of tabs
      const keeps = event.browse.locked || status.browse?.locked === false;
      const pages: Pages = { browse: event.browse, ...(keeps && status.blocked !== undefined ? { blocked: status.blocked } : {}) };
      if (status.state === "loading") return { state: "loading", load: status.load, url: status.url, ...pages };
      return { state: "shown", load: status.load, url: status.url, ...(status.title === undefined ? {} : { title: status.title }), ...pages };
    }
    case "blocked":
      return live(status, event.load) ? { ...status, blocked: event.blocked } : status;
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

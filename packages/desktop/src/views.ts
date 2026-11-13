/**
 * The views of the sites in the main process. Each slot of the page has tabs, and each tab is a `WebContentsView`. The
 * first tab shows the site of the load. The page lays out the slots, and sends the box of each slot. This module puts
 * the open tab of each slot on its box, and sends the events of each load and the pages of each slot.
 *
 * Each load starts locked. After the first load of a tab, a locked slot blocks each navigation of the site to another
 * page, and each new window. An unlocked slot lets the site navigate, and opens each new window of the site as a new
 * tab of the slot. The actions of the person (Back, Forward, Return to the site, tabs) work in the two states.
 */
import type { Rect } from "@mark1russell7/layout-contract";
import { type BrowseState, type LoadId, type SlotAction, type SlotHost, type SlotId, type SurfaceEvent, type TabId, refusalOf } from "@pairrank/surfaces";
import { type BaseWindow, type WebContents, WebContentsView } from "electron";
import { MAX_TABS, allowsSiteNavigation, failureOf, navigationOf, returnsKeys, siteViewPreferences, tabAfterClose, viewBounds } from "./index.ts";

/** The views of the sites of one window. */
export interface SiteViews extends SlotHost {
  /** This function removes each view, and closes its page. */
  dispose(): void;
}

/** A tab of a slot. */
interface Tab {
  readonly id: TabId;
  readonly view: WebContentsView;
  /** The tab ended its first load, so the lock holds for it. A load that the person starts makes it false again. */
  armed: boolean;
}

/** A slot: its tabs and its open load. */
interface Entry {
  /** The tabs, in their order. The first tab is the tab of the site, and it stays for each load. */
  readonly tabs: Tab[];
  active: TabId;
  /** The number of the next new tab. */
  next: TabId;
  locked: boolean;
  load: LoadId;
  /** The address of the open load, or `undefined` after a clear. */
  url: string | undefined;
  /** The open load sent `shown` or `failed`, so a later address change is a navigation. */
  ended: boolean;
  /** The last box of the slot, or `undefined` for a hidden slot. */
  box: Rect | undefined;
}

/**
 * This function makes the views of the sites of a window. `send` gives each event to the page. `focusPage` gives the
 * keys back to the page of the app. `zoom` gives the zoom factor of the page at the time of the call. The page sends each box again after a
 * change of the zoom, because the change resizes its window.
 */
export function siteViews(window: BaseWindow, send: (event: SurfaceEvent) => void, focusPage: () => void, zoom: () => number): SiteViews {
  const entries = new Map<SlotId, Entry>();
  const open = (entry: Entry): boolean => entry.url !== undefined;
  const activeOf = (entry: Entry): Tab => entry.tabs.find((tab) => tab.id === entry.active) ?? (entry.tabs[0] as Tab);

  /** This function gives the pages of a slot. */
  const browseOf = (entry: Entry): BrowseState => {
    const history = activeOf(entry).view.webContents.navigationHistory;
    // The tab of the site keeps the pages of the earlier site until the first load of the new site ends
    const fresh = entry.active === 0 && !entry.ended;
    return {
      locked: entry.locked,
      tabs: entry.tabs.map(({ id, view }) => {
        const contents = view.webContents;
        // The first tab keeps the address of an earlier load until the new load navigates
        const url = id === 0 && !entry.ended ? (entry.url ?? "") : contents.getURL();
        const title = contents.getTitle();
        return { id, url, ...(title === "" || title === url ? {} : { title }), loading: contents.isLoading() };
      }),
      active: entry.active,
      back: !fresh && history.canGoBack(),
      forward: !fresh && history.canGoForward(),
      pages: true,
    };
  };

  /** This function sends the pages of a slot after a change. */
  const changed = (slot: SlotId, entry: Entry): void => {
    if (open(entry)) send({ type: "browse", slot, load: entry.load, browse: browseOf(entry) });
  };

  /** This function puts the open tab of a slot on its box, and hides the other tabs. */
  const layout = (entry: Entry): void => {
    const box = entry.box;
    for (const tab of entry.tabs) {
      if (box === undefined || tab.id !== entry.active) {
        tab.view.setVisible(false);
        continue;
      }
      tab.view.setBounds(viewBounds(box, zoom()));
      tab.view.setVisible(true);
    }
  };

  /** This function removes a tab from the window, and closes its page. */
  const destroy = (tab: Tab): void => {
    if (!window.isDestroyed()) window.contentView.removeChildView(tab.view);
    if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close();
  };

  /** This function closes each tab of a slot except the tab of the site, and shows the tab of the site. */
  const closeOthers = (entry: Entry): void => {
    for (const tab of entry.tabs.splice(1)) destroy(tab);
    entry.active = 0;
    layout(entry);
  };

  /** This function starts a load that the person asked for. The tab is not armed until the load ends. */
  const navigate = (tab: Tab, url: string): void => {
    tab.armed = false;
    // A failure comes as did-fail-load, so the promise of loadURL changes nothing
    void tab.view.webContents.loadURL(url).catch(() => undefined);
  };

  /** This function opens an address in a new tab of a slot. A slot with `MAX_TABS` tabs blocks it. */
  const openTab = (slot: SlotId, entry: Entry, url: string, select: boolean): void => {
    if (entry.tabs.length >= MAX_TABS) {
      send({ type: "blocked", slot, load: entry.load, blocked: { kind: "window", url } });
      return;
    }
    const tab = makeTab(slot, entry, entry.next);
    entry.next += 1;
    entry.tabs.push(tab);
    if (select) entry.active = tab.id;
    layout(entry);
    navigate(tab, url);
    changed(slot, entry);
    // The page keeps the keys, so a key of the app does not go to the site
    focusPage();
  };

  /**
   * This function ends the first load of a slot. The history of the tab of the site starts again at the page of the site.
   * Thus Back does not go to the site of an earlier load.
   */
  const end = (contents: WebContents, entry: Entry): void => {
    entry.ended = true;
    contents.navigationHistory.clear();
  };

  /** This function makes a tab of a slot, with the rules of the lock. Only the tab of the site sends the events of the load. */
  const makeTab = (slot: SlotId, entry: Entry, id: TabId): Tab => {
    const view = new WebContentsView({ webPreferences: siteViewPreferences() });
    view.setVisible(false);
    const tab: Tab = { id, view, armed: false };
    const contents = view.webContents;
    const first = id === 0;
    /** This function tells if an event of the tab is for the open load. */
    const current = (): boolean => open(entry) && entry.tabs.includes(tab);

    contents.setWindowOpenHandler(({ url, disposition }) => {
      if (!current() || !allowsSiteNavigation(url)) return { action: "deny" };
      if (entry.locked) send({ type: "blocked", slot, load: entry.load, blocked: { kind: "window", url } });
      else openTab(slot, entry, url, disposition !== "background-tab");
      // The slot opens the window as a tab, so Electron opens no window
      return { action: "deny" };
    });
    contents.on("will-navigate", (event, url) => {
      const decision = navigationOf(url, entry.locked, tab.armed);
      if (decision === "allow") return;
      event.preventDefault();
      if (decision === "block" && current()) send({ type: "blocked", slot, load: entry.load, blocked: { kind: "page", url } });
    });
    contents.on("did-finish-load", () => {
      tab.armed = true;
      if (first && open(entry) && !entry.ended) {
        end(contents, entry);
        send({ type: "shown", slot, load: entry.load, url: contents.getURL(), title: contents.getTitle() });
      }
      if (current()) changed(slot, entry);
    });
    contents.on("did-fail-load", (_event, code, text, url, mainFrame) => {
      const reason = failureOf(code);
      if (!mainFrame || reason === undefined) return;
      tab.armed = true;
      if (first && open(entry) && !entry.ended) {
        end(contents, entry);
        send({ type: "failed", slot, load: entry.load, url, reason, detail: `${text} (${code})` });
      }
      if (current()) changed(slot, entry);
    });
    contents.on("did-navigate", (_event, url) => {
      if (first && open(entry) && entry.ended) send({ type: "navigated", slot, load: entry.load, url });
      if (current()) changed(slot, entry);
    });
    contents.on("did-navigate-in-page", (_event, url, mainFrame) => {
      if (!mainFrame) return;
      if (first && open(entry) && entry.ended) send({ type: "navigated", slot, load: entry.load, url });
      if (current()) changed(slot, entry);
    });
    contents.on("page-title-updated", () => {
      if (current()) changed(slot, entry);
    });
    const update = (): void => {
      if (current()) changed(slot, entry);
    };
    contents.on("did-start-loading", update);
    contents.on("did-stop-loading", update);
    contents.on("render-process-gone", (_event, details) => {
      if (!open(entry)) return;
      if (first) {
        entry.ended = true;
        send({ type: "failed", slot, load: entry.load, url: entry.url ?? "", reason: "crashed", detail: details.reason });
      } else if (current()) {
        changed(slot, entry);
      }
    });
    contents.on("before-input-event", (event, input) => {
      if (!returnsKeys(input)) return;
      event.preventDefault();
      focusPage();
    });

    window.contentView.addChildView(view);
    return tab;
  };

  const entryOf = (slot: SlotId): Entry => {
    const found = entries.get(slot);
    if (found !== undefined) return found;
    const entry: Entry = { tabs: [], active: 0, next: 1, locked: true, load: 0, url: undefined, ended: false, box: undefined };
    entry.tabs.push(makeTab(slot, entry, 0));
    entries.set(slot, entry);
    return entry;
  };

  /** This function does an action of the person on the pages of a slot. */
  const act = (slot: SlotId, entry: Entry, action: SlotAction): void => {
    const tab = activeOf(entry);
    const history = tab.view.webContents.navigationHistory;
    switch (action.type) {
      case "lock":
        entry.locked = action.locked;
        changed(slot, entry);
        return;
      case "back":
        if (history.canGoBack()) history.goBack();
        return;
      case "forward":
        if (history.canGoForward()) history.goForward();
        return;
      case "home": {
        entry.active = 0;
        layout(entry);
        navigate(entry.tabs[0] as Tab, entry.url ?? "about:blank");
        changed(slot, entry);
        return;
      }
      case "select":
        if (!entry.tabs.some((each) => each.id === action.tab)) return;
        entry.active = action.tab;
        layout(entry);
        changed(slot, entry);
        return;
      case "close": {
        const closed = entry.tabs.find((each) => each.id === action.tab);
        if (closed === undefined || closed.id === 0) return;
        entry.active = tabAfterClose(
          entry.tabs.map((each) => each.id),
          entry.active,
          closed.id,
        );
        entry.tabs.splice(entry.tabs.indexOf(closed), 1);
        destroy(closed);
        layout(entry);
        changed(slot, entry);
        return;
      }
      case "open":
        if (!allowsSiteNavigation(action.url)) return;
        if (action.where === "tab") openTab(slot, entry, action.url, true);
        else navigate(tab, action.url);
        return;
    }
  };

  return {
    show(slot, url, load) {
      const reason = refusalOf(url);
      if (reason !== undefined) {
        send({ type: "failed", slot, load, url, reason });
        return;
      }
      const entry = entryOf(slot);
      closeOthers(entry);
      Object.assign(entry, { load, url, ended: false, locked: true });
      send({ type: "loading", slot, load, url });
      changed(slot, entry);
      navigate(entry.tabs[0] as Tab, url);
      // The page keeps the keys, so a key of the app does not go to the site
      focusPage();
    },
    place(slot, box: Rect | undefined) {
      const entry = entries.get(slot) ?? (box === undefined ? undefined : entryOf(slot));
      if (entry === undefined) return;
      entry.box = box === undefined || box.w <= 0 || box.h <= 0 ? undefined : box;
      layout(entry);
    },
    clear(slot, load) {
      const entry = entries.get(slot);
      if (entry !== undefined) {
        closeOthers(entry);
        entry.url = undefined;
        (entry.tabs[0] as Tab).view.setVisible(false);
        navigate(entry.tabs[0] as Tab, "about:blank");
      }
      send({ type: "cleared", slot, load });
    },
    act(slot, load, action) {
      const entry = entries.get(slot);
      if (entry === undefined || !open(entry) || entry.load !== load) return;
      act(slot, entry, action);
    },
    dispose() {
      for (const entry of entries.values()) for (const tab of entry.tabs) destroy(tab);
      entries.clear();
    },
  };
}

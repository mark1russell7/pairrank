/**
 * The views of the sites in the main process: one `WebContentsView` for each slot of the page. The page lays out the
 * slots, and sends the box of each slot. This module puts each view on its box, and sends the events of each load.
 */
import type { Rect } from "@mark1russell7/layout-contract";
import { type LoadId, type SlotHost, type SlotId, type SurfaceEvent, refusalOf } from "@pairrank/surfaces";
import { type BaseWindow, WebContentsView } from "electron";
import { allowsSiteNavigation, boundsOf, failureOf, returnsKeys, siteViewPreferences } from "./index.ts";

/** The views of the sites of one window. */
export interface SiteViews extends SlotHost {
  /** This function removes each view, and closes its page. */
  dispose(): void;
}

interface Entry {
  readonly view: WebContentsView;
  load: LoadId;
  /** The address of the open load, or `undefined` after a clear. */
  url: string | undefined;
  /** The open load sent `shown` or `failed`, so a later address change is a navigation. */
  ended: boolean;
}

/**
 * This function makes the views of the sites of a window. `send` gives each event to the page. `focusPage` gives the
 * keys back to the page of the app.
 */
export function siteViews(window: BaseWindow, send: (event: SurfaceEvent) => void, focusPage: () => void): SiteViews {
  const entries = new Map<SlotId, Entry>();

  const entryOf = (slot: SlotId): Entry => {
    const found = entries.get(slot);
    if (found !== undefined) return found;
    const view = new WebContentsView({ webPreferences: siteViewPreferences() });
    view.setVisible(false);
    const entry: Entry = { view, load: 0, url: undefined, ended: false };
    const contents = view.webContents;
    const open = (): boolean => entry.url !== undefined;

    contents.setWindowOpenHandler(({ url }) => {
      // A link to a new window opens in the same view, so the site stays in its slot
      if (allowsSiteNavigation(url)) void contents.loadURL(url).catch(() => undefined);
      return { action: "deny" };
    });
    contents.on("will-navigate", (event, url) => {
      if (!allowsSiteNavigation(url)) event.preventDefault();
    });
    contents.on("did-finish-load", () => {
      if (!open() || entry.ended) return;
      entry.ended = true;
      send({ type: "shown", slot, load: entry.load, url: contents.getURL(), title: contents.getTitle() });
    });
    contents.on("did-fail-load", (_event, code, text, url, mainFrame) => {
      const reason = failureOf(code);
      if (!mainFrame || reason === undefined || !open() || entry.ended) return;
      entry.ended = true;
      send({ type: "failed", slot, load: entry.load, url, reason, detail: `${text} (${code})` });
    });
    contents.on("did-navigate", (_event, url) => {
      if (open() && entry.ended) send({ type: "navigated", slot, load: entry.load, url });
    });
    contents.on("did-navigate-in-page", (_event, url, mainFrame) => {
      if (mainFrame && open() && entry.ended) send({ type: "navigated", slot, load: entry.load, url });
    });
    contents.on("render-process-gone", (_event, details) => {
      if (!open()) return;
      entry.ended = true;
      send({ type: "failed", slot, load: entry.load, url: entry.url ?? "", reason: "crashed", detail: details.reason });
    });
    contents.on("before-input-event", (event, input) => {
      if (!returnsKeys(input)) return;
      event.preventDefault();
      focusPage();
    });

    window.contentView.addChildView(view);
    entries.set(slot, entry);
    return entry;
  };

  return {
    show(slot, url, load) {
      const reason = refusalOf(url);
      if (reason !== undefined) {
        send({ type: "failed", slot, load, url, reason });
        return;
      }
      const entry = entryOf(slot);
      Object.assign(entry, { load, url, ended: false });
      send({ type: "loading", slot, load, url });
      // A failure comes as did-fail-load, so the promise of loadURL changes nothing
      void entry.view.webContents.loadURL(url).catch(() => undefined);
      // The page keeps the keys, so a key of the app does not go to the site
      focusPage();
    },
    place(slot, box: Rect | undefined) {
      const entry = entries.get(slot) ?? (box === undefined ? undefined : entryOf(slot));
      if (entry === undefined) return;
      if (box === undefined || box.w <= 0 || box.h <= 0) {
        entry.view.setVisible(false);
        return;
      }
      entry.view.setBounds(boundsOf(box));
      entry.view.setVisible(true);
    },
    clear(slot, load) {
      const entry = entries.get(slot);
      if (entry !== undefined) {
        entry.url = undefined;
        entry.view.setVisible(false);
        void entry.view.webContents.loadURL("about:blank").catch(() => undefined);
      }
      send({ type: "cleared", slot, load });
    },
    dispose() {
      for (const { view } of entries.values()) {
        if (!window.isDestroyed()) window.contentView.removeChildView(view);
        if (!view.webContents.isDestroyed()) view.webContents.close();
      }
      entries.clear();
    },
  };
}

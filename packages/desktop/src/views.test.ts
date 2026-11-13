import { EventEmitter } from "node:events";
import type { Rect } from "@mark1russell7/layout-contract";
import { SETTLE_MS, type SurfaceEvent } from "@pairrank/surfaces";
import type { BaseWindow } from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_TABS, viewBounds } from "./index.ts";
import { siteViews } from "./views.ts";

/** A fake of the `webContents` of a view: the methods and the events that the views read. */
class FakeContents extends EventEmitter {
  url = "";
  title = "";
  loading = false;
  destroyed = false;
  waiting = false;
  /** Each address that a load started, in order. */
  readonly loads: string[] = [];
  readonly history = { back: false, forward: false, wentBack: 0, wentForward: 0, cleared: 0 };
  openHandler: ((details: { url: string; disposition: string }) => { action: string }) | undefined;
  readonly navigationHistory = {
    canGoBack: (): boolean => this.history.back,
    canGoForward: (): boolean => this.history.forward,
    goBack: (): void => void (this.history.wentBack += 1),
    goForward: (): void => void (this.history.wentForward += 1),
    clear: (): void => void (this.history.cleared += 1),
  };
  loadURL(url: string): Promise<void> {
    this.loads.push(url);
    this.loading = true;
    // A failed load comes as did-fail-load, so the views ignore the promise
    return Promise.reject(new Error("The fake does not load pages."));
  }
  getURL(): string {
    return this.url;
  }
  getTitle(): string {
    return this.title;
  }
  isLoading(): boolean {
    return this.loading;
  }
  isDestroyed(): boolean {
    return this.destroyed;
  }
  isWaitingForResponse(): boolean {
    return this.waiting;
  }
  close(): void {
    this.destroyed = true;
  }
  setWindowOpenHandler(handler: (details: { url: string; disposition: string }) => { action: string }): void {
    this.openHandler = handler;
  }
  /** This method ends a load of the main frame at an address. */
  finish(url: string, title = ""): void {
    Object.assign(this, { url, title, loading: false });
    this.emit("did-finish-load");
  }
  /** This method sends `will-navigate`, and tells if a listener stopped it. */
  navigate(url: string): boolean {
    let prevented = false;
    this.emit("will-navigate", { preventDefault: () => (prevented = true) }, url);
    return prevented;
  }
}

/** A fake of a `WebContentsView`. */
class FakeView {
  readonly webContents = new FakeContents();
  visible = true;
  bounds: unknown = undefined;
  constructor() {
    views.push(this);
  }
  setVisible(visible: boolean): void {
    this.visible = visible;
  }
  setBounds(bounds: unknown): void {
    this.bounds = bounds;
  }
}

const { views } = vi.hoisted(() => ({ views: [] as FakeView[] }));
// The factory starts before the classes of this file exist, so it reads FakeView only when the views make a view
vi.mock("electron", () => ({
  WebContentsView: class {
    constructor() {
      return new FakeView();
    }
  },
}));

const SITE = "https://a.example/";
const BOX: Rect = { x: 10.4, y: 20, w: 300.6, h: 200 };

/** This function makes the views of a fake window, and records each event. */
function setup() {
  const events: SurfaceEvent[] = [];
  const children = new Set<FakeView>();
  const window = {
    destroyed: false,
    isDestroyed: () => window.destroyed,
    contentView: { addChildView: (view: FakeView) => children.add(view), removeChildView: (view: FakeView) => children.delete(view) },
  };
  const focus = vi.fn();
  const host = siteViews(window as unknown as BaseWindow, (event) => events.push(event), focus, () => 1.25);
  /** This function gives the events of a type, and removes each event from the record. */
  const take = <T extends SurfaceEvent["type"]>(type: T): Extract<SurfaceEvent, { type: T }>[] => {
    const found = events.filter((event) => event.type === type) as Extract<SurfaceEvent, { type: T }>[];
    events.length = 0;
    return found;
  };
  const lastBrowse = () => take("browse").at(-1)?.browse;
  return { host, events, children, window, focus, take, lastBrowse };
}

/** This function gives the fake contents of the view with an index, in the order of their creation. */
const contents = (index: number): FakeContents => {
  const view = views[index];
  if (view === undefined) throw new Error(`no view ${index}`);
  return view.webContents;
};

beforeEach(() => {
  views.length = 0;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("siteViews: a load", () => {
  it("refuses an address that is not a web address, and makes no view", () => {
    const { host, events } = setup();
    host.show("a", "file:///C:/secret.txt", 1);
    expect(events).toEqual([{ type: "failed", slot: "a", load: 1, url: "file:///C:/secret.txt", reason: "not-web" }]);
    expect(views).toHaveLength(0);
  });

  it("starts a load locked, sends loading and the pages of the slot, and keeps the keys on the page", () => {
    const { host, events, children, focus } = setup();
    host.show("a", SITE, 1);
    expect(events[0]).toEqual({ type: "loading", slot: "a", load: 1, url: SITE });
    expect(events[1]).toEqual({
      type: "browse",
      slot: "a",
      load: 1,
      browse: { locked: true, tabs: [{ id: 0, url: SITE, loading: false }], active: 0, back: false, forward: false, pages: true },
    });
    expect(contents(0).loads).toEqual([SITE]);
    expect(children.size).toBe(1);
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it("sends shown at the first end of the load only, and starts the history at the last page", () => {
    const { host, take } = setup();
    host.show("a", SITE, 1);
    const tab = contents(0);
    tab.waiting = true;
    tab.finish("https://a.example/old");
    expect(take("shown")).toEqual([]);

    tab.waiting = false;
    tab.finish("https://a.example/home", "Home");
    expect(tab.history.cleared).toBe(1);
    tab.emit("did-finish-load");
    expect(take("shown")).toEqual([{ type: "shown", slot: "a", load: 1, url: "https://a.example/home", title: "Home" }]);
  });

  it("sends failed for a failed load of the main frame, and ignores a frame and an aborted load", () => {
    const { host, take, events } = setup();
    host.show("a", SITE, 1);
    take("loading");
    const tab = contents(0);
    tab.emit("did-fail-load", {}, -3, "ERR_ABORTED", SITE, true);
    tab.emit("did-fail-load", {}, -102, "ERR_CONNECTION_REFUSED", SITE, false);
    expect(events).toEqual([]);
    tab.emit("did-fail-load", {}, -102, "ERR_CONNECTION_REFUSED", SITE, true);
    expect(take("failed")).toEqual([{ type: "failed", slot: "a", load: 1, url: SITE, reason: "refused", detail: "ERR_CONNECTION_REFUSED (-102)" }]);
    tab.emit("did-fail-load", {}, -102, "ERR_CONNECTION_REFUSED", SITE, true);
    expect(take("failed")).toEqual([]);
  });

  it("sends navigated only after the end of the load, and only for the main frame", () => {
    const { host, take } = setup();
    host.show("a", SITE, 1);
    const tab = contents(0);
    tab.emit("did-navigate", {}, "https://a.example/redirect");
    expect(take("navigated")).toEqual([]);
    tab.finish("https://a.example/redirect");
    tab.emit("did-navigate", {}, "https://a.example/next");
    tab.emit("did-navigate-in-page", {}, "https://a.example/next#frame", false);
    tab.emit("did-navigate-in-page", {}, "https://a.example/next#part", true);
    expect(take("navigated").map((event) => event.url)).toEqual(["https://a.example/next", "https://a.example/next#part"]);
  });

  it("sends failed with crashed when the page of the site ends", () => {
    const { host, take } = setup();
    host.show("a", SITE, 1);
    contents(0).emit("render-process-gone", {}, { reason: "oom" });
    expect(take("failed")).toEqual([{ type: "failed", slot: "a", load: 1, url: SITE, reason: "crashed", detail: "oom" }]);
  });

  it("gives a title that differs from the address, and the history after the first load", () => {
    const { host, take, lastBrowse } = setup();
    host.show("a", SITE, 1);
    const tab = contents(0);
    tab.history.back = true;
    tab.history.forward = true;
    tab.finish(SITE, SITE);
    expect(lastBrowse()?.tabs).toEqual([{ id: 0, url: SITE, loading: false }]);
    // The history stays closed until the tab is armed
    tab.finish(SITE, "A site");
    expect(lastBrowse()).toMatchObject({ tabs: [{ id: 0, url: SITE, title: "A site" }], back: false, forward: false });
    tab.emit("input-event", {}, { type: "mouseDown" });
    expect(lastBrowse()).toMatchObject({ back: true, forward: true });
    tab.emit("page-title-updated");
    expect(take("browse")).toHaveLength(1);
  });
});

describe("siteViews: the lock", () => {
  it("lets the redirects of the first load go, and blocks a navigation after a press", () => {
    const { host, take } = setup();
    host.show("a", SITE, 1);
    const tab = contents(0);
    expect(tab.navigate("https://a.example/redirect")).toBe(false);
    tab.emit("input-event", {}, { type: "mouseMove" });
    expect(tab.navigate("https://a.example/redirect")).toBe(false);
    take("blocked");

    tab.emit("input-event", {}, { type: "mouseDown" });
    expect(tab.navigate("https://b.example/")).toBe(true);
    expect(take("blocked")).toEqual([{ type: "blocked", slot: "a", load: 1, blocked: { kind: "page", url: "https://b.example/" } }]);
  });

  it("refuses a navigation to an address that is not a web address, with no event", () => {
    const { host, take } = setup();
    host.show("a", SITE, 1);
    expect(contents(0).navigate("file:///C:/secret.txt")).toBe(true);
    expect(take("blocked")).toEqual([]);
  });

  it("arms the tab after SETTLE_MS of quiet, but not while it loads", () => {
    const { host } = setup();
    host.show("a", SITE, 1);
    const tab = contents(0);
    tab.loading = false;
    tab.emit("did-stop-loading");
    vi.advanceTimersByTime(SETTLE_MS - 1);
    expect(tab.navigate("https://b.example/")).toBe(false);
    // A new stop starts the time again
    tab.emit("did-stop-loading");
    vi.advanceTimersByTime(SETTLE_MS - 1);
    expect(tab.navigate("https://b.example/")).toBe(false);
    tab.loading = true;
    vi.advanceTimersByTime(1);
    expect(tab.navigate("https://b.example/")).toBe(false);

    tab.loading = false;
    tab.emit("did-stop-loading");
    vi.advanceTimersByTime(SETTLE_MS);
    expect(tab.navigate("https://b.example/")).toBe(true);
    // An armed tab starts no new time
    tab.emit("did-stop-loading");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("lets an unlocked slot navigate, and opens a new window of the site as a tab", () => {
    const { host, take, lastBrowse, focus } = setup();
    host.show("a", SITE, 1);
    host.act("a", 1, { type: "lock", locked: false });
    expect(lastBrowse()?.locked).toBe(false);
    const tab = contents(0);
    tab.emit("input-event", {}, { type: "keyDown" });
    expect(tab.navigate("https://b.example/")).toBe(false);

    focus.mockClear();
    expect(tab.openHandler?.({ url: "https://b.example/", disposition: "foreground-tab" })).toEqual({ action: "deny" });
    expect(contents(1).loads).toEqual(["https://b.example/"]);
    expect(lastBrowse()).toMatchObject({ active: 1, tabs: [{ id: 0 }, { id: 1, url: "" }] });
    expect(focus).toHaveBeenCalledTimes(1);

    tab.openHandler?.({ url: "https://c.example/", disposition: "background-tab" });
    expect(lastBrowse()).toMatchObject({ active: 1, tabs: [{ id: 0 }, { id: 1 }, { id: 2 }] });
    // A new tab is not the tab of the site, so its end sends no shown
    contents(2).finish("https://c.example/", "C");
    expect(take("shown")).toEqual([]);
  });

  it("blocks a window after MAX_TABS tabs", () => {
    const { host, take } = setup();
    host.show("a", SITE, 1);
    host.act("a", 1, { type: "lock", locked: false });
    for (let index = 1; index < MAX_TABS; index += 1) contents(0).openHandler?.({ url: `https://t${index}.example/`, disposition: "foreground-tab" });
    expect(views).toHaveLength(MAX_TABS);
    take("blocked");
    contents(0).openHandler?.({ url: "https://more.example/", disposition: "foreground-tab" });
    expect(views).toHaveLength(MAX_TABS);
    expect(take("blocked")).toEqual([{ type: "blocked", slot: "a", load: 1, blocked: { kind: "window", url: "https://more.example/" } }]);
  });

  it("blocks each new window of a locked slot, and denies a window that is not a web address", () => {
    const { host, take } = setup();
    host.show("a", SITE, 1);
    const tab = contents(0);
    expect(tab.openHandler?.({ url: "https://b.example/", disposition: "new-window" })).toEqual({ action: "deny" });
    expect(take("blocked")).toEqual([{ type: "blocked", slot: "a", load: 1, blocked: { kind: "window", url: "https://b.example/" } }]);
    expect(tab.openHandler?.({ url: "javascript:alert(1)", disposition: "new-window" })).toEqual({ action: "deny" });
    expect(take("blocked")).toEqual([]);
    expect(views).toHaveLength(1);
  });
});

describe("siteViews: the actions of the person", () => {
  /** This function opens a slot with an unlocked site and a second tab. */
  const opened = () => {
    const context = setup();
    context.host.show("a", SITE, 1);
    context.host.act("a", 1, { type: "lock", locked: false });
    context.host.act("a", 1, { type: "open", url: "https://b.example/", where: "tab" });
    context.take("browse");
    return context;
  };

  it("goes back and forward only when the history has a page", () => {
    const { host } = opened();
    const tab = contents(1);
    host.act("a", 1, { type: "back" });
    host.act("a", 1, { type: "forward" });
    expect([tab.history.wentBack, tab.history.wentForward]).toEqual([0, 0]);
    tab.history.back = true;
    tab.history.forward = true;
    host.act("a", 1, { type: "back" });
    host.act("a", 1, { type: "forward" });
    expect([tab.history.wentBack, tab.history.wentForward]).toEqual([1, 1]);
  });

  it("returns to the site, selects and closes tabs, and keeps the tab of the site", () => {
    const { host, lastBrowse, children } = opened();
    host.act("a", 1, { type: "home" });
    expect(lastBrowse()?.active).toBe(0);
    expect(contents(0).loads).toEqual([SITE, SITE]);

    host.act("a", 1, { type: "select", tab: 7 });
    expect(lastBrowse()).toBeUndefined();
    host.act("a", 1, { type: "select", tab: 1 });
    expect(lastBrowse()?.active).toBe(1);

    host.act("a", 1, { type: "close", tab: 0 });
    host.act("a", 1, { type: "close", tab: 7 });
    expect(lastBrowse()).toBeUndefined();
    host.act("a", 1, { type: "close", tab: 1 });
    expect(lastBrowse()).toMatchObject({ active: 0, tabs: [{ id: 0 }] });
    expect(contents(1).destroyed).toBe(true);
    expect(children.size).toBe(1);
  });

  it("opens a web address here or in a tab, and ignores another address", () => {
    const { host } = opened();
    host.act("a", 1, { type: "open", url: "https://c.example/", where: "here" });
    expect(contents(1).loads).toEqual(["https://b.example/", "https://c.example/"]);
    host.act("a", 1, { type: "open", url: "file:///C:/secret.txt", where: "tab" });
    expect(views).toHaveLength(2);
  });

  it("ignores an action of an old load or of a slot with no load", () => {
    const { host, lastBrowse } = opened();
    host.act("a", 2, { type: "lock", locked: true });
    host.act("b", 1, { type: "lock", locked: true });
    expect(lastBrowse()).toBeUndefined();
  });

  it("gives the keys back to the page on Escape", () => {
    const { host, focus } = setup();
    host.show("a", SITE, 1);
    focus.mockClear();
    let prevented = 0;
    const event = { preventDefault: () => (prevented += 1) };
    contents(0).emit("before-input-event", event, { type: "keyDown", key: "a" });
    contents(0).emit("before-input-event", event, { type: "keyDown", key: "Escape" });
    expect([prevented, focus.mock.calls.length]).toEqual([1, 1]);
  });
});

describe("siteViews: boxes, clears and the end", () => {
  it("puts the open tab on the box of its slot, and hides the other tabs", () => {
    const { host } = setup();
    host.place("b", undefined);
    expect(views).toHaveLength(0);
    host.place("a", BOX);
    expect(views).toHaveLength(1);
    host.show("a", SITE, 1);
    host.act("a", 1, { type: "lock", locked: false });
    host.act("a", 1, { type: "open", url: "https://b.example/", where: "tab" });
    const [site, other] = views;
    expect([site?.visible, other?.visible]).toEqual([false, true]);
    expect(other?.bounds).toEqual(viewBounds(BOX, 1.25));
    host.place("a", { ...BOX, w: 0 });
    expect([site?.visible, other?.visible]).toEqual([false, false]);
    host.place("a", undefined);
    expect(other?.visible).toBe(false);
  });

  it("clears a slot: it closes the other tabs, and ignores the later events of the site", () => {
    const { host, take, events } = setup();
    host.clear("b", 3);
    expect(take("cleared")).toEqual([{ type: "cleared", slot: "b", load: 3 }]);

    host.show("a", SITE, 1);
    host.act("a", 1, { type: "lock", locked: false });
    host.act("a", 1, { type: "open", url: "https://b.example/", where: "tab" });
    take("browse");
    host.clear("a", 1);
    expect(take("cleared")).toEqual([{ type: "cleared", slot: "a", load: 1 }]);
    expect(contents(1).destroyed).toBe(true);
    expect(contents(0).loads.at(-1)).toBe("about:blank");
    expect(views[0]?.visible).toBe(false);

    const tab = contents(0);
    tab.finish("about:blank");
    tab.emit("did-navigate", {}, "about:blank");
    tab.emit("did-fail-load", {}, -102, "ERR_CONNECTION_REFUSED", SITE, true);
    tab.emit("render-process-gone", {}, { reason: "crashed" });
    tab.emit("input-event", {}, { type: "mouseDown" });
    expect(tab.openHandler?.({ url: "https://b.example/", disposition: "new-window" })).toEqual({ action: "deny" });
    expect(events).toEqual([]);
  });

  it("starts a new load in the same view, and the new load locks the slot again", () => {
    const { host, lastBrowse } = setup();
    host.show("a", SITE, 1);
    host.act("a", 1, { type: "lock", locked: false });
    host.show("a", "https://b.example/", 2);
    expect(views).toHaveLength(1);
    expect(lastBrowse()).toMatchObject({ locked: true, tabs: [{ id: 0, url: "https://b.example/" }] });
  });

  it("sends the pages of a tab that ends, and not a failure of the slot", () => {
    const { host, take } = setup();
    host.show("a", SITE, 1);
    host.act("a", 1, { type: "lock", locked: false });
    host.act("a", 1, { type: "open", url: "https://b.example/", where: "tab" });
    take("browse");
    contents(1).emit("render-process-gone", {}, { reason: "crashed" });
    expect(take("browse")).toHaveLength(1);
    expect(take("failed")).toEqual([]);
  });

  it("removes each view and closes its page, also after the window closed", () => {
    const { host, children } = setup();
    host.show("a", SITE, 1);
    host.show("b", "https://b.example/", 1);
    contents(1).destroyed = true;
    host.dispose();
    expect(children.size).toBe(0);
    expect(contents(0).destroyed).toBe(true);

    const second = setup();
    second.host.show("a", SITE, 1);
    second.window.destroyed = true;
    second.host.dispose();
    expect(second.children.size).toBe(1);
    expect(contents(2).destroyed).toBe(true);
  });
});

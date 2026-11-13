// @vitest-environment happy-dom
import { pairrankModule } from "@pairrank/host";
import { openStore } from "@pairrank/store";
import { type BrowseState, type SurfaceEvent, memorySurface, trackSlots } from "@pairrank/surfaces";
import { callerOf } from "@procedures/client";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type Call, apiOf } from "./api.ts";
import { type PageList, pageListOf } from "./page-list.ts";
import { NOTICE_MS, Slot, browseOf, noticeOf, shortUrl, tabName } from "./slot.tsx";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const site = "https://a.example/";
const other = "https://b.example/page";

/** The pages of a slot with the tabs of the addresses. The first tab shows. */
function pagesOf(urls: readonly string[], fields: Partial<BrowseState> = {}): BrowseState {
  return { locked: true, tabs: urls.map((url, id) => ({ id, url, loading: false })), active: 0, back: false, forward: false, pages: true, ...fields };
}

/** A slot of a memory surface with the site, and a function that sends the events of the site. */
function setup(pages?: PageList) {
  const memory = memorySurface();
  const tracker = trackSlots(memory.surface);
  render(<Slot surface={memory.surface} tracker={tracker} slot="main" url={site} pages={pages} />);
  const send = (event: SurfaceEvent): void => act(() => memory.emit(event));
  const browse = (state: BrowseState): void => send({ type: "browse", slot: "main", load: 1, browse: state });
  return { memory, send, browse };
}

/** A list of the sites in memory, with the addresses that it has. */
function listOf(has: readonly string[]): PageList & { added: { url: string; title: string | undefined }[] } {
  const added: { url: string; title: string | undefined }[] = [];
  return {
    added,
    has: async (url) => has.includes(url),
    add: async (url, title) => {
      added.push({ url, title });
      return "added";
    },
  };
}

describe("the helpers of the bar", () => {
  it("names a tab by its title, or by its short address", () => {
    expect(shortUrl("https://a.example/")).toBe("a.example");
    expect(shortUrl("http://a.example/b?c=1")).toBe("a.example/b?c=1");
    expect(tabName({ id: 0, url: site, title: " Alpha ", loading: false })).toBe("Alpha");
    expect(tabName({ id: 0, url: site, title: "  ", loading: false })).toBe("a.example");
    expect(tabName({ id: 0, url: "", loading: false })).toBe("New tab");
  });

  it("gives the pages only of a live site", () => {
    const browse = pagesOf([site]);
    expect(browseOf({ state: "loading", load: 1, url: site, browse })).toBe(browse);
    expect(browseOf({ state: "shown", load: 1, url: site, browse })).toBe(browse);
    expect(browseOf({ state: "shown", load: 1, url: site, picture: "data:image/png;base64,AA==", browse })).toBeUndefined();
    expect(browseOf({ state: "failed", load: 1, url: site, reason: "network" })).toBeUndefined();
  });

  it("offers an unlock for each stop of a locked slot, and the address when the adapter knows it", () => {
    const unlock = { type: "lock", locked: false } as const;
    expect(noticeOf({ kind: "window", url: other }, pagesOf([site])).action).toEqual({ label: "Unlock and open", actions: [unlock, { type: "open", url: other, where: "tab" }] });
    expect(noticeOf({ kind: "page", url: other }, pagesOf([site])).action).toEqual({ label: "Unlock and go", actions: [unlock, { type: "open", url: other, where: "here" }] });
    expect(noticeOf({ kind: "page" }, pagesOf([site], { pages: false }))).toEqual({ text: "The lock kept the site on its page", action: { label: "Unlock", actions: [unlock] } });
    expect(noticeOf({ kind: "window", url: other }, pagesOf([site], { pages: false })).action?.label).toBe("Unlock");
    expect(noticeOf({ kind: "window", url: other }, pagesOf([site], { locked: false })).action).toBeUndefined();
  });
});

describe("Slot and its bar", () => {
  it("shows no controls before the adapter sends the pages", () => {
    setup(listOf([]));
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.queryByRole("button", { name: "Return to the site" })).toBeNull();
  });

  it("changes the lock, and shows the state of the lock", () => {
    const { memory, browse } = setup();
    browse(pagesOf([site]));
    const lock = screen.getByRole("switch");
    expect(lock.getAttribute("aria-checked")).toBe("true");
    expect(lock.textContent).toBe("Locked");
    fireEvent.click(lock);
    browse(pagesOf([site], { locked: false }));
    expect(screen.getByRole("switch").textContent).toBe("Unlocked");
    fireEvent.click(screen.getByRole("button", { name: "Return to the site" }));
    expect(memory.actions.map((each) => each.action)).toEqual([{ type: "lock", locked: false }, { type: "home" }]);
  });

  it("goes back and forward only when the history has a page, and has no history for a frame", () => {
    const { memory, browse } = setup();
    browse(pagesOf([site], { back: true }));
    expect(screen.getByRole("button", { name: "Forward" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(memory.actions.at(-1)?.action).toEqual({ type: "back" });
    browse(pagesOf([site], { pages: false }));
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add this page" })).toBeNull();
  });

  it("shows the tabs, selects a tab, and closes each tab but the tab of the site", () => {
    const { memory, browse } = setup();
    browse(pagesOf([site]));
    expect(screen.queryByRole("group", { name: "Tabs" })).toBeNull();
    expect(screen.getByText("a.example")).toBeTruthy();
    browse({ ...pagesOf([site, other]), tabs: [{ id: 0, url: site, title: "Alpha", loading: false }, { id: 4, url: other, loading: true }], active: 4 });
    expect(screen.getByRole("button", { name: "b.example/page" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Alpha" }));
    fireEvent.click(screen.getByRole("button", { name: "Close the tab b.example/page" }));
    expect(screen.queryByRole("button", { name: "Close the tab Alpha" })).toBeNull();
    expect(memory.actions.map((each) => each.action)).toEqual([
      { type: "select", tab: 0 },
      { type: "close", tab: 4 },
    ]);
  });

  it("tells each stop of the lock, offers the unlock, and hides the notice after a time", () => {
    vi.useFakeTimers();
    const { memory, send, browse } = setup();
    browse(pagesOf([site]));
    send({ type: "blocked", slot: "main", load: 1, blocked: { kind: "window", url: other } });
    expect(screen.getByRole("status").textContent).toContain("The lock stopped a new window: b.example/page");
    fireEvent.click(screen.getByRole("button", { name: "Unlock and open" }));
    expect(memory.actions.map((each) => each.action)).toEqual([
      { type: "lock", locked: false },
      { type: "open", url: other, where: "tab" },
    ]);
    // A pointer on the notice keeps it
    fireEvent.pointerEnter(screen.getByRole("status"));
    act(() => vi.advanceTimersByTime(NOTICE_MS * 2));
    expect(screen.queryByRole("status")).not.toBeNull();
    fireEvent.pointerLeave(screen.getByRole("status"));
    act(() => vi.advanceTimersByTime(NOTICE_MS));
    expect(screen.queryByRole("status")).toBeNull();
    // A new stop shows again, and the close button hides it
    send({ type: "blocked", slot: "main", load: 1, blocked: { kind: "page", url: other } });
    fireEvent.click(screen.getByRole("button", { name: "Close the notice" }));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("adds the page of the open tab, with its title, and tells a page that the list has", async () => {
    const list = listOf([site]);
    const { browse } = setup(list);
    browse(pagesOf([site]));
    await waitFor(() => expect(screen.getByRole("button", { name: "In the list" }).hasAttribute("disabled")).toBe(true));
    browse({ ...pagesOf([site]), tabs: [{ id: 0, url: other, title: "B page", loading: false }] });
    const add = await screen.findByRole("button", { name: "Add this page" });
    fireEvent.click(add);
    await screen.findByRole("button", { name: "Added" });
    expect(list.added).toEqual([{ url: other, title: "B page" }]);
  });

  it("tells a failed addition, and does not add a page that is not a web page", async () => {
    const list: PageList = { has: async () => false, add: async () => Promise.reject(new Error("The store is closed.")) };
    const { browse } = setup(list);
    browse({ ...pagesOf([site]), tabs: [{ id: 0, url: "about:blank", loading: false }] });
    expect(screen.getByRole("button", { name: "Add this page" }).hasAttribute("disabled")).toBe(true);
    browse({ ...pagesOf([site]), tabs: [{ id: 0, url: other, loading: false }] });
    await waitFor(() => expect(screen.getByRole("button", { name: "Add this page" }).hasAttribute("disabled")).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Add this page" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Not added");
    expect(alert.getAttribute("title")).toBe("The store is closed.");
  });
});

describe("pageListOf", () => {
  it("compares the addresses by the key of the host, adds a page once, and reads the view again", async () => {
    const store = openStore(":memory:");
    let n = 0;
    const caller = callerOf(pairrankModule(store, { key: (address) => address.replace(/\/$/, ""), id: () => `id${++n}`, now: () => "2026-11-12T12:00:00Z" }));
    const call: Call = (path, input) => caller(path, input);
    const api = apiOf(call);
    await api.importList({ format: "pairrank.sites", version: 1, source: "test", sites: [{ url: site, title: "Alpha" }] });
    const changed = vi.fn(async () => undefined);
    const list = pageListOf(api, changed);
    expect(await list.has("https://a.example")).toBe(true);
    expect(await list.has(other)).toBe(false);
    expect(await list.add(other, "B page")).toBe("added");
    expect(await list.add(`${other}/`, "  ")).toBe("existing");
    expect(changed).toHaveBeenCalledTimes(2);
    const view = await api.view();
    expect(view.sites.map((each) => [each.url, each.title]).sort()).toEqual([
      [site, "Alpha"],
      [other, "B page"],
    ]);
    await expect(list.add("mailto:a@a.example")).rejects.toThrow();
  });
});

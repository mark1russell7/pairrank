// @vitest-environment happy-dom
import { pairrankModule } from "@pairrank/host";
import { openStore } from "@pairrank/store";
import { memorySurface } from "@pairrank/surfaces";
import { callerOf } from "@procedures/client";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { type Call, apiOf } from "./api.ts";
import { App } from "./app.tsx";
import { matches } from "./sites-screen.tsx";
import { nameOf } from "./look-screen.tsx";
import { FAILURE_TEXT, boxOf, showsView } from "./slot.tsx";

afterEach(cleanup);

/** The real procedures of the host, over a store in memory. */
function setup() {
  const store = openStore(":memory:");
  let n = 0;
  const module = pairrankModule(store, { key: (url) => url.replace(/\/$/, ""), id: () => `id${++n}`, now: () => "2026-11-08T12:00:00Z" });
  const caller = callerOf(module);
  const call: Call = (path, input) => caller(path, input);
  return { api: apiOf(call), memory: memorySurface() };
}

const list = {
  format: "pairrank.sites",
  version: 1,
  source: "test",
  sites: [
    { url: "https://a.example/", title: "Alpha", tags: ["News"] },
    { url: "https://b.example/", title: "Beta" },
    { url: "https://c.example/" },
  ],
};

const site = { id: "s", url: "https://x.example/path", title: undefined, source: undefined, added: "", dated: undefined, hidden: false, hiddenReason: undefined, tags: [] };

describe("the pure parts", () => {
  it("finds a site by each word of the search, in the title and the address", () => {
    expect(matches({ ...site, title: "Daily News" }, "news x.example")).toBe(true);
    expect(matches({ ...site, title: "Daily News" }, "news sport")).toBe(false);
    expect(matches(site, "  ")).toBe(true);
  });

  it("names a site by its title, or by its address with no scheme", () => {
    expect(nameOf(site)).toBe("x.example/path");
    expect(nameOf({ ...site, title: "  " })).toBe("x.example/path");
    expect(nameOf({ ...site, title: "X" })).toBe("X");
  });

  it("gives the box of an element, and shows the view only when there is a page", () => {
    expect(boxOf({ left: 8, top: 44, width: 1184, height: 700 })).toEqual({ x: 8, y: 44, w: 1184, h: 700 });
    expect(showsView({ state: "loading", load: 1, url: "https://a.example/" })).toBe(true);
    expect(showsView({ state: "failed", load: 1, url: "https://a.example/", reason: "refused" })).toBe(false);
    expect(showsView({ state: "empty", load: 0 })).toBe(false);
  });
});

describe("apiOf", () => {
  it("gives the procedures of the host, with the choice of a pair", async () => {
    const { api } = setup();
    expect(await api.pair({ kind: "overall" }, 1)).toBeNull();
    await api.importList(list);
    const view = await api.view();
    const pair = await api.pair({ kind: "overall" }, "seed", [[view.sites[0]!.id, view.sites[1]!.id]]);
    expect(view.sites.map((site) => site.id)).toContain(pair?.a);
    expect((await api.ladder({ kind: "overall" }, "elo")).model).toBe("elo");
    expect((await api.model({ kind: "overall" })).model).toBe("bradley-terry");
    await api.apply([{ type: "mode.saved", mode: "m", name: "Morning", pool: { kind: "all" }, asks: [{ kind: "overall" }] }]);
    expect((await api.pair("m", "seed"))?.asks).toEqual([{ kind: "overall" }]);
  });
});

describe("App", () => {
  it("tells what to do when there is no site", async () => {
    const { api, memory } = setup();
    render(<App api={api} surface={memory.surface} />);
    expect(await screen.findByRole("heading", { name: "No sites yet" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Look" }).hasAttribute("disabled")).toBe(true);
  });

  it("lists the sites, and finds one by a search", async () => {
    const { api, memory } = setup();
    await api.importList(list);
    render(<App api={api} surface={memory.surface} />);
    expect(await screen.findByText("3 sites, 1 tag")).toBeTruthy();
    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(screen.getByText("News")).toBeTruthy();
    fireEvent.change(screen.getByRole("searchbox", { name: "Find a site" }), { target: { value: "beta" } });
    expect(screen.queryByText("Alpha")).toBeNull();
    expect(screen.getByText("Beta")).toBeTruthy();
    fireEvent.change(screen.getByRole("searchbox", { name: "Find a site" }), { target: { value: "nothing" } });
    expect(screen.getByText("No site agrees with this search.")).toBeTruthy();
  });

  it("shows one site at a time in the slot, and goes to the next site with a key", async () => {
    const { api, memory } = setup();
    await api.importList(list);
    render(<App api={api} surface={memory.surface} />);
    fireEvent.click(await screen.findByText("Beta"));
    expect(memory.loads.get("main")?.url).toBe("https://b.example/");
    expect(screen.getByText("2 of 3")).toBeTruthy();
    expect(memory.boxes.get("main")).toBeDefined();

    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(memory.loads.get("main")?.url).toBe("https://c.example/");
    // A run ends after its last site
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByRole("heading", { name: "The end of the run" })).toBeTruthy();
    expect(memory.boxes.get("main")).toBeUndefined();
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(screen.getByText("3 of 3")).toBeTruthy();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByRole("searchbox", { name: "Find a site" })).toBeTruthy();
    expect(memory.boxes.get("main")).toBeUndefined();
  });

  it("hides the view of a failed site, and tells the reason", async () => {
    const { api, memory } = setup();
    await api.importList(list);
    render(<App api={api} surface={memory.surface} />);
    fireEvent.click(await screen.findByText("Alpha"));
    const load = memory.loads.get("main")?.load ?? 0;
    act(() => memory.emit({ type: "failed", slot: "main", load, url: "https://a.example/", reason: "refused" }));
    expect(screen.getByRole("alert").textContent).toContain(FAILURE_TEXT.refused);
    expect(memory.boxes.get("main")).toBeUndefined();
  });

  it("tells the error when the host fails", async () => {
    const { memory } = setup();
    const api = apiOf(() => Promise.reject(new Error("The store is closed.")));
    render(<App api={api} surface={memory.surface} />);
    expect((await screen.findByRole("alert")).textContent).toBe("The app could not read the data. The store is closed.");
  });
});

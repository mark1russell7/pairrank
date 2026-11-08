// @vitest-environment happy-dom
import { pairrankModule } from "@pairrank/host";
import { openStore } from "@pairrank/store";
import { memorySurface } from "@pairrank/surfaces";
import { callerOf } from "@procedures/client";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { type Call, apiOf } from "./api.ts";
import { App } from "./app.tsx";

afterEach(cleanup);

const list = {
  format: "pairrank.sites",
  version: 1,
  source: "test",
  sites: [
    { url: "https://a.example/", title: "Alpha", tags: ["News"] },
    { url: "https://b.example/", title: "Beta" },
    { url: "https://c.example/", title: "Gamma" },
  ],
};

async function open(sites = list.sites) {
  const store = openStore(":memory:");
  let n = 0;
  const module = pairrankModule(store, { key: (url) => url.replace(/\/$/, ""), id: () => `id${++n}`, now: () => "2026-11-08T12:00:00Z" });
  const caller = callerOf(module);
  const call: Call = (path, input) => caller(path, input);
  const api = apiOf(call);
  const memory = memorySurface();
  await api.importList({ ...list, sites });
  let d = 0;
  render(<App api={api} surface={memory.surface} newId={() => `duel${++d}`} />);
  const duel = await screen.findByRole("button", { name: "Duel" });
  const urls = new Map((await api.view()).sites.map((site) => [site.url, site.id]));
  /** This function gives the ids of the sites on the screen, when the next pair is ready. */
  const shown = async (): Promise<[string, string]> => {
    await waitFor(() => expect(screen.getByRole("button", { name: /Left is better/ }).hasAttribute("disabled")).toBe(false));
    return [urls.get(memory.loads.get("left")!.url)!, urls.get(memory.loads.get("right")!.url)!];
  };
  return { api, memory, duel, shown };
}

describe("the duel", () => {
  it("shows two sites, writes the pick of a side, and then shows the next pair", async () => {
    const { api, duel, shown } = await open();
    fireEvent.click(duel);
    const [left, right] = await shown();
    expect(left).not.toBe(right);

    fireEvent.keyDown(window, { key: "ArrowLeft" });
    await waitFor(() => expect(screen.getByText("Picks in this duel: 1")).toBeTruthy());
    const ladder = await api.ladder({ kind: "overall" }, "elo");
    expect(ladder.picks).toBe(1);
    expect(ladder.ratings[0]?.site).toBe(left);
    const next = await shown();
    // The pair of the last pick waits, so the next pair is a different pair
    expect([...next].sort()).not.toEqual([left, right].sort());
  });

  it("counts a tie and not a skip, and an undo removes the last pick and shows its pair again", async () => {
    const { api, duel, shown } = await open();
    fireEvent.click(duel);
    await shown();
    fireEvent.click(screen.getByRole("button", { name: /Tie/ }));
    await waitFor(() => expect(screen.getByText("Picks in this duel: 1")).toBeTruthy());
    const pair = await shown();
    fireEvent.keyDown(window, { key: "s" });
    await waitFor(async () => expect((await api.view()).picks["overall"]).toBe(1));
    await shown();
    expect(screen.getByText("Picks in this duel: 1")).toBeTruthy();

    fireEvent.keyDown(window, { key: "u" });
    await waitFor(async () => expect(await shown()).toEqual(pair));
    fireEvent.keyDown(window, { key: "u" });
    await waitFor(() => expect(screen.getByText("Picks in this duel: 0")).toBeTruthy());
    expect((await api.view()).picks["overall"]).toBeUndefined();
    expect(screen.getByRole("button", { name: /Undo/ }).hasAttribute("disabled")).toBe(true);
  });

  it("hides the site of a side after the key h, and an undo restores it", async () => {
    const { api, duel, shown } = await open();
    fireEvent.click(duel);
    const [, right] = await shown();
    fireEvent.keyDown(window, { key: "h" });
    expect(screen.getByRole("status").textContent).toContain("Which site do you hide?");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("status")).toBeNull();
    fireEvent.keyDown(window, { key: "h" });
    fireEvent.keyDown(window, { key: "ArrowRight" });
    await waitFor(async () => expect((await api.view()).sites.find((site) => site.id === right)?.hidden).toBe(true));
    expect(await shown()).not.toContain(right);

    fireEvent.click(screen.getByRole("button", { name: /Undo/ }));
    await waitFor(async () => expect((await api.view()).sites.find((site) => site.id === right)?.hidden).toBe(false));
  });

  it("tells when a scope has fewer than two sites, and needs two sites to start", async () => {
    const { duel } = await open();
    fireEvent.click(duel);
    const news = screen.getByRole<HTMLSelectElement>("combobox", { name: "Pick under" });
    const value = [...news.options].find((option) => option.text === "News")!.value;
    fireEvent.change(news, { target: { value } });
    expect(await screen.findByRole("heading", { name: "Not enough sites for a duel" })).toBeTruthy();
    cleanup();
    const one = await open(list.sites.slice(0, 1));
    expect(one.duel.hasAttribute("disabled")).toBe(true);
  });
});

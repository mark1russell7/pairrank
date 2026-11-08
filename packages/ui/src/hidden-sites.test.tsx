// @vitest-environment happy-dom
import { pairrankModule } from "@pairrank/host";
import { openStore } from "@pairrank/store";
import { memorySurface } from "@pairrank/surfaces";
import { callerOf } from "@procedures/client";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { type Call, type PairrankApi, apiOf } from "./api.ts";
import { App } from "./app.tsx";

afterEach(cleanup);

/** The host with three sites. The steps of `prepare` run before the app starts. */
async function setup(prepare?: (api: PairrankApi) => Promise<unknown>): Promise<PairrankApi> {
  const store = openStore(":memory:");
  let n = 0;
  const caller = callerOf(pairrankModule(store, { key: (address) => address.replace(/\/$/, ""), id: () => `id${++n}`, now: () => "2026-11-08T12:00:00Z" }));
  const call: Call = (path, input) => caller(path, input);
  const api = apiOf(call);
  const sites = [
    { url: "https://a.example/", title: "Alpha" },
    { url: "https://b.example/", title: "Beta" },
    { url: "https://c.example/", title: "Gamma" },
  ];
  await api.importList({ format: "pairrank.sites", version: 1, source: "test", sites });
  await prepare?.(api);
  render(<App api={api} surface={memorySurface().surface} />);
  await screen.findByRole("searchbox", { name: "Find a site" });
  return api;
}

const hide = (site: string, reason?: string) => async (api: PairrankApi) => api.apply([{ type: "site.hidden", site, reason }]);

describe("the hidden sites", () => {
  it("shows no choice of the hidden sites when no site is hidden", async () => {
    await setup();
    expect(screen.queryByRole("group", { name: "Which sites" })).toBeNull();
    expect(screen.getByText("3 sites, 0 tags")).toBeTruthy();
  });

  it("lists the hidden sites with their reasons, and restores a site", async () => {
    const api = await setup(async (each) => {
      await hide("id1", "Hidden in a duel.")(each);
      await hide("id3")(each);
    });
    expect(screen.getByText("1 site, 0 tags")).toBeTruthy();
    expect(screen.queryByText("Alpha")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Hidden/ }));
    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(screen.getByText("Hidden in a duel.")).toBeTruthy();
    expect(screen.getByText("No reason")).toBeTruthy();
    expect(screen.queryByText("Beta")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Restore Alpha" }));
    expect(await screen.findByText("Alpha is back in the sites.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Restore Alpha" })).toBeNull();
    expect(screen.getByText("2 sites, 0 tags")).toBeTruthy();
    expect((await api.view()).sites.find((site) => site.id === "id1")?.hidden).toBe(false);
  });

  it("finds a hidden site by the search, and keeps the choice after the last restore", async () => {
    await setup(async (each) => {
      await hide("id1")(each);
      await hide("id2")(each);
    });
    fireEvent.click(screen.getByRole("button", { name: /^Hidden/ }));
    fireEvent.change(screen.getByRole("searchbox", { name: "Find a site" }), { target: { value: "beta" } });
    expect(screen.queryByText("Alpha")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Restore Beta" }));
    await screen.findByText("Beta is back in the sites.");
    expect(screen.getByText("No hidden site agrees with this search.")).toBeTruthy();
    fireEvent.change(screen.getByRole("searchbox", { name: "Find a site" }), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Restore Alpha" }));
    await screen.findByText("Alpha is back in the sites.");
    expect(screen.getByText(/No sites are hidden/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Shown/ }));
    expect(screen.queryByRole("group", { name: "Which sites" })).toBeNull();
  });

  it("tells what to do when each site is hidden", async () => {
    await setup(async (each) => {
      for (const site of ["id1", "id2", "id3"]) await hide(site)(each);
    });
    expect(screen.queryByRole("heading", { name: "No sites yet" })).toBeNull();
    expect(screen.getByText("Each site is hidden. Choose Hidden to restore a site.")).toBeTruthy();
  });
});

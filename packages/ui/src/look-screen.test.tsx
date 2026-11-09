// @vitest-environment happy-dom
import { pairrankModule } from "@pairrank/host";
import { openStore } from "@pairrank/store";
import { memorySurface } from "@pairrank/surfaces";
import { callerOf } from "@procedures/client";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { type Call, type PairrankApi, apiOf } from "./api.ts";
import { App } from "./app.tsx";
import { createDraft } from "./tagging.ts";

afterEach(cleanup);

type Memory = ReturnType<typeof memorySurface>;

/** The host with three sites: Alpha has the tag News, and Beta and Gamma have no tags. The tag Fun has the key f. */
async function setup(prepare?: (api: PairrankApi) => Promise<unknown>): Promise<{ api: PairrankApi; memory: Memory }> {
  const store = openStore(":memory:");
  let n = 0;
  const caller = callerOf(pairrankModule(store, { key: (address) => address.replace(/\/$/, ""), id: () => `id${++n}`, now: () => "2026-11-08T12:00:00Z" }));
  const call: Call = (path, input) => caller(path, input);
  const api = apiOf(call);
  const sites = [
    { url: "https://a.example/", title: "Alpha", tags: ["News"] },
    { url: "https://b.example/", title: "Beta" },
    { url: "https://c.example/", title: "Gamma" },
  ];
  await api.importList({ format: "pairrank.sites", version: 1, source: "test", sites });
  await api.apply([createDraft("fun", { name: "Fun", key: "f", color: undefined })]);
  await prepare?.(api);
  const memory = memorySurface();
  render(<App api={api} surface={memory.surface} newId={() => `new${++n}`} />);
  // The button goes on when the app has its sites, and a click before that does nothing
  const look = await screen.findByRole("button", { name: "Look" });
  await waitFor(() => expect(look.hasAttribute("disabled")).toBe(false));
  fireEvent.click(look);
  return { api, memory };
}

const url = (memory: Memory) => memory.loads.get("main")?.url;
const key = (name: string) => fireEvent.keyDown(window, { key: name });
const siteOf = async (api: PairrankApi, address: string) => (await api.view()).sites.find((site) => site.url === address);

describe("the tag run", () => {
  it("starts with the sites with no tags, and keeps a site in the run after a tag", async () => {
    const { api, memory } = await setup();
    expect(screen.getByRole("combobox", { name: "Sites of the run" })).toHaveProperty("value", "untagged");
    expect(url(memory)).toBe("https://b.example/");
    expect(screen.getByText("1 of 2")).toBeTruthy();

    key("f");
    await waitFor(() => expect(screen.getByText(/1 of 2 sites done/)).toBeTruthy());
    expect((await siteOf(api, "https://b.example/"))?.tags).toEqual(["fun"]);
    expect(url(memory)).toBe("https://b.example/");

    key("Enter");
    expect(url(memory)).toBe("https://c.example/");
    expect(screen.getByText("2 of 2")).toBeTruthy();
  });

  it("hides a site and goes on, and an undo restores the site and then removes the tag", async () => {
    const { api, memory } = await setup();
    key("f");
    await waitFor(() => expect(screen.getByText(/1 of 2 sites done/)).toBeTruthy());
    key("j");
    key("h");
    await screen.findByRole("heading", { name: "The end of the run" });
    expect(screen.getByText("Done: 1 of 1 site.")).toBeTruthy();
    expect((await siteOf(api, "https://c.example/"))?.hiddenReason).toBe("Hidden in a tag run.");

    key("u");
    await waitFor(() => expect(url(memory)).toBe("https://c.example/"));
    expect((await api.view()).sites.every((site) => !site.hidden)).toBe(true);
    key("u");
    await waitFor(() => expect(url(memory)).toBe("https://b.example/"));
    expect((await siteOf(api, "https://b.example/"))?.tags).toEqual([]);
    expect(screen.getByRole("button", { name: /Undo/ })).toHaveProperty("disabled", true);
  });

  it("goes to the next site after a tag when the user asks it", async () => {
    const { memory } = await setup();
    fireEvent.click(screen.getByRole("checkbox", { name: "Next site after a tag" }));
    key("f");
    await waitFor(() => expect(url(memory)).toBe("https://c.example/"));
  });

  it("runs over the sites without one tag, and a new tag of the strip goes on the site", async () => {
    const { api, memory } = await setup();
    fireEvent.change(screen.getByRole("combobox", { name: "Sites of the run" }), { target: { value: "without:fun" } });
    expect(url(memory)).toBe("https://a.example/");
    expect(screen.getByText("1 of 3")).toBeTruthy();
    const field = screen.getByRole("textbox", { name: "New tag for this site" });
    fireEvent.change(field, { target: { value: "Later" } });
    fireEvent.submit(field);
    await waitFor(async () => expect((await siteOf(api, "https://a.example/"))?.tags).toHaveLength(2));
    key("u");
    await waitFor(async () => expect((await siteOf(api, "https://a.example/"))?.tags).toHaveLength(1));
    expect((await api.view()).tags.map((tag) => tag.name).sort()).toEqual(["Fun", "Later", "News"]);
  });

  it("leaves Enter to a button, and leaves the run with Escape", async () => {
    const { memory } = await setup();
    fireEvent.keyDown(screen.getByRole("button", { name: "Next site" }), { key: "Enter" });
    expect(url(memory)).toBe("https://b.example/");
    key("Escape");
    expect(screen.getByRole("searchbox", { name: "Find a site" })).toBeTruthy();
  });

  it("draws the still picture of a surface with no view, and not the text of a load", async () => {
    const { memory } = await setup();
    const load = memory.loads.get("main");
    const picture = "data:image/png;base64,iVBORw0KGgo=";
    act(() => memory.emit({ type: "shown", slot: "main", load: load?.load ?? 0, url: "https://b.example/", title: "Beta", picture }));
    const image = screen.getByRole("img", { name: "A still picture of Beta" });
    expect(image.getAttribute("src")).toBe(picture);
    expect(screen.getByText("A still picture. The live page did not show here.")).toBeTruthy();
    expect(screen.queryByText("The site loads.")).toBeNull();
    // A live view gives no picture, so the slot draws nothing on its own
    act(() => key("j"));
    act(() => memory.emit({ type: "shown", slot: "main", load: memory.loads.get("main")?.load ?? 0, url: "https://c.example/" }));
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("tells when a run has no sites", async () => {
    await setup(async (api) => {
      const view = await api.view();
      await api.apply(view.sites.map((site) => ({ type: "site.tagged" as const, site: site.id, tag: "fun" })));
    });
    // No site is without tags, so the run starts with each site
    expect(screen.getByRole("combobox", { name: "Sites of the run" })).toHaveProperty("value", "all");
    fireEvent.change(screen.getByRole("combobox", { name: "Sites of the run" }), { target: { value: "without:fun" } });
    expect(screen.getByRole("heading", { name: "No sites in this run" })).toBeTruthy();
    expect(screen.getByText("Sites without Fun: there are none. Choose other sites at the top.")).toBeTruthy();
  });
});

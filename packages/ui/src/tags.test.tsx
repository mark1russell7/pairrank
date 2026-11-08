// @vitest-environment happy-dom
import { pairrankModule } from "@pairrank/host";
import { openStore } from "@pairrank/store";
import { memorySurface } from "@pairrank/surfaces";
import { callerOf } from "@procedures/client";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { type Call, apiOf } from "./api.ts";
import { App } from "./app.tsx";

afterEach(cleanup);

function setup() {
  const store = openStore(":memory:");
  let n = 0;
  const module = pairrankModule(store, { key: (url) => url.replace(/\/$/, ""), id: () => `id${++n}`, now: () => "2026-11-08T12:00:00Z" });
  const caller = callerOf(module);
  const call: Call = (path, input) => caller(path, input);
  let t = 0;
  return { api: apiOf(call), memory: memorySurface(), newId: () => `tag${++t}` };
}

const list = {
  format: "pairrank.sites",
  version: 1,
  source: "test",
  sites: [
    { url: "https://a.example/", title: "Alpha", tags: ["News"] },
    { url: "https://b.example/", title: "Beta", tags: ["World"] },
    { url: "https://c.example/", title: "Gamma" },
  ],
};

/** This function opens the tag screen. `prepare` changes the data before the app reads it. */
async function open(withList = true, prepare?: (api: ReturnType<typeof setup>["api"]) => Promise<unknown>) {
  const context = setup();
  if (withList) await context.api.importList(list);
  await prepare?.(context.api);
  render(<App api={context.api} surface={context.memory.surface} newId={context.newId} />);
  fireEvent.click(await screen.findByRole("button", { name: "Tags" }));
  return context;
}

const newTag = () => within(screen.getByRole("region", { name: "New tag" }));
const tagList = () => screen.getByRole("list");

describe("the tag screen", () => {
  it("makes a tag with a key and a color, and refuses a name that a tag has", async () => {
    const { api } = await open(false);
    expect(screen.getByText(/No tags yet/)).toBeTruthy();
    fireEvent.change(newTag().getByRole("textbox", { name: "Name" }), { target: { value: "Sport" } });
    fireEvent.change(newTag().getByRole("textbox", { name: "Key" }), { target: { value: "P" } });
    fireEvent.click(newTag().getByRole("radio", { name: "Teal" }));
    fireEvent.click(newTag().getByRole("button", { name: "Make the tag" }));
    await waitFor(() => expect(within(tagList()).getByText("Sport")).toBeTruthy());
    expect((await api.view()).tags).toEqual([{ id: "tag1", name: "Sport", color: "#188a7e", key: "p", sites: 0 }]);
    expect((newTag().getByRole("textbox", { name: "Name" }) as HTMLInputElement).value).toBe("");

    fireEvent.change(newTag().getByRole("textbox", { name: "Name" }), { target: { value: "sport" } });
    fireEvent.click(newTag().getByRole("button", { name: "Make the tag" }));
    expect((await newTag().findByRole("alert")).textContent).toBe('The tag "Sport" has this name.');
    fireEvent.change(newTag().getByRole("textbox", { name: "Name" }), { target: { value: "Sports" } });
    expect(newTag().queryByRole("alert")).toBeNull();
  });

  it("finds a tag, and renames it with no change to its sites", async () => {
    const { api } = await open();
    fireEvent.change(screen.getByRole("searchbox", { name: "Find a tag" }), { target: { value: "wor" } });
    expect(within(tagList()).queryByText("News")).toBeNull();
    fireEvent.click(within(tagList()).getByRole("button", { name: /World/ }));
    const row = within(tagList());
    fireEvent.change(row.getByRole("textbox", { name: "Name" }), { target: { value: "Planet" } });
    fireEvent.click(row.getByRole("button", { name: "Save" }));
    await waitFor(async () => expect((await api.view()).tags.map((tag) => tag.name).sort()).toEqual(["News", "Planet"]));
    const view = await api.view();
    expect(view.sites.find((site) => site.title === "Beta")?.tags).toEqual([view.tags.find((tag) => tag.name === "Planet")?.id]);
  });

  it("merges a tag into another tag after a confirmation, and keeps its picks", async () => {
    let world = "";
    const { api } = await open(true, async (api) => {
      const before = await api.view();
      const [news, other] = ["News", "World"].map((name) => before.tags.find((tag) => tag.name === name)!.id);
      const [a, b] = ["Alpha", "Beta"].map((title) => before.sites.find((site) => site.title === title)!.id);
      world = other!;
      return api.apply([
        { type: "site.tagged", site: b!, tag: news! },
        { type: "pick", a: a!, b: b!, scope: { kind: "tag", tag: news! }, outcome: "a" },
      ]);
    });
    fireEvent.click(await screen.findByRole("button", { name: /News/ }));
    fireEvent.change(screen.getByRole("combobox", { name: "Merge into" }), { target: { value: world } });
    expect(screen.getByText("The sites (2) and the picks (1) of News go to World. Then the tag News goes away.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Merge News into World" }));
    await waitFor(() => expect(within(tagList()).queryByText("News")).toBeNull());
    const after = await api.view();
    expect(after.tags).toEqual([{ id: world, name: "World", color: undefined, key: undefined, sites: 2 }]);
    expect(after.picks[`tag:${world}`]).toBe(1);
    expect(within(tagList()).getByText("Sites 2, picks 1")).toBeTruthy();
  });

  it("deletes a tag only after a confirmation", async () => {
    const { api } = await open();
    fireEvent.click(await screen.findByRole("button", { name: /News/ }));
    fireEvent.click(screen.getByRole("button", { name: "Delete the tag" }));
    expect(screen.getByText(/The tag News goes away from its sites \(1\)/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Keep the tag" }));
    expect((await api.view()).tags).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Delete the tag" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete News" }));
    await waitFor(async () => expect((await api.view()).tags.map((tag) => tag.name)).toEqual(["World"]));
  });
});

describe("the tags on the Look screen", () => {
  it("puts a tag on the site with its key, or removes it, and makes a new tag for the site", async () => {
    const { api } = await open(true, async (api) => {
      const world = (await api.view()).tags.find((tag) => tag.name === "World")!;
      return api.apply([{ type: "tag.edited", tag: world.id, key: "w" }]);
    });
    const view = await api.view();
    fireEvent.click(screen.getByRole("button", { name: "Sites" }));
    fireEvent.click(await screen.findByText("Gamma"));
    const strip = () => within(screen.getByRole("group", { name: "Tags of the site" }));
    const pressed = (name: string) => strip().getByRole("button", { name: new RegExp(name) }).getAttribute("aria-pressed");
    await waitFor(() => expect(pressed("World")).toBe("false"));

    fireEvent.keyDown(window, { key: "W" });
    await waitFor(() => expect(pressed("World")).toBe("true"));
    fireEvent.keyDown(window, { key: "w" });
    await waitFor(() => expect(pressed("World")).toBe("false"));
    // A key with a modifier is not a tag key
    fireEvent.keyDown(window, { key: "w", ctrlKey: true });
    fireEvent.click(strip().getByRole("button", { name: /News/ }));
    await waitFor(() => expect(pressed("News")).toBe("true"));

    fireEvent.change(strip().getByRole("textbox", { name: "New tag for this site" }), { target: { value: "Later" } });
    fireEvent.submit(strip().getByRole("textbox", { name: "New tag for this site" }));
    await waitFor(() => expect(pressed("Later")).toBe("true"));
    const gamma = (await api.view()).sites.find((site) => site.title === "Gamma")!;
    expect([...gamma.tags].sort()).toEqual([view.tags.find((tag) => tag.name === "News")!.id, "tag1"].sort());
  });
});

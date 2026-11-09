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

/** Three sites: Alpha and Beta have News, and Gamma has no tag. */
const list = {
  format: "pairrank.sites",
  version: 1,
  source: "test",
  sites: [
    { url: "https://a.example/", title: "Alpha", tags: ["News"] },
    { url: "https://b.example/", title: "Beta", tags: ["News"] },
    { url: "https://c.example/", title: "Gamma" },
  ],
};

/** This function opens the app on the duel screen. */
async function open() {
  const store = openStore(":memory:");
  let n = 0;
  const module = pairrankModule(store, { key: (url) => url.replace(/\/$/, ""), id: () => `id${++n}`, now: () => "2026-11-08T12:00:00Z" });
  const caller = callerOf(module);
  const call: Call = (path, input) => caller(path, input);
  const api = apiOf(call);
  const memory = memorySurface();
  await api.importList(list);
  let d = 0;
  render(<App api={api} surface={memory.surface} newId={() => `new${++d}`} />);
  const duel = await screen.findByRole("button", { name: "Duel" });
  await waitFor(() => expect(duel.hasAttribute("disabled")).toBe(false));
  fireEvent.click(duel);
  const named = new Map((await api.view()).sites.map((site) => [site.title, site]));
  /** This function gives the titles of the sites on the screen, when the pair is ready (B2). */
  const shown = async (): Promise<string[]> => {
    await waitFor(() => expect(screen.getByRole("button", { name: /Left is better/ }).hasAttribute("disabled")).toBe(false));
    const titles = [...document.querySelectorAll(".duel-caption .site-name")].map((name) => name.textContent ?? "");
    await waitFor(() => expect([memory.loads.get("left")?.url, memory.loads.get("right")?.url]).toEqual(titles.map((title) => named.get(title)?.url)));
    return titles;
  };
  const asking = () => document.querySelector(".asking")?.textContent;
  return { api, memory, shown, asking };
}

const textbox = (form: HTMLElement, name: string) => within(form).getByRole("textbox", { name });

describe("the duel modes", () => {
  it("saves a new mode, and asks its picks of each pair one after another", async () => {
    const { api, memory, shown, asking } = await open();
    await shown();
    fireEvent.click(screen.getByRole("button", { name: "New mode" }));
    const form = screen.getByRole("form", { name: "New mode" });
    // The editor takes the place of the sites, so the slots are empty
    expect(memory.loads.get("left")).toBeUndefined();
    fireEvent.change(textbox(form, "Name"), { target: { value: "Morning" } });
    fireEvent.change(textbox(form, "Sites"), { target: { value: "news" } });
    await within(form).findByText("2 sites that are not hidden.");
    fireEvent.click(within(form).getByRole("button", { name: "News" }));
    expect(within(form).getByText(/Each pair asks: Overall, then News\./)).toBeTruthy();
    fireEvent.click(within(form).getByRole("button", { name: "Save the mode" }));

    await waitFor(() => expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "Pick under" }).selectedOptions[0]?.textContent).toBe("Morning"));
    const view = await api.view();
    expect(view.modes).toEqual([{ id: "new2", name: "Morning", pool: { kind: "tag", tag: view.tags[0]!.id }, asks: [{ kind: "overall" }, { kind: "tag", tag: view.tags[0]!.id }] }]);

    const pair = await shown();
    expect(pair.sort()).toEqual(["Alpha", "Beta"]);
    expect(asking()).toBe("Pick 1 of 2: Overall");
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    await waitFor(() => expect(asking()).toBe("Pick 2 of 2: News"));
    expect((await shown()).sort()).toEqual(["Alpha", "Beta"]);
    fireEvent.keyDown(window, { key: "t" });
    await waitFor(() => expect(screen.getByText("Picks in this duel: 2")).toBeTruthy());
    await waitFor(() => expect(asking()).toBe("Pick 1 of 2: Overall"));
    const picks = (await api.view()).picks;
    expect([picks["overall"], picks[`tag:${view.tags[0]!.id}`]]).toEqual([1, 1]);

    // An undo goes back to the pick of the last step
    await shown();
    fireEvent.keyDown(window, { key: "u" });
    await waitFor(() => expect(asking()).toBe("Pick 2 of 2: News"));
    fireEvent.keyDown(window, { key: "u" });
    await waitFor(() => expect(asking()).toBe("Pick 1 of 2: Overall"));
    expect((await api.view()).picks).toEqual({});
  });

  it("shows the problems of the fields, and the keys of the duel wait while the editor is open", async () => {
    const { api, shown } = await open();
    await shown();
    fireEvent.click(screen.getByRole("button", { name: "New mode" }));
    const form = screen.getByRole("form", { name: "New mode" });
    fireEvent.change(textbox(form, "Sites"), { target: { value: "news or sport" } });
    expect(within(form).getByText('No tag has the name "sport".')).toBeTruthy();
    expect(textbox(form, "Sites").getAttribute("aria-invalid")).toBe("true");
    fireEvent.click(within(form).getByRole("button", { name: "Overall" }));
    fireEvent.keyDown(within(form).getByRole("button", { name: "Overall" }), { key: "t" });
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    fireEvent.click(within(form).getByRole("button", { name: "Save the mode" }));
    expect(within(form).getByText("Give the mode a name.")).toBeTruthy();
    expect(within(form).getByText("Choose one pick or more for each pair.")).toBeTruthy();
    expect((await api.view()).modes).toEqual([]);
    expect((await api.view()).picks).toEqual({});

    fireEvent.keyDown(textbox(form, "Name"), { key: "Escape" });
    expect(screen.queryByRole("form")).toBeNull();
    await shown();
  });

  it("tells when a mode has no pair, and deletes a mode", async () => {
    const { api, shown } = await open();
    await shown();
    fireEvent.click(screen.getByRole("button", { name: "New mode" }));
    const draft = screen.getByRole("form", { name: "New mode" });
    fireEvent.change(textbox(draft, "Name"), { target: { value: "Lonely" } });
    fireEvent.change(textbox(draft, "Sites"), { target: { value: "-news" } });
    fireEvent.click(within(draft).getByRole("button", { name: "Save the mode" }));
    expect(await screen.findByRole("heading", { name: "No pair in this mode" })).toBeTruthy();
    const select = screen.getByRole<HTMLSelectElement>("combobox", { name: "Pick under" });
    expect(select.selectedOptions[0]?.textContent).toBe("Lonely");

    fireEvent.click(screen.getByRole("button", { name: "Change the mode" }));
    const form = screen.getByRole("form", { name: "Mode Lonely" });
    expect((textbox(form, "Sites") as HTMLInputElement).value).toBe("not News");
    fireEvent.click(within(form).getByRole("button", { name: "Delete the mode" }));
    await waitFor(() => expect(screen.queryByRole("form")).toBeNull());
    expect((await api.view()).modes).toEqual([]);
    expect(select.value).toBe("overall");
    await shown();
  });
});

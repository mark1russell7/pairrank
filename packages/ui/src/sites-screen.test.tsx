// @vitest-environment happy-dom
import type { Draft } from "@pairrank/core";
import { pairrankModule } from "@pairrank/host";
import { openStore } from "@pairrank/store";
import { type MemorySurface as Memory, memorySurface } from "@pairrank/surfaces";
import { callerOf } from "@procedures/client";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { type Call, type PairrankApi, apiOf } from "./api.ts";
import { App } from "./app.tsx";
import { FIRST_SETTINGS, MIX_LEVELS, mixLevelOf, modelHelp, orderChoices, orderOf, ratingText } from "./viewer.ts";

afterEach(cleanup);

/** The first seed of the mix. */
const SEED = 1;

/** The ids of the sites Alpha, Beta and Gamma, and of the tags News and Read later. */
const [ALPHA, BETA, GAMMA] = ["id1", "id2", "id3"];
const [NEWS, LATER] = ["news", "later"];

/**
 * The host with four sites and two tags. Alpha and Beta have News, and Beta and Gamma have Read later. The drafts
 * `more` follow. A call of a path in `refuse` fails with the text "The host is busy.".
 */
async function setup(more: readonly Draft[] = [], refuse: readonly string[] = []): Promise<{ api: PairrankApi; memory: Memory }> {
  const store = openStore(":memory:");
  let n = 0;
  const caller = callerOf(pairrankModule(store, { key: (address) => address.replace(/\/$/, ""), id: () => `id${++n}`, now: () => "2026-11-08T12:00:00Z" }));
  const call: Call = (path, input) => (refuse.includes(path.join(".")) ? Promise.reject(new Error("The host is busy.")) : caller(path, input));
  const api = apiOf(call);
  const sites = ["Alpha", "Beta", "Gamma", "Delta"].map((title) => ({ url: `https://${title.toLowerCase()}.example/`, title }));
  await api.importList({ format: "pairrank.sites", version: 1, source: "test", sites });
  await api.apply([
    { type: "tag.created", tag: NEWS, name: "News" },
    { type: "tag.created", tag: LATER, name: "Read later" },
    { type: "site.tagged", site: ALPHA, tag: NEWS },
    { type: "site.tagged", site: BETA, tag: NEWS },
    { type: "site.tagged", site: BETA, tag: LATER },
    { type: "site.tagged", site: GAMMA, tag: LATER },
    ...more,
  ]);
  const memory = memorySurface();
  render(<App api={api} surface={memory.surface} seed={SEED} />);
  await screen.findByRole("textbox", { name: "Filter by tags" });
  return { api, memory };
}

const url = (memory: Memory) => memory.loads.get("main")?.url;
const names = () => within(screen.getByRole("list")).queryAllByRole("button").map((button) => button.querySelector(".site-name")?.textContent);
const query = () => screen.getByRole("textbox", { name: "Filter by tags" }) as HTMLInputElement;
const order = () => screen.getByRole("combobox", { name: "Order of the sites" }) as HTMLSelectElement;
const pick = (a: string, b: string, tag?: string): Draft => ({ type: "pick", a, b, scope: tag === undefined ? { kind: "overall" } : { kind: "tag", tag }, outcome: "a" });
/** Picks of the overall ladder, enough for a test of the models: Alpha beats Beta and Gamma, and Beta beats Gamma, with some upsets. */
const tested = (count: number): Draft[] =>
  Array.from({ length: count }, (_, i): Draft => {
    const [a, b] = ([[ALPHA, BETA], [BETA, GAMMA], [ALPHA, GAMMA]] as const)[i % 3] as readonly [string, string];
    return { type: "pick", a, b, scope: { kind: "overall" }, outcome: i % 7 === 6 ? "b" : "a" };
  });

describe("the settings of the viewer", () => {
  it("gives the order of each choice", () => {
    expect(orderOf(FIRST_SETTINGS)).toEqual({ kind: "added" });
    expect(orderOf({ ...FIRST_SETTINGS, order: "title" })).toEqual({ kind: "title" });
    expect(orderOf({ ...FIRST_SETTINGS, order: "overall" })).toEqual({ kind: "rating", scopes: [{ kind: "overall" }] });
    expect(orderOf({ ...FIRST_SETTINGS, order: "tag:t" })).toEqual({ kind: "rating", scopes: [{ kind: "tag", tag: "t" }] });
    expect(orderOf({ ...FIRST_SETTINGS, order: "mean" })).toBeUndefined();
    expect(orderOf({ ...FIRST_SETTINGS, order: "mean", mean: ["a", "b"] })).toEqual({
      kind: "rating",
      scopes: [
        { kind: "tag", tag: "a" },
        { kind: "tag", tag: "b" },
      ],
    });
    expect(orderOf({ ...FIRST_SETTINGS, order: "tag:" })).toEqual({ kind: "added" });
  });

  it("adds the mix to an order by rating when the temperature is more than 0", () => {
    const mixed = { ...FIRST_SETTINGS, temperature: 2, seed: 9 };
    expect(orderOf({ ...mixed, order: "overall" })).toEqual({ kind: "rating", scopes: [{ kind: "overall" }], mix: { temperature: 2, seed: 9 } });
    expect(orderOf({ ...mixed, order: "mean", mean: ["a"] })).toEqual({ kind: "rating", scopes: [{ kind: "tag", tag: "a" }], mix: { temperature: 2, seed: 9 } });
    expect(orderOf({ ...mixed, order: "title" })).toEqual({ kind: "title" });
    expect(orderOf({ ...mixed, order: "added" })).toEqual({ kind: "added" });
  });

  it("gives the level of a temperature, or the nearest level", () => {
    expect(MIX_LEVELS.map((level) => mixLevelOf(level.temperature))).toEqual(MIX_LEVELS.map((_, i) => i));
    expect(mixLevelOf(0.7)).toBe(1);
    expect(mixLevelOf(100)).toBe(MIX_LEVELS.length - 1);
    expect(MIX_LEVELS[0]?.temperature).toBe(0);
  });

  it("names the choices, with the tags in the order of their names", () => {
    const tags = [
      { id: "z", name: "Zebra", color: undefined, key: undefined, sites: 0 },
      { id: "a", name: "Apple", color: undefined, key: undefined, sites: 0 },
    ];
    expect(orderChoices(tags).map((choice) => choice.name)).toEqual(["Newest first", "Title", "Rating overall", "Rating in Apple", "Rating in Zebra", "Mean rating of tags"]);
    expect([ratingText(1623.4, 44.6), ratingText(1500, undefined)]).toEqual(["1623 ± 45", "1500"]);
  });

  it("tells the test of the models, for one ladder and for more ladders", () => {
    expect(FIRST_SETTINGS.model).toBe("best");
    expect(modelHelp("best", 2, undefined)).toBe("The test of each tag chooses the model of its ladder.");
    expect(modelHelp("elo", 3, undefined)).toBe("Each ladder uses Elo.");
    expect(modelHelp("best", 1, undefined)).toBe("");
    expect(modelHelp("best", 1, { model: "bradley-terry", scores: [], trained: 1, tested: 0 })).toBe(
      "The ladder has 1 pick. A test of the models needs more picks, so the best model is Bradley-Terry.",
    );
    const scores = [
      { model: "glicko2", logLoss: 0.5 },
      { model: "elo", logLoss: 0.61234 },
      { model: "bradley-terry", logLoss: 0.7 },
    ] as const;
    expect(modelHelp("elo", 1, { model: "glicko2", scores: [...scores], trained: 48, tested: 12 })).toBe(
      "The test chooses Glicko-2. The log-loss on the last 12 picks is Glicko-2 0.500, Elo 0.612, Bradley-Terry 0.700. A lower log-loss is better.",
    );
  });
});

describe("the viewer on the Sites screen", () => {
  it("lists the sites that agree with a tag query, and marks a problem in the query", async () => {
    await setup();
    await waitFor(() => expect(names()).toEqual(["Alpha", "Beta", "Gamma", "Delta"]));
    fireEvent.change(query(), { target: { value: 'news and not "read later"' } });
    await waitFor(() => expect(names()).toEqual(["Alpha"]));
    expect(screen.getByText("1 of 4 sites")).toBeTruthy();

    fireEvent.change(query(), { target: { value: "news or sport" } });
    expect((await screen.findByRole("alert")).textContent).toBe('No tag has the name "sport". (at "sport")');
    expect(query().getAttribute("aria-invalid")).toBe("true");
    // The last good list stays on the screen
    expect(names()).toEqual(["Alpha"]);

    fireEvent.change(query(), { target: { value: "-news" } });
    await waitFor(() => expect(names()).toEqual(["Gamma", "Delta"]));
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.change(screen.getByRole("searchbox", { name: "Find a site" }), { target: { value: "gam" } });
    expect(names()).toEqual(["Gamma"]);
  });

  it("orders the sites by a rating in a tag, with the sites with no rating last", async () => {
    await setup([pick(BETA, ALPHA, NEWS), pick(BETA, ALPHA, NEWS)]);
    fireEvent.change(order(), { target: { value: `tag:${NEWS}` } });
    await waitFor(() => expect(names()).toEqual(["Beta", "Alpha", "Gamma", "Delta"]));
    const scores = screen.getAllByText(/^\d+( ± \d+)?$|^No rating$/).map((each) => each.textContent);
    expect(scores.slice(2)).toEqual(["No rating", "No rating"]);
    expect(Number(scores[0]?.split(" ")[0])).toBeGreaterThan(Number(scores[1]?.split(" ")[0]));
  });

  it("mixes an order by rating, shuffles again with the next seed, and keeps the sites with no rating last", async () => {
    const { api } = await setup([pick(BETA, ALPHA, NEWS), pick(BETA, ALPHA, NEWS)]);
    expect(screen.queryByRole("slider", { name: "Mix" })).toBeNull();
    fireEvent.change(order(), { target: { value: `tag:${NEWS}` } });
    await waitFor(() => expect(names()).toEqual(["Beta", "Alpha", "Gamma", "Delta"]));
    const slider = screen.getByRole("slider", { name: "Mix" });
    expect(slider.getAttribute("aria-valuetext")).toBe("None");
    expect(screen.getByText("The order follows the ratings.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Shuffle again" })).toBeNull();

    // The host gives the order of each seed. Find the first shuffle that puts Alpha first.
    const near = MIX_LEVELS.length - 1;
    const temperature = MIX_LEVELS[near]?.temperature ?? 0;
    const firstOf = async (seed: number) => {
      const answer = await api.viewer("", { kind: "rating", scopes: [{ kind: "tag", tag: NEWS }], mix: { temperature, seed } });
      return answer.ok ? answer.rows[0]?.site : undefined;
    };
    let shuffles = 0;
    while ((await firstOf(SEED + shuffles)) !== ALPHA) shuffles++;
    expect(shuffles).toBeLessThan(40);

    fireEvent.change(slider, { target: { value: String(near) } });
    expect(screen.getByText(MIX_LEVELS[near]?.hint ?? "")).toBeTruthy();
    expect(slider.getAttribute("aria-valuetext")).toBe("Near random");
    for (let i = 0; i < shuffles; i++) fireEvent.click(screen.getByRole("button", { name: "Shuffle again" }));
    await waitFor(() => expect(names()).toEqual(["Alpha", "Beta", "Gamma", "Delta"]));

    fireEvent.change(slider, { target: { value: "0" } });
    await waitFor(() => expect(names()).toEqual(["Beta", "Alpha", "Gamma", "Delta"]));
  });

  it("shows the test of the models of a ladder, and orders by the model of a choice", async () => {
    await setup([...tested(36), pick(BETA, ALPHA, NEWS), pick(BETA, ALPHA, NEWS)]);
    expect(screen.queryByRole("combobox", { name: "Model" })).toBeNull();
    fireEvent.change(order(), { target: { value: "overall" } });
    const model = (await screen.findByRole("combobox", { name: "Model" })) as HTMLSelectElement;
    expect(model.value).toBe("best");
    await screen.findByText(/^The test chooses (Bradley-Terry|Elo|Glicko-2)\. The log-loss on the last \d+ picks is /);
    await waitFor(() => expect(names()[0]).toBe("Alpha"));

    // Bradley-Terry gives a standard error, and Elo gives none, so no rating of Elo has a ±
    const scores = () => [...document.querySelectorAll(".site-score")].map((each) => each.textContent);
    fireEvent.change(model, { target: { value: "bradley-terry" } });
    await waitFor(() => expect(scores().every((score) => score?.includes("±"))).toBe(true));
    fireEvent.change(model, { target: { value: "elo" } });
    await waitFor(() => expect(scores().every((score) => /^\d+$/.test(score ?? ""))).toBe(true));
    // The test does not change with the choice
    expect(screen.getByText(/^The test chooses /)).toBeTruthy();

    fireEvent.change(order(), { target: { value: `tag:${NEWS}` } });
    await screen.findByText("The ladder has 2 picks. A test of the models needs more picks, so the best model is Bradley-Terry.");
    fireEvent.change(order(), { target: { value: "mean" } });
    fireEvent.click(within(screen.getByRole("group", { name: "Tags of the mean" })).getByRole("button", { name: "News" }));
    fireEvent.click(within(screen.getByRole("group", { name: "Tags of the mean" })).getByRole("button", { name: "Read later" }));
    expect(await screen.findByText("Each ladder uses Elo.")).toBeTruthy();
  });

  it("tells a failure of the test of the models", async () => {
    await setup([pick(BETA, ALPHA)], ["pairrank.model"]);
    fireEvent.change(order(), { target: { value: "overall" } });
    const help = await screen.findByText("The test of the models failed. The host is busy.");
    expect(help.getAttribute("role")).toBe("alert");
    await waitFor(() => expect(names()[0]).toBe("Beta"));
  });

  it("orders by the mean over the chosen tags, and by title until a tag is chosen", async () => {
    await setup([pick(GAMMA, BETA, LATER), pick(GAMMA, BETA, LATER), pick(BETA, ALPHA, NEWS)]);
    fireEvent.change(order(), { target: { value: "mean" } });
    await waitFor(() => expect(names()).toEqual(["Alpha", "Beta", "Delta", "Gamma"]));
    expect(screen.getByText("Choose the tags of the mean. Until then, the order is by title.")).toBeTruthy();
    const chips = within(screen.getByRole("group", { name: "Tags of the mean" }));
    fireEvent.click(chips.getByRole("button", { name: "Read later" }));
    await waitFor(() => expect(names()).toEqual(["Gamma", "Beta", "Alpha", "Delta"]));
    expect(chips.getByRole("button", { name: "Read later" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("keeps the settings after a change of screen, and shows the list one site at a time", async () => {
    const { memory } = await setup();
    fireEvent.change(query(), { target: { value: "later" } });
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain('No tag has the name "later".'));
    fireEvent.change(query(), { target: { value: '"read later"' } });
    fireEvent.change(order(), { target: { value: "title" } });
    await waitFor(() => expect(names()).toEqual(["Beta", "Gamma"]));

    fireEvent.click(screen.getByRole("button", { name: "Tags" }));
    fireEvent.click(screen.getByRole("button", { name: "Sites" }));
    expect(query().value).toBe('"read later"');
    expect(order().value).toBe("title");
    await waitFor(() => expect(names()).toEqual(["Beta", "Gamma"]));

    fireEvent.click(screen.getByRole("button", { name: "Look at these one at a time" }));
    const run = (await screen.findByRole("combobox", { name: "Sites of the run" })) as HTMLSelectElement;
    expect(run.value).toBe("list");
    expect(run.selectedOptions[0]?.textContent).toBe('Sites of "Read later" (2)');
    expect(url(memory)).toBe("https://beta.example/");
    fireEvent.keyDown(window, { key: "j" });
    expect(url(memory)).toBe("https://gamma.example/");
  });

  it("starts the run of the list at the site of a click", async () => {
    const { memory } = await setup();
    await waitFor(() => expect(names()).toEqual(["Alpha", "Beta", "Gamma", "Delta"]));
    fireEvent.click(screen.getByRole("button", { name: /Gamma/ }));
    const run = (await screen.findByRole("combobox", { name: "Sites of the run" })) as HTMLSelectElement;
    expect(run.selectedOptions[0]?.textContent).toBe("Sites of the viewer (4)");
    expect(url(memory)).toBe("https://gamma.example/");
  });
});

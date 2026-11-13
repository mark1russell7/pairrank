import { openStore } from "@pairrank/store";
import { Client, PortTransport, ProcedureServer, callerOf, createRegistry, pathToMethod } from "@procedures/client";
import type { Ladder, ModelChoice, PairChoice } from "@pairrank/ratings";
import { describe, expect, it } from "vitest";
import { pairrankModule } from "./module.ts";
import type { ApplyResult, DuelPair, ImportPreview, ImportResult, StateView } from "./views.ts";

function setup() {
  const store = openStore(":memory:");
  let n = 0;
  const module = pairrankModule(store, {
    key: (url) => url.replace(/\/$/, ""),
    id: () => `id${++n}`,
    now: () => "2026-11-08T12:00:00Z",
  });
  return { store, module, call: callerOf(module) };
}

const list = {
  format: "pairrank.sites",
  version: 1,
  source: "test",
  sites: [
    { url: "https://a.example/", title: "A", tags: ["News"], path: ["Bar"] },
    { url: "https://a.example", tags: ["Tools"] },
    { url: "https://b.example/" },
    { url: "chrome://settings" },
  ],
};

describe("pairrankModule", () => {
  it("plans an import with no change, then imports it", async () => {
    const { store, call } = setup();
    const preview = await call<ImportPreview>(["pairrank", "import", "plan"], { list });
    expect(preview.report).toEqual({ added: 2, merged: 1, existing: 0, tagged: 2, tagsCreated: ["News", "Tools"] });
    expect(preview.entries.map((entry) => [entry.index, entry.code])).toEqual([[3, "not-a-web-url"]]);
    expect(store.state.sites.size).toBe(0);

    const result = await call<ImportResult>(["pairrank", "import", "apply"], { list });
    expect(result.problems).toEqual([]);
    const view = await call<StateView>(["pairrank", "view"], {});
    expect(view.sites.map((site) => site.url)).toEqual(["https://a.example/", "https://b.example/"]);
    expect(view.tags.map((tag) => [tag.name, tag.sites])).toEqual([
      ["News", 1],
      ["Tools", 1],
    ]);
    store.close();
  });

  it("applies drafts in one call, and gives the problem of a refused draft", async () => {
    const { store, call } = setup();
    await call(["pairrank", "import", "apply"], { list });
    const [a, b] = [...store.state.sites.keys()];
    const result = await call<ApplyResult>(["pairrank", "apply"], {
      drafts: [
        { type: "pick", a, b, scope: { kind: "overall" }, outcome: "a" },
        { type: "pick", a, b: a, scope: { kind: "overall" }, outcome: "tie" },
        { type: "pick", a, b, scope: { kind: "overall" }, outcome: "skip" },
      ],
    });
    expect(result.events).toHaveLength(3);
    expect(result.problems.map((problem) => [problem.event, problem.code])).toEqual([[result.events[1], "same-site"]]);
    const view = await call<StateView>(["pairrank", "view"], {});
    expect(view.picks).toEqual({ overall: 1 });

    const ladder = await call<Ladder>(["pairrank", "ladder"], { scope: { kind: "overall" } });
    expect(ladder.ratings.map((rating) => rating.site)).toEqual([a, b]);
    const elo = await call<Ladder>(["pairrank", "ladder"], { scope: { kind: "overall" }, model: "elo" });
    expect(elo.model).toBe("elo");
    await expect(call(["pairrank", "ladder"], { scope: { kind: "everything" } })).rejects.toThrow();
    const choice = await call<ModelChoice>(["pairrank", "model"], { scope: { kind: "overall" } });
    expect(choice.model).toBe("bradley-terry");
    // The setting best gives the ladder of the chosen model
    const best = await call<Ladder>(["pairrank", "ladder"], { scope: { kind: "overall" }, model: "best" });
    expect(best.model).toBe(choice.model);
    store.close();
  });

  it("refuses a draft that is not valid, and writes nothing", async () => {
    const { store, call } = setup();
    await expect(call(["pairrank", "apply"], { drafts: [{ type: "site.tagged", site: "s" }] })).rejects.toThrow();
    await expect(call(["pairrank", "apply"], { drafts: [{ type: "site.hidden", site: "s", id: "mine" }] })).rejects.toThrow();
    expect([...store.events()]).toHaveLength(0);
    store.close();
  });

  it("serves its procedures over a message port", async () => {
    const { store, module } = setup();
    const channel = new MessageChannel();
    const server = new ProcedureServer({ registry: createRegistry(module), autoRegister: true });
    const serving = new PortTransport(channel.port1, { serve: server });
    const client = new Client(new PortTransport(channel.port2));
    const view = await client.call<object, StateView>(pathToMethod(["pairrank", "view"]), {});
    expect(view).toEqual({ sites: [], tags: [], modes: [], picks: {}, problems: 0 });
    channel.port1.close();
    channel.port2.close();
    void serving;
    store.close();
  });
  it("chooses the next pair of a duel in a scope, with a seed", async () => {
    const { store, call } = setup();
    await call(["pairrank", "import", "apply"], { list });
    const view = await call<StateView>(["pairrank", "view"], {});
    const ids = view.sites.map((site) => site.id).sort();
    const pair = await call<PairChoice | null>(["pairrank", "pair"], { scope: { kind: "overall" }, seed: "one" });
    expect([pair?.a, pair?.b].sort()).toEqual(ids);
    expect(await call(["pairrank", "pair"], { scope: { kind: "overall" }, seed: "one" })).toEqual(pair);
    // The tag News has one site, so it has no pair
    const news = view.tags.find((tag) => tag.name === "News")!.id;
    expect(await call(["pairrank", "pair"], { scope: { kind: "tag", tag: news }, seed: 1, recent: [[ids[0], ids[1]]], model: "elo" })).toBeNull();
    for (const bad of [{ scope: { kind: "overall" } }, { scope: { kind: "overall" }, seed: "" }, { scope: { kind: "overall" }, seed: 1, recent: [["a"]] }, { scope: { kind: "overall" }, seed: 1, model: "best" }]) {
      await expect(call(["pairrank", "pair"], bad), JSON.stringify(bad)).rejects.toThrow();
    }
    store.close();
  });

  it("saves a mode, shows it in the view, and chooses the pairs of the mode", async () => {
    const { store, call } = setup();
    await call(["pairrank", "import", "apply"], { list });
    const before = await call<StateView>(["pairrank", "view"], {});
    const tools = before.tags.find((tag) => tag.name === "Tools")!.id;
    const pool = { kind: "not", query: { kind: "tag", tag: tools } };
    const result = await call<ApplyResult>(["pairrank", "apply"], { drafts: [{ type: "mode.saved", mode: "m", name: "Morning", pool: { kind: "all" }, asks: [{ kind: "overall" }, { kind: "shared" }] }] });
    expect(result.problems).toEqual([]);
    const view = await call<StateView>(["pairrank", "view"], {});
    expect(view.modes).toEqual([{ id: "m", name: "Morning", pool: { kind: "all" }, asks: [{ kind: "overall" }, { kind: "shared" }] }]);

    const ids = view.sites.map((site) => site.id).sort();
    const pair = await call<DuelPair | null>(["pairrank", "pair"], { mode: "m", seed: "one" });
    expect([pair?.a, pair?.b].sort()).toEqual(ids);
    expect(pair?.asks).toEqual([{ kind: "overall" }]);
    const overall = await call<DuelPair | null>(["pairrank", "pair"], { scope: { kind: "overall" }, seed: "one" });
    expect(overall?.asks).toEqual([{ kind: "overall" }]);

    // A pool with one site has no pair
    await call(["pairrank", "apply"], { drafts: [{ type: "mode.saved", mode: "m", name: "Morning", pool, asks: [{ kind: "overall" }] }] });
    expect(await call(["pairrank", "pair"], { mode: "m", seed: 1 })).toBeNull();
    for (const bad of [{ mode: "x", seed: 1 }, { mode: "", seed: 1 }, { mode: "m", scope: { kind: "overall" }, seed: 1 }, { seed: 1 }]) {
      await expect(call(["pairrank", "pair"], bad), JSON.stringify(bad)).rejects.toThrow();
    }
    store.close();
  });
});

describe("the input schemas of pairrankModule", () => {
  const overall = { kind: "overall" };
  /** The inputs of each procedure that pass the schema. */
  const valid: [string, unknown][] = [
    ["view", {}],
    ["apply", { drafts: [] }],
    ["import.plan", { list }],
    ["import.apply", { list: { format: "pairrank.sites", version: 1, source: "test", sites: [] } }],
    ["ladder", { scope: overall, model: "glicko2" }],
    ["model", { scope: { kind: "tag", tag: "t" } }],
    ["pair", { scope: overall, seed: 7, recent: [] }],
    ["pair", { scope: overall, seed: "one" }],
    ["viewer", {}],
    ["viewer", { query: "", order: { kind: "rating", scopes: [overall], mix: { temperature: 1, seed: 2 } }, model: "elo" }],
    ["viewer", { order: { kind: "rating", scopes: [overall] }, model: "best" }],
    ["pair", { scope: overall, seed: 1, model: "best" }],
  ];
  /** The inputs of each procedure that the schema refuses, with a part of the message. */
  const invalid: [string, unknown, RegExp][] = [
    ["view", { all: true }, /Unrecognized key/],
    ["view", "everything", /expected object/],
    ["apply", {}, /The input must have a list drafts/],
    ["apply", { drafts: "x" }, /The input must have a list drafts/],
    ["apply", { drafts: [{ type: "site.removed" }] }, /The draft is not valid/],
    ["apply", { drafts: [], at: "now" }, /Unrecognized key/],
    ["import.plan", {}, /The list must be an object/],
    ["import.apply", { list: "https://a.example/" }, /The list must be an object/],
    ["ladder", {}, /The scope must be/],
    ["ladder", { scope: { kind: "tag" } }, /The scope must be/],
    ["ladder", { scope: { kind: "tag", tag: "" } }, /The scope must be/],
    ["ladder", { scope: { kind: "overall", tag: "t" } }, /Unrecognized key: "tag"/],
    ["model", { scope: overall, model: "trueskill" }, /The model must be best, bradley-terry, elo or glicko2/],
    ["pair", { scope: overall }, /The seed must be a text or a finite number/],
    ["pair", { scope: overall, seed: Number.POSITIVE_INFINITY }, /The seed must be a text or a finite number/],
    ["pair", { scope: overall, seed: 1, recent: [["a"]] }, /Each recent pair must be a list of two site ids/],
    ["pair", { scope: overall, seed: 1, recent: Array.from({ length: 201 }, () => ["a", "b"]) }, /200 pairs or fewer/],
    ["pair", { seed: 1 }, /a scope or a mode, and not the two/],
    ["pair", { scope: overall, mode: "m", seed: 1 }, /a scope or a mode, and not the two/],
    ["pair", { mode: 5, seed: 1 }, /The mode must be the id of a saved mode/],
    ["viewer", { query: 5 }, /The query must be a text/],
    ["viewer", { order: { kind: "random" } }, /The order must be/],
    ["viewer", { order: { kind: "title", scopes: [overall] } }, /Unrecognized key/],
    ["viewer", { order: { kind: "rating", scopes: Array.from({ length: 101 }, () => overall) } }, /from 1 to 100 scopes/],
  ];

  it("passes a valid input of each procedure", async () => {
    const { store, call } = setup();
    for (const [name, input] of valid) await expect(call(["pairrank", ...name.split(".")], input), `${name} ${JSON.stringify(input)}`).resolves.toBeDefined();
    store.close();
  });

  it("refuses a wrong type, a missing field, an extra field and a list that is too long, with a clear message", async () => {
    const { store, call } = setup();
    for (const [name, input, message] of invalid) await expect(call(["pairrank", ...name.split(".")], input), `${name} ${JSON.stringify(input)}`).rejects.toThrow(message);
    expect([...store.events()]).toHaveLength(0);
    store.close();
  });
});

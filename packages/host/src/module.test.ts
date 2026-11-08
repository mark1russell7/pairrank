import { openStore } from "@pairrank/store";
import { Client, PortTransport, ProcedureServer, callerOf, createRegistry, pathToMethod } from "@procedures/client";
import type { Ladder, ModelChoice, PairChoice } from "@pairrank/ratings";
import { describe, expect, it } from "vitest";
import { pairrankModule } from "./module.ts";
import type { ApplyResult, ImportPreview, ImportResult, StateView } from "./views.ts";

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
    expect(view).toEqual({ sites: [], tags: [], picks: {}, problems: 0 });
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
});

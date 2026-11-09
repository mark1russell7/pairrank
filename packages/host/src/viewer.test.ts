import { random } from "@mark1russell7/rigor-generators";
import { type Draft, type Scope, type TagQuery, replay, stamp } from "@pairrank/core";
import { ladderOf } from "@pairrank/ratings";
import { openStore } from "@pairrank/store";
import { callerOf } from "@procedures/client";
import { describe, expect, it } from "vitest";
import { pairrankModule } from "./module.ts";
import { viewerOf } from "./viewer.ts";
import type { ViewerAnswer } from "./views.ts";

const TAGS = ["news", "fun", "later"] as const;
const site = (id: string): Draft => ({ type: "site.added", site: id, url: `https://${id}.example/`, title: id.toUpperCase() });
const news: Scope = { kind: "tag", tag: "news" };
const fun: Scope = { kind: "tag", tag: "fun" };

/** Five sites: a and b have News, b and c have Fun, d has Later, and e has no tag. Two picks give a and c the wins. */
function stateOf() {
  const drafts: Draft[] = [
    ...["a", "b", "c", "d", "e"].map((id) => site(id)),
    ...TAGS.map((tag): Draft => ({ type: "tag.created", tag, name: tag[0]?.toUpperCase() + tag.slice(1) })),
    ...[["a", "news"], ["b", "news"], ["b", "fun"], ["c", "fun"], ["d", "later"]].map(([s, t]): Draft => ({ type: "site.tagged", site: s as string, tag: t as string })),
    { type: "pick", a: "a", b: "b", outcome: "a", scope: news },
    { type: "pick", a: "a", b: "b", outcome: "a", scope: news },
    { type: "pick", a: "c", b: "b", outcome: "a", scope: fun },
  ];
  // Each site gets a later time, so the order by date gives the last site first
  return replay(drafts.map((draft, i) => stamp(draft, `e${i}`, `2026-11-08T10:00:${String(i).padStart(2, "0")}Z`))).state;
}

/** This function tells if a site with the tags agrees with a query. It is the oracle of the filter program. */
function agrees(query: TagQuery, tags: ReadonlySet<string>): boolean {
  switch (query.kind) {
    case "all":
      return true;
    case "tag":
      return tags.has(query.tag);
    case "not":
      return !agrees(query.query, tags);
    case "and":
      return query.queries.every((part) => agrees(part, tags));
    case "or":
      return query.queries.some((part) => agrees(part, tags));
  }
}

function randomQuery(seed: number): TagQuery {
  const draw = random(seed);
  const make = (depth: number): TagQuery => {
    const kind = depth === 0 ? "tag" : draw.pick(["tag", "not", "and", "or"] as const);
    if (kind === "tag") return { kind, tag: draw.pick(TAGS) };
    if (kind === "not") return { kind, query: make(depth - 1) };
    return { kind, queries: [make(depth - 1), make(depth - 1)] };
  };
  return make(3);
}

describe("viewerOf", () => {
  it("keeps the sites that agree with the query, as the oracle tells, for 300 random queries", () => {
    const state = stateOf();
    for (let seed = 1; seed <= 300; seed++) {
      const query = randomQuery(seed);
      const expected = [...state.sites.values()].filter((each) => agrees(query, each.tags)).map((each) => each.id);
      expect(viewerOf(state, { query, order: { kind: "title" } }).rows.map((row) => row.site), `seed ${seed}`).toEqual(expected);
    }
  });

  it("orders by the rating of one ladder, and puts the sites that the ladder does not have last", () => {
    const state = stateOf();
    const result = viewerOf(state, { query: { kind: "all" }, order: { kind: "rating", scopes: [news] } });
    expect(result.rows.map((row) => row.site)).toEqual(["a", "b", "c", "d", "e"]);
    const ladder = new Map(ladderOf(state, news).ratings.map((rating) => [rating.site, rating]));
    expect(result.rows[0]).toEqual({ site: "a", score: ladder.get("a")?.rating, se: ladder.get("a")?.se, ladders: 1 });
    expect(result.rows[2]).toEqual({ site: "c", score: undefined, se: undefined, ladders: 0 });
    expect(result.total).toBe(5);
  });

  it("gives the mean over a set of ladders, and the standard error of the mean", () => {
    const state = stateOf();
    const result = viewerOf(state, { query: { kind: "all" }, order: { kind: "rating", scopes: [news, fun] } });
    const [n, f] = [news, fun].map((scope) => new Map(ladderOf(state, scope).ratings.map((rating) => [rating.site, rating])));
    const b = result.rows.find((row) => row.site === "b");
    const [nb, fb] = [n?.get("b"), f?.get("b")];
    expect(b?.ladders).toBe(2);
    expect(b?.score).toBeCloseTo(((nb?.rating ?? 0) + (fb?.rating ?? 0)) / 2, 9);
    expect(b?.se).toBeCloseTo(Math.sqrt((nb?.se ?? 0) ** 2 + (fb?.se ?? 0) ** 2) / 2, 9);
    // a and c each win their only ladder, and b loses both, so b comes after them
    expect(result.rows.map((row) => row.site).slice(0, 3)).toEqual(["a", "c", "b"]);
  });

  it("orders by the title, and by the date of the add with the newest first", () => {
    const state = stateOf();
    expect(viewerOf(state, { query: { kind: "all" }, order: { kind: "added" } }).rows.map((row) => row.site)).toEqual(["e", "d", "c", "b", "a"]);
  });
});

describe("the mix of an order by rating", () => {
  const ids = (state: ReturnType<typeof stateOf>, input: Parameters<typeof viewerOf>[1]) => viewerOf(state, input).rows.map((row) => row.site);
  const all: TagQuery = { kind: "all" };

  it("keeps the strict order at the temperature 0, and gives the same order for the same seed", () => {
    const state = stateOf();
    const strict = ids(state, { query: all, order: { kind: "rating", scopes: [news, fun] } });
    expect(ids(state, { query: all, order: { kind: "rating", scopes: [news, fun], mix: { temperature: 0, seed: 7 } } })).toEqual(strict);
    for (let seed = 1; seed <= 20; seed++) {
      const order = { kind: "rating", scopes: [news, fun], mix: { temperature: 2, seed } } as const;
      expect(ids(state, { query: all, order })).toEqual(ids(state, { query: all, order }));
      // d and e have no rating in these ladders, so they stay last, in the order of the state
      expect(ids(state, { query: all, order }).slice(3)).toEqual(["d", "e"]);
    }
  });

  it("puts a site first with a chance in proportion to its strength at the temperature 1", () => {
    const state = stateOf();
    const ladder = new Map(ladderOf(state, news).ratings.map((rating) => [rating.site, rating.rating]));
    const [a, b] = [ladder.get("a") ?? 0, ladder.get("b") ?? 0];
    // The strength of Bradley-Terry: a rating difference of 400 is a factor of 10
    const expected = 1 / (1 + 10 ** ((b - a) / 400));
    const n = 4000;
    let first = 0;
    for (let seed = 1; seed <= n; seed++) if (ids(state, { query: all, order: { kind: "rating", scopes: [news], mix: { temperature: 1, seed } } })[0] === "a") first++;
    // The bound is about 5 standard errors of a proportion
    expect(Math.abs(first / n - expected)).toBeLessThan(5 * Math.sqrt((expected * (1 - expected)) / n));
    // A high temperature gives each order of two sites about the same chance
    let hot = 0;
    for (let seed = 1; seed <= n; seed++) if (ids(state, { query: all, order: { kind: "rating", scopes: [news], mix: { temperature: 100, seed } } })[0] === "a") hot++;
    expect(Math.abs(hot / n - 0.5)).toBeLessThan(0.05);
  });

  it("keeps the order of the other sites when the query removes a site", () => {
    const state = stateOf();
    // a has News and c has Fun, but b has the two tags
    const tag = (id: string): TagQuery => ({ kind: "tag", tag: id });
    const notB: TagQuery = { kind: "or", queries: [{ kind: "and", queries: [tag("news"), { kind: "not", query: tag("fun") }] }, { kind: "and", queries: [tag("fun"), { kind: "not", query: tag("news") }] }] };
    for (let seed = 1; seed <= 40; seed++) {
      const order = { kind: "rating", scopes: [news, fun], mix: { temperature: 3, seed } } as const;
      expect(ids(state, { query: notB, order })).toEqual(ids(state, { query: all, order }).filter((id) => id === "a" || id === "c"));
    }
  });
});

describe("pairrank.viewer", () => {
  async function setup() {
    const store = openStore(":memory:");
    let n = 0;
    const call = callerOf(pairrankModule(store, { key: (url) => url, id: () => `id${++n}`, now: () => "2026-11-08T12:00:00Z" }));
    const list = {
      format: "pairrank.sites",
      version: 1,
      source: "test",
      sites: [
        { url: "https://a.example/", title: "Alpha", tags: ["News"] },
        { url: "https://b.example/", title: "Beta", tags: ["News", "Read later"] },
        { url: "https://c.example/", title: "Gamma" },
      ],
    };
    await call(["pairrank", "import", "apply"], { list });
    return { store, call };
  }

  it("reads the text of the query with the names of the tags, and gives the text again", async () => {
    const { call } = await setup();
    const answer = await call<ViewerAnswer>(["pairrank", "viewer"], { query: 'news -"READ LATER"', order: { kind: "title" } });
    expect(answer).toMatchObject({ ok: true, query: 'News and not "Read later"', total: 3 });
    expect(answer.ok && answer.rows.length).toBe(1);
  });

  it("gives the problem of the text, and keeps hidden sites out", async () => {
    const { store, call } = await setup();
    expect(await call<ViewerAnswer>(["pairrank", "viewer"], { query: "news or sport", order: { kind: "title" } })).toEqual({
      ok: false,
      problem: { message: 'No tag has the name "sport".', start: 8, end: 13 },
    });
    const beta = [...store.state.sites.values()].find((each) => each.title === "Beta");
    await call(["pairrank", "apply"], { drafts: [{ type: "site.hidden", site: beta?.id }] });
    const answer = await call<ViewerAnswer>(["pairrank", "viewer"], { query: "", order: { kind: "rating", scopes: [{ kind: "overall" }] } });
    expect(answer.ok && [answer.rows.length, answer.total]).toEqual([2, 2]);
  });

  it("refuses an order that it does not know", async () => {
    const { call } = await setup();
    await expect(call(["pairrank", "viewer"], { query: "", order: { kind: "rating", scopes: [] } })).rejects.toThrow(/from 1 to 100 scopes/);
    await expect(call(["pairrank", "viewer"], { query: "", order: { kind: "random" } })).rejects.toThrow(/The order must be/);
    const overall = [{ kind: "overall" }];
    for (const temperature of [-1, 101, Number.NaN, "1"]) {
      await expect(call(["pairrank", "viewer"], { query: "", order: { kind: "rating", scopes: overall, mix: { temperature, seed: 1 } } })).rejects.toThrow(/from 0 to 100/);
    }
    await expect(call(["pairrank", "viewer"], { query: "", order: { kind: "rating", scopes: overall, mix: { temperature: 1, seed: 1.5 } } })).rejects.toThrow(/must be an integer/);
  });

  it("mixes an order by rating with a seed", async () => {
    const { call } = await setup();
    const answer = await call<ViewerAnswer>(["pairrank", "viewer"], { query: "", order: { kind: "rating", scopes: [{ kind: "overall" }], mix: { temperature: 1, seed: 3 } } });
    expect(answer.ok && answer.rows.length).toBe(3);
  });
});

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
  });
});

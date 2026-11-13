import { pairInformation } from "@mark1russell7/rigor-statistics";
import { type Ask, type Draft, type Scope, type SiteId, type TagQuery, replay, stamp } from "@pairrank/core";
import { ladderOf, ratedOf } from "@pairrank/ratings";
import { describe, expect, it } from "vitest";
import { modePair } from "./modes.ts";

const site = (id: string): Draft => ({ type: "site.added", site: id, url: `https://${id}.example/` });
const news: Scope = { kind: "tag", tag: "news" };
const fun: Scope = { kind: "tag", tag: "fun" };
const has = (tag: string): TagQuery => ({ kind: "tag", tag });
const ALL: TagQuery = { kind: "all" };

/** Five sites: a and b have News, b and c have Fun, d has Later, and e has no tag. Three picks make the ratings. */
function stateOf(more: readonly Draft[] = []) {
  const drafts: Draft[] = [
    ...["a", "b", "c", "d", "e"].map(site),
    ...["news", "fun", "later"].map((tag): Draft => ({ type: "tag.created", tag, name: tag })),
    ...[["a", "news"], ["b", "news"], ["b", "fun"], ["c", "fun"], ["d", "later"]].map(([s, t]): Draft => ({ type: "site.tagged", site: s as string, tag: t as string })),
    { type: "pick", a: "a", b: "b", outcome: "a", scope: news },
    { type: "pick", a: "c", b: "b", outcome: "a", scope: fun },
    { type: "pick", a: "a", b: "c", outcome: "b", scope: { kind: "overall" } },
    ...more,
  ];
  return replay(drafts.map((draft, i) => stamp(draft, `e${i}`, `2026-11-08T10:00:${String(i).padStart(2, "0")}Z`))).state;
}

const sorted = (a: SiteId, b: SiteId) => [a, b].sort().join("");

describe("modePair", () => {
  it("gives only pairs with an ask in common, with the asks of the pair", () => {
    const state = stateOf();
    const asks: Ask[] = [{ kind: "shared" }];
    const seen = new Set<string>();
    for (let seed = 0; seed < 40; seed++) {
      const pair = modePair(state, { pool: ALL, asks }, { seed });
      expect(pair).toBeDefined();
      const key = sorted(pair!.a, pair!.b);
      seen.add(key);
      expect(pair!.asks).toEqual(key === "ab" ? [news] : [fun]);
      expect(modePair(state, { pool: ALL, asks }, { seed })).toEqual(pair);
    }
    expect([...seen].sort()).toEqual(["ab", "bc"]);
  });

  it("gives the sum of the information of each ask as the information of the pair", () => {
    const state = stateOf();
    const pair = modePair(state, { pool: has("news"), asks: [{ kind: "overall" }, { kind: "tag", tag: "news" }] }, { seed: 1 });
    expect(sorted(pair!.a, pair!.b)).toBe("ab");
    expect(pair!.asks).toEqual([{ kind: "overall" }, news]);
    const ratingIn = (scope: Scope, id: SiteId) => ladderOf(state, scope).ratings.find((rating) => rating.site === id)!;
    const sum = [{ kind: "overall" } as Scope, news].reduce((total, scope) => total + pairInformation(ratedOf(ratingIn(scope, pair!.a)), ratedOf(ratingIn(scope, pair!.b))), 0);
    expect(pair!.information).toBeCloseTo(sum, 9);
  });

  it("takes only the shown sites of the pool", () => {
    const state = stateOf();
    for (let seed = 0; seed < 20; seed++) {
      const pair = modePair(state, { pool: { kind: "not", query: has("news") }, asks: [{ kind: "overall" }] }, { seed });
      expect(["c", "d", "e"]).toContain(pair!.a);
      expect(["c", "d", "e"]).toContain(pair!.b);
      expect(pair!.a).not.toBe(pair!.b);
    }
    const hidden = stateOf([{ type: "site.hidden", site: "b" }]);
    expect(modePair(hidden, { pool: ALL, asks: [{ kind: "shared" }] }, { seed: 1 })).toBeUndefined();
  });

  it("gives no pair when the pool has one site, or when no two sites share an ask", () => {
    const state = stateOf();
    expect(modePair(state, { pool: has("later"), asks: [{ kind: "overall" }] }, { seed: 1 })).toBeUndefined();
    expect(modePair(state, { pool: ALL, asks: [{ kind: "tag", tag: "later" }] }, { seed: 1 })).toBeUndefined();
  });

  it("gives a recent pair when the pool has no other pair", () => {
    const state = stateOf();
    const pair = modePair(state, { pool: has("news"), asks: [{ kind: "overall" }] }, { seed: 2, recent: [["a", "b"], ["b", "a"]] });
    expect(sorted(pair!.a, pair!.b)).toBe("ab");
  });
});

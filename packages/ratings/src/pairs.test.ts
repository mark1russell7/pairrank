import { type Event, type Scope, replay } from "@pairrank/core";
import { describe, expect, it } from "vitest";
import { type Ladder, type Rating, ladderOf, pairableOf } from "./ladder.ts";
import { FULL_SEARCH, type PoolSite, START_UNCERTAINTY, choosePair, choosePairWith, informationOf, uncertaintyOf } from "./pairs.ts";

const overall: Scope = { kind: "overall" };

const rating = (site: string, value: number, picks = 0, se?: number): Rating => ({ site, rating: value, se, wins: picks, losses: 0, ties: 0 });

const ladder = (ratings: readonly Rating[]): Ladder => ({
  scope: overall,
  key: "overall",
  model: "elo",
  ratings: [...ratings].sort((x, y) => y.rating - x.rating),
  picks: 0,
  tie: 0,
});

describe("informationOf", () => {
  it("is highest when the result and the two ratings are not sure", () => {
    const fresh = rating("a", 1500);
    expect(uncertaintyOf(fresh)).toBe(START_UNCERTAINTY);
    expect(uncertaintyOf(rating("b", 1500, 3))).toBe(START_UNCERTAINTY / 2);
    expect(uncertaintyOf(rating("c", 1500, 3, 80))).toBe(80);
    // Equal ratings give p = 0.5, so the variance of the result is 0.25
    expect(informationOf(fresh, rating("b", 1500))).toBeCloseTo(0.25 * 2 * START_UNCERTAINTY ** 2, 6);
    expect(informationOf(fresh, rating("b", 1500))).toBeGreaterThan(informationOf(fresh, rating("b", 1900)));
    expect(informationOf(fresh, rating("b", 1500))).toBeGreaterThan(informationOf(fresh, rating("b", 1500, 50)));
  });
});

describe("choosePair", () => {
  it("needs two sites", () => {
    expect(choosePair(ladder([]), [], { seed: 1 })).toBeUndefined();
    expect(choosePair(ladder([rating("a", 1500)]), ["a", "a"], { seed: 1 })).toBeUndefined();
  });

  it("gives the same pair for a seed, and takes only the given sites", () => {
    const sites = ["a", "b", "c", "d", "e"];
    const board = ladder(sites.map((site, index) => rating(site, 1400 + 50 * index, index)));
    const one = choosePair(board, ["a", "b", "c"], { seed: "duel-7" });
    expect(one).toEqual(choosePair(board, ["a", "b", "c"], { seed: "duel-7" }));
    for (let seed = 0; seed < 50; seed++) {
      const pair = choosePair(board, ["a", "b", "c"], { seed })!;
      expect(["a", "b", "c"]).toContain(pair.a);
      expect(["a", "b", "c"]).toContain(pair.b);
      expect(pair.a).not.toBe(pair.b);
    }
  });

  it("gives a rating of 1500 with no picks to a site that the ladder does not have", () => {
    const pair = choosePair(ladder([rating("old", 1500, 40, 30)]), ["old", "new"], { seed: 3 })!;
    expect([pair.a, pair.b].sort()).toEqual(["new", "old"]);
    expect(pair.information).toBeCloseTo(informationOf(rating("old", 1500, 40, 30), rating("new", 1500)), 9);
  });

  it("puts the sites with few picks first, and pairs a site with a near rating", () => {
    // Forty sites with many picks, and two new sites far apart in the ladder
    const many = Array.from({ length: 40 }, (_, index) => rating(`s${index}`, 1000 + 25 * index, 60, 40));
    const board = ladder([...many, rating("low", 1010), rating("high", 1960)]);
    const sites = board.ratings.map((entry) => entry.site);
    let fresh = 0;
    let near = 0;
    const seeds = 300;
    for (let seed = 0; seed < seeds; seed++) {
      const pair = choosePair(board, sites, { seed, candidates: 8 })!;
      const sides = [pair.a, pair.b];
      if (sides.includes("low") || sides.includes("high")) fresh++;
      const [x, y] = sides.map((site) => board.ratings.find((entry) => entry.site === site)!.rating);
      if (Math.abs(x! - y!) <= 200) near++;
    }
    // A new site has a weight of 1 against 1/61 for each old site, so about 75 % of the first sites are new
    expect(fresh / seeds).toBeGreaterThan(0.6);
    expect(near / seeds).toBeGreaterThan(0.9);
  });

  it("puts each site on the left about half of the time", () => {
    const board = ladder([rating("a", 1500), rating("b", 1500)]);
    let left = 0;
    for (let seed = 0; seed < 400; seed++) if (choosePair(board, ["a", "b"], { seed })!.a === "a") left++;
    expect(left).toBeGreaterThan(160);
    expect(left).toBeLessThan(240);
  });

  it("takes a recent pair only when each pair is recent", () => {
    const board = ladder([rating("a", 1500), rating("b", 1500), rating("c", 1500)]);
    const recent = [["a", "b"], ["c", "a"]] as const;
    for (let seed = 0; seed < 40; seed++) {
      const pair = choosePair(board, ["a", "b", "c"], { seed, recent })!;
      expect([pair.a, pair.b].sort()).toEqual(["b", "c"]);
    }
    const all = [...recent, ["b", "c"]] as const;
    expect(choosePair(board, ["a", "b", "c"], { seed: 1, recent: all })).toBeDefined();
  });
});

describe("choosePairWith", () => {
  const pool = (n: number): PoolSite[] => Array.from({ length: n }, (_, i) => ({ site: `s${i}`, rating: 1500 + i, picks: 0 }));
  // Two groups: the even sites and the odd sites. A pair is allowed only inside a group
  const sameGroup = (a: string, b: string): number | undefined => (Number(a.slice(1)) % 2 === Number(b.slice(1)) % 2 ? 1 : undefined);

  it("gives only allowed pairs, in a small pool and in a large pool", () => {
    for (const size of [5, FULL_SEARCH + 40]) {
      for (let seed = 0; seed < 200; seed++) {
        const pair = choosePairWith(pool(size), { seed, information: sameGroup });
        expect(pair).toBeDefined();
        expect(sameGroup(pair!.a, pair!.b)).toBe(1);
      }
    }
  });

  it("leaves out a site with no allowed pair, and gives nothing when no pair is allowed", () => {
    // Only s0 and s1 make a pair. Each other site has no allowed pair, so the draw goes on to s0 or s1
    const only = (a: string, b: string) => ([a, b].sort().join() === "s0,s1" ? 1 : undefined);
    for (let seed = 0; seed < 100; seed++) expect([choosePairWith(pool(30), { seed, information: only })].map((pair) => [pair!.a, pair!.b].sort().join())).toEqual(["s0,s1"]);
    expect(choosePairWith(pool(30), { seed: 1, information: () => undefined })).toBeUndefined();
  });

  it("takes the pair with the most information, and a recent pair only when each allowed pair is recent", () => {
    const most = (a: string, b: string) => ([a, b].sort().join() === "s1,s2" ? 10 : 1);
    for (let seed = 0; seed < 50; seed++) {
      const pair = choosePairWith(pool(3), { seed, information: most });
      if ([pair!.a, pair!.b].includes("s0")) continue;
      expect([pair!.a, pair!.b].sort()).toEqual(["s1", "s2"]);
    }
    const recent = [["s0", "s2"]] as const;
    for (let seed = 0; seed < 50; seed++) {
      const pair = choosePairWith(pool(4), { seed, recent, information: sameGroup });
      expect([pair!.a, pair!.b].sort()).toEqual(["s1", "s3"]);
    }
  });
});

describe("pairableOf", () => {
  it("leaves out the hidden sites, and the sites with no tag of a tag scope", () => {
    let n = 0;
    const e = (draft: Record<string, unknown>): Event => ({ id: `e${++n}`, at: "2026-11-08T12:00:00Z", ...draft }) as Event;
    const { state } = replay([
      e({ type: "site.added", site: "a", url: "https://a.example/" }),
      e({ type: "site.added", site: "b", url: "https://b.example/" }),
      e({ type: "site.added", site: "c", url: "https://c.example/" }),
      e({ type: "tag.created", tag: "t", name: "T" }),
      e({ type: "site.tagged", site: "a", tag: "t" }),
      e({ type: "site.tagged", site: "c", tag: "t" }),
      e({ type: "site.hidden", site: "c" }),
    ]);
    expect(pairableOf(state, overall)).toEqual(["a", "b"]);
    expect(pairableOf(state, { kind: "tag", tag: "t" })).toEqual(["a"]);
    expect(ladderOf(state, overall).ratings.map((entry) => entry.site).sort()).toEqual(["a", "b"]);
  });
});

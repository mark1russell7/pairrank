import { type Event, type Outcome, type Scope, replay } from "@pairrank/core";
import { describe, expect, it } from "vitest";
import { comparisonsOf, ladderOf, scopesOf } from "./ladder.ts";
import { selectModel } from "./select.ts";

let n = 0;
const at = "2026-11-08T12:00:00Z";
const e = (draft: Record<string, unknown>): Event => ({ id: `e${++n}`, at, ...draft }) as Event;
const site = (id: string): Event => e({ type: "site.added", site: id, url: `https://${id}.example/` });
const overall: Scope = { kind: "overall" };
const pick = (a: string, b: string, outcome: Outcome, scope: Scope = overall): Event => e({ type: "pick", a, b, scope, outcome });

/**
 * The largest relative difference of a standard error of the sparse fit from the dense fit, in the test of 210 sites. The
 * measured difference is 0.031.
 */
const SE_TOLERANCE = 0.05;

/** Three sites with a clear order: `a` beats `b` and `c`, and `b` beats `c`, with some upsets and ties. */
function ordered(rounds: number): Event[] {
  const events = [site("a"), site("b"), site("c")];
  for (let round = 0; round < rounds; round++) {
    events.push(pick("a", "b", round % 4 === 3 ? "b" : "a"));
    events.push(pick("b", "c", round % 5 === 4 ? "tie" : "a"));
    events.push(pick("c", "a", round % 6 === 5 ? "a" : "b"));
  }
  return events;
}

describe("ladderOf", () => {
  it("gives an empty ladder for a scope with no site, with each model", () => {
    const { state } = replay([]);
    for (const model of ["bradley-terry", "elo", "glicko2"] as const) {
      expect(ladderOf(state, overall, { model })).toMatchObject({ key: "overall", model, ratings: [], picks: 0, tie: 0 });
    }
    expect(ladderOf(state, { kind: "tag", tag: "none" }).ratings).toEqual([]);
  });

  it("orders the sites by their picks, with a standard error and the counts", () => {
    const { state } = replay(ordered(10));
    const ladder = ladderOf(state, overall);
    expect(ladder.key).toBe("overall");
    expect(ladder.picks).toBe(30);
    expect(ladder.ratings.map((rating) => rating.site)).toEqual(["a", "b", "c"]);
    const a = ladder.ratings[0];
    expect(a?.wins).toBe(8 + 9);
    expect(a?.losses).toBe(2 + 1);
    expect(a?.se).toBeGreaterThan(0);
    expect(ladder.tie).toBeGreaterThan(0);
  });

  it("gives the center and the prior error to sites with no picks", () => {
    const { state } = replay([site("a"), site("b")]);
    const ladder = ladderOf(state, overall);
    for (const rating of ladder.ratings) {
      expect(rating.rating).toBeCloseTo(1500, 6);
      expect(rating.se).toBeCloseTo(400 / Math.LN10, 6);
    }
  });

  it("uses only the picks and the sites of a tag in the ladder of the tag", () => {
    const events = [
      site("a"),
      site("b"),
      site("c"),
      site("d"),
      e({ type: "tag.created", tag: "t", name: "News" }),
      e({ type: "site.tagged", site: "a", tag: "t" }),
      e({ type: "site.tagged", site: "b", tag: "t" }),
      pick("a", "b", "b", { kind: "tag", tag: "t" }),
      pick("a", "c", "a"),
      e({ type: "site.hidden", site: "d" }),
    ];
    const { state } = replay(events);
    const tag = ladderOf(state, { kind: "tag", tag: "t" });
    expect(tag.ratings.map((rating) => rating.site)).toEqual(["b", "a"]);
    expect(tag.picks).toBe(1);
    // A hidden site with no pick is not in a ladder
    expect(ladderOf(state, overall).ratings.map((rating) => rating.site)).toEqual(["a", "b", "c"]);
    expect(scopesOf(state).map((scope) => (scope.kind === "tag" ? scope.tag : "overall"))).toEqual(["overall", "t"]);
  });

  it("gives the same order with each model", () => {
    const { state } = replay(ordered(10));
    for (const model of ["elo", "glicko2"] as const) {
      const ladder = ladderOf(state, overall, { model });
      expect(ladder.model).toBe(model);
      expect(ladder.ratings.map((rating) => rating.site)).toEqual(["a", "b", "c"]);
    }
    expect(ladderOf(state, overall, { model: "elo" }).ratings[0]?.se).toBeUndefined();
    expect(ladderOf(state, overall, { model: "glicko2" }).ratings[0]?.se).toBeLessThan(350);
  });

  it("gives the same ladder for the same log", () => {
    const events = ordered(6);
    expect(ladderOf(replay(events).state, overall)).toEqual(ladderOf(replay(events).state, overall));
  });

  it("fits a scope of more than 200 sites with the sparse fit, near the dense fit", () => {
    const events = Array.from({ length: 210 }, (_, i) => site(`s${i}`));
    for (let i = 0; i < 420; i++) events.push(pick(`s${i % 210}`, `s${(i * 7 + 3) % 210}`, i % 3 === 0 ? "b" : i % 11 === 0 ? "tie" : "a"));
    const { state } = replay(events);
    const sparse = ladderOf(state, overall);
    const dense = new Map(ladderOf(state, overall, { denseLimit: Number.POSITIVE_INFINITY }).ratings.map((rating) => [rating.site, rating]));
    expect(sparse.ratings).toHaveLength(210);
    expect(sparse.picks).toBe(420);
    let gap = 0;
    for (const rating of sparse.ratings) {
      const exact = dense.get(rating.site)!;
      expect(Math.abs(rating.rating - exact.rating)).toBeLessThan(1e-4);
      // The standard errors of the sparse fit are approximate
      expect(Math.abs(rating.se! / exact.se! - 1)).toBeLessThan(SE_TOLERANCE);
      gap = Math.max(gap, Math.abs(rating.se! - exact.se!));
    }
    // The two fits differ, so the option denseLimit gets to the fit
    expect(gap).toBeGreaterThan(0);
  });
});

describe("comparisonsOf", () => {
  it("leaves out a skip, and a pick of a site that the index does not have", () => {
    const { state } = replay([site("a"), site("b"), site("c"), pick("a", "b", "a"), pick("a", "b", "skip"), pick("a", "c", "b")]);
    const index = new Map([
      ["a", 0],
      ["b", 1],
    ]);
    expect(comparisonsOf([...state.picks.values()], index)).toEqual([{ a: 0, b: 1, outcome: "a" }]);
  });
});

describe("selectModel", () => {
  it("chooses Bradley-Terry with no test when the scope has too few picks", () => {
    const { state } = replay(ordered(3));
    expect(selectModel(state, overall)).toEqual({ model: "bradley-terry", scores: [], trained: 9, tested: 0 });
  });

  it("scores each model on the last picks, from the best to the worst", () => {
    const { state } = replay(ordered(20));
    const choice = selectModel(state, overall);
    expect(choice.trained).toBe(48);
    expect(choice.tested).toBe(12);
    expect(choice.scores.map((score) => score.model).sort()).toEqual(["bradley-terry", "elo", "glicko2"]);
    for (const score of choice.scores) {
      expect(Number.isFinite(score.logLoss)).toBe(true);
      // Each model knows the order, so each one is better than a forecast of one third for each outcome
      expect(score.logLoss).toBeLessThan(Math.log(3));
    }
    expect(choice.scores[0]?.model).toBe(choice.model);
    const losses = choice.scores.map((score) => score.logLoss);
    expect([...losses].sort((x, y) => x - y)).toEqual(losses);
  });
});

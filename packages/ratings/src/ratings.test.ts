import { type Event, type Outcome, type Scope, replay } from "@pairrank/core";
import { describe, expect, it } from "vitest";
import { ladderOf, scopesOf } from "./ladder.ts";
import { selectModel } from "./select.ts";

let n = 0;
const at = "2026-11-08T12:00:00Z";
const e = (draft: Record<string, unknown>): Event => ({ id: `e${++n}`, at, ...draft }) as Event;
const site = (id: string): Event => e({ type: "site.added", site: id, url: `https://${id}.example/` });
const overall: Scope = { kind: "overall" };
const pick = (a: string, b: string, outcome: Outcome, scope: Scope = overall): Event => e({ type: "pick", a, b, scope, outcome });

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

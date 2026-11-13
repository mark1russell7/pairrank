import { type Event, type Outcome, type Scope, apply, replay } from "@pairrank/core";
import { ladderOf, selectModel } from "@pairrank/ratings";
import { describe, expect, it } from "vitest";
import { ladderCache } from "./ladders.ts";

let n = 0;
const at = "2026-11-13T12:00:00Z";
const e = (draft: Record<string, unknown>): Event => ({ id: `e${++n}`, at, ...draft }) as Event;
const site = (id: string): Event => e({ type: "site.added", site: id, url: `https://${id}.example/` });
const overall: Scope = { kind: "overall" };
const pick = (a: string, b: string, outcome: Outcome): Event => e({ type: "pick", a, b, scope: overall, outcome });

/** Three sites with a clear order and some upsets: enough picks for a test of the models. */
function ordered(rounds: number): Event[] {
  const events = [site("a"), site("b"), site("c")];
  for (let round = 0; round < rounds; round++) {
    events.push(pick("a", "b", round % 4 === 3 ? "b" : "a"));
    events.push(pick("b", "c", round % 5 === 4 ? "tie" : "a"));
    events.push(pick("c", "a", round % 6 === 5 ? "a" : "b"));
  }
  return events;
}

describe("ladderCache", () => {
  it("gives the ladders and the tests of the ratings package, and fits each one time while the state does not change", () => {
    const { state } = replay(ordered(20));
    const cache = ladderCache();
    expect(cache.ladder(state, overall)).toEqual(ladderOf(state, overall));
    expect(cache.ladder(state, overall, { model: "elo" })).toEqual(ladderOf(state, overall, { model: "elo" }));
    expect(cache.model(state, overall)).toEqual(selectModel(state, overall));
    expect(cache.fits()).toBe(3);
    expect(cache.ladder(state, overall)).toBe(cache.ladder(state, overall));
    expect(cache.ladder(state, overall, { model: "elo" })).toBe(cache.ladder(state, overall, { model: "elo" }));
    cache.model(state, overall);
    expect(cache.fits()).toBe(3);
  });

  it("gives the setting best the ladder of the chosen model, from the cached test", () => {
    const { state } = replay(ordered(20));
    const cache = ladderCache();
    const chosen = cache.model(state, overall).model;
    const best = cache.ladder(state, overall, { model: "best" });
    expect(best).toEqual(ladderOf(state, overall, { model: "best" }));
    expect(best).toBe(cache.ladder(state, overall, { model: chosen }));
    expect(cache.fits()).toBe(2);
  });

  it("fits again after a new event, and for a new state object", () => {
    const { state } = replay(ordered(10));
    const cache = ladderCache();
    const before = cache.ladder(state, overall);
    expect(apply(state, pick("c", "a", "a"))).toBeUndefined();
    const after = cache.ladder(state, overall);
    expect(after).not.toBe(before);
    expect(after.picks).toBe(before.picks + 1);
    expect(after).toEqual(ladderOf(state, overall));
    // A refused event does not change the state, so the ladder stays in the cache
    expect(apply(state, pick("a", "a", "a"))).toBeDefined();
    expect(cache.ladder(state, overall)).toBe(after);
    // The store replays its file into a new state object after a failed write
    const again = replay(ordered(10)).state;
    expect(cache.ladder(again, overall)).not.toBe(before);
    expect(cache.fits()).toBe(3);
  });

  it("keeps a separate ladder for other fit options", () => {
    const { state } = replay(ordered(10));
    const cache = ladderCache();
    const dense = cache.ladder(state, overall, { denseLimit: Number.POSITIVE_INFINITY });
    expect(dense).toEqual(ladderOf(state, overall, { denseLimit: Number.POSITIVE_INFINITY }));
    expect(cache.ladder(state, overall)).not.toBe(dense);
    expect(cache.fits()).toBe(2);
  });

  it("drops the least recent result when it is full", () => {
    const { state } = replay([...ordered(4), e({ type: "tag.created", tag: "t", name: "News" })]);
    const cache = ladderCache(1);
    const tag: Scope = { kind: "tag", tag: "t" };
    cache.ladder(state, overall);
    cache.ladder(state, tag);
    cache.ladder(state, overall);
    expect(cache.fits()).toBe(3);
  });

  it("gives frozen results, so a caller cannot change the cache", () => {
    const { state } = replay(ordered(20));
    const cache = ladderCache();
    const ladder = cache.ladder(state, overall);
    expect(() => (ladder.ratings as unknown[]).push(1)).toThrow(TypeError);
    expect(() => Object.assign(ladder.ratings[0]!, { rating: 0 })).toThrow(TypeError);
    expect(Object.isFrozen(cache.model(state, overall).scores[0])).toBe(true);
  });
});

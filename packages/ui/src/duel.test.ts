import { type Event, replay, stamp } from "@pairrank/core";
import { describe, expect, it } from "vitest";
import { DUEL_KEYS, RECENT_PAIRS, type DuelStep, actionOf, outcomeOf, pickDraft, recentOf, seedOf, undoDraft } from "./duel.ts";
import { APP_KEYS } from "./tagging.ts";

describe("the keys of the duel", () => {
  it("give one action for each key, in each case of a letter", () => {
    expect(actionOf("ArrowLeft")).toBe("left");
    expect(actionOf("2")).toBe("right");
    expect(actionOf("T")).toBe("tie");
    expect(actionOf(" ")).toBe("skip");
    expect(actionOf("h")).toBe("hide");
    expect(actionOf("Backspace")).toBe("undo");
    expect(actionOf("x")).toBeUndefined();
    const keys = Object.values(DUEL_KEYS).flat();
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("keep each letter in the keys that no tag can take", () => {
    for (const key of Object.values(DUEL_KEYS).flat()) if (/^[a-z]$/.test(key)) expect(APP_KEYS.has(key), key).toBe(true);
  });
});

describe("the drafts of the duel", () => {
  it("pick the left site as a, and undo a pick or a hide", () => {
    expect([outcomeOf("left"), outcomeOf("right"), outcomeOf("tie"), outcomeOf("skip")]).toEqual(["a", "b", "tie", "skip"]);
    const pair = { a: "l", b: "r" };
    expect(pickDraft(pair, { kind: "overall" }, "a", "d1")).toEqual({ type: "pick", a: "l", b: "r", scope: { kind: "overall" }, outcome: "a", duel: "d1" });
    expect(undoDraft({ kind: "pick", pair, outcome: "a", event: "e9" })).toEqual({ type: "pick.undone", pick: "e9" });
    expect(undoDraft({ kind: "hide", pair, site: "r" })).toEqual({ type: "site.restored", site: "r" });
  });

  it("agree with the rules of the state", () => {
    let n = 0;
    const event = (draft: Parameters<typeof stamp>[0]): Event => stamp(draft, `e${++n}`, "2026-11-08T12:00:00Z");
    const pair = { a: "l", b: "r" };
    const pick = event(pickDraft(pair, { kind: "overall" }, "b", "d1"));
    const { state, problems } = replay([
      event({ type: "site.added", site: "l", url: "https://l.example/" }),
      event({ type: "site.added", site: "r", url: "https://r.example/" }),
      pick,
      event(undoDraft({ kind: "pick", pair, outcome: "b", event: pick.id })),
      event({ type: "site.hidden", site: "r", reason: "Hidden in a duel." }),
      event(undoDraft({ kind: "hide", pair, site: "r" })),
    ]);
    expect(problems).toEqual([]);
    expect(state.picks.size).toBe(0);
    expect(state.sites.get("r")?.hidden).toBe(false);
  });

  it("give the last pairs with the pair on the screen, and a seed for each round", () => {
    const steps: DuelStep[] = Array.from({ length: 30 }, (_, i) => ({ kind: "pick", pair: { a: `a${i}`, b: `b${i}` }, outcome: "a", event: `e${i}` }));
    const recent = recentOf(steps, { a: "x", b: "y" });
    expect(recent).toHaveLength(RECENT_PAIRS);
    expect(recent.at(-1)).toEqual(["x", "y"]);
    expect(recent[0]).toEqual(["a11", "b11"]);
    expect(recentOf([])).toEqual([]);
    expect(seedOf("d1", 3)).toBe("d1:3");
  });
});

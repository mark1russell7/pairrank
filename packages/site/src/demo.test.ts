import { describe, expect, it } from "vitest";
import { MODELS, SAMPLE_SITES, act, agreementOf, createDemo, ladderOfDemo, rowsOf, setModel, siteOf, tasteAction, tastePicks } from "./demo.ts";

const ratingOf = (demo: ReturnType<typeof createDemo>, id: string): number | undefined =>
  rowsOf(ladderOfDemo(demo)).find((row) => row.site.id === id)?.rating;

describe("the demo", () => {
  it("starts with the eight sample sites, no picks and a pair of two sites", () => {
    const demo = createDemo();
    expect(demo.state.sites.size).toBe(SAMPLE_SITES.length);
    expect(demo.steps).toEqual([]);
    expect(demo.pair).toBeDefined();
    expect(demo.pair?.a).not.toBe(demo.pair?.b);
    const rows = rowsOf(ladderOfDemo(demo));
    expect(rows.map((row) => row.site.id).sort()).toEqual(SAMPLE_SITES.map((site) => site.id).sort());
    expect(rows.every((row) => row.rating === 1500)).toBe(true);
    expect(rows.map((row) => row.place)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("uses only hosts of the domain example", () => {
    for (const site of SAMPLE_SITES) expect(site.host).toMatch(/^[a-z-]+\.example$/);
    for (const site of createDemo().state.sites.values()) expect(new URL(site.url).hostname.endsWith(".example")).toBe(true);
  });

  it("puts the winner of a pick above the loser", () => {
    const demo = createDemo();
    const pair = demo.pair;
    if (pair === undefined) throw new Error("no pair");
    expect(act(demo, "right")).toBe(true);
    expect(ratingOf(demo, pair.b)).toBeGreaterThan(ratingOf(demo, pair.a) ?? Infinity);
    expect(rowsOf(ladderOfDemo(demo))[0]?.site.id).toBe(pair.b);
    expect(demo.steps).toHaveLength(1);
  });

  it("removes the last pick with an undo, and shows its pair again", () => {
    const demo = createDemo();
    act(demo, "left");
    const pair = demo.pair;
    act(demo, "left");
    expect(act(demo, "undo")).toBe(true);
    expect(demo.pair).toEqual(pair);
    expect(demo.steps).toHaveLength(1);
    expect(act(demo, "undo")).toBe(true);
    expect(rowsOf(ladderOfDemo(demo)).every((row) => row.rating === 1500)).toBe(true);
    expect(act(demo, "undo")).toBe(false);
  });

  it("keeps the ratings at a skip, and does nothing at a hide", () => {
    const demo = createDemo();
    expect(act(demo, "skip")).toBe(true);
    expect(ladderOfDemo(demo).picks).toBe(0);
    expect(demo.steps).toHaveLength(1);
    expect(act(demo, "hide")).toBe(false);
    expect(demo.steps).toHaveLength(1);
  });

  it("gives the same pairs again for the same seed and the same picks", () => {
    const pairs = (seed: string): unknown[] => {
      const demo = createDemo(seed);
      const seen: unknown[] = [];
      for (let pick = 0; pick < 12; pick++) {
        seen.push(demo.pair);
        act(demo, pick % 3 === 0 ? "tie" : "left");
      }
      return seen;
    };
    expect(pairs("one")).toEqual(pairs("one"));
  });

  it("does not show the same pair twice in a row", () => {
    const demo = createDemo();
    for (let pick = 0; pick < 30; pick++) {
      const pair = demo.pair;
      act(demo, "left");
      expect(demo.pair).not.toEqual(pair);
    }
  });

  it("keeps the picks at a change of the model", () => {
    const demo = createDemo();
    tastePicks(demo, 12);
    for (const { model } of MODELS) {
      setModel(demo, model);
      const ladder = ladderOfDemo(demo);
      expect(ladder.model).toBe(model);
      expect(ladder.picks).toBe(12);
    }
  });

  it("lets the hidden taste pick the same sides again for the same seed", () => {
    const a = createDemo("taste");
    const b = createDemo("taste");
    expect(tastePicks(a, 20)).toBe(20);
    tastePicks(b, 20);
    expect(a.steps.map((step) => step.kind === "pick" && step.outcome)).toEqual(b.steps.map((step) => step.kind === "pick" && step.outcome));
    expect(tasteAction(a)).toBe(tasteAction(b));
  });

  it("finds most of the order of the hidden taste after many picks", () => {
    const demo = createDemo();
    expect(agreementOf(ladderOfDemo(demo))).toBeUndefined();
    tastePicks(demo, 120);
    for (const { model } of MODELS) {
      setModel(demo, model);
      expect(agreementOf(ladderOfDemo(demo))).toBeGreaterThan(0.4);
    }
  });

  it("gives the sample site of an id, and throws for another id", () => {
    expect(siteOf("tea").title).toBe("Tea timer");
    expect(() => siteOf("nothing")).toThrow("The demo has no site nothing.");
  });
});

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { median } from "@mark1russell7/rigor-statistics";
import { ladderOf } from "@pairrank/ratings";
import { describe, expect, it } from "vitest";
import { APP_RECENT, type DuelResult, OVERALL, RULES, type ShownPair, chooseRandom, chooseWithoutFullSearch, duel, siteOf, sitesState, tasteOf } from "./duel.ts";
import { MIN_SEEDS, PAIR_GATES, type PairGate, SWEEP_JOBS, failsGate, gateVerdict, jobFile, limitOf, sweepReport } from "./gate.ts";

const SMALL = 12;

describe("the duel", () => {
  it("gives the same taste and the same count again for a seed, and another taste for another seed", () => {
    expect(tasteOf(SMALL, 1)).toEqual(tasteOf(SMALL, 1));
    expect(tasteOf(SMALL, 2)).not.toEqual(tasteOf(SMALL, 1));
    const first = duel({ sites: SMALL, seed: 1, rule: "app" });
    const second = duel({ sites: SMALL, seed: 1, rule: "app" });
    expect({ ...second, chooseMs: 0, fitMs: 0 }).toEqual({ ...first, chooseMs: 0, fitMs: 0 });
    expect(first.picks).not.toBeNull();
    expect(first.tau).toBeGreaterThanOrEqual(first.target);
  });

  it("starts with sites of the domain example and no picks", () => {
    const state = sitesState(3);
    expect([...state.sites.values()].map((site) => site.url)).toEqual(["https://s0.example/", "https://s1.example/", "https://s2.example/"]);
    expect(state.picks.size).toBe(0);
  });

  it("stops at the cap with no count when the target is out of reach", () => {
    const result = duel({ sites: SMALL, seed: 1, rule: "random" }, { target: 1.1, cap: 30 });
    expect(result.picks).toBeNull();
    expect(result.cap).toBe(30);
  });

  it("probes the dense fit, which is the fit of the ladder under 200 sites, so the pairs agree", () => {
    const result = duel({ sites: SMALL, seed: 3, rule: "app" }, { probeEvery: 10 });
    expect(result.dense.length).toBeGreaterThan(0);
    for (const probe of result.dense) {
      expect(probe.same).toBe(true);
      expect(probe.information).toBeCloseTo(1, 10);
      expect(probe.se).toBeCloseTo(1, 10);
    }
  });

  it("plays each rule to the target on a small list", () => {
    for (const rule of Object.keys(RULES) as (keyof typeof RULES)[]) {
      const result = duel({ sites: SMALL, seed: 2, rule });
      expect(result.picks, rule).not.toBeNull();
    }
  });
});

describe("the rules", () => {
  const state = sitesState(4);
  const ladder = ladderOf(state, OVERALL);
  const sites = [0, 1, 2, 3].map(siteOf);
  // Each pair is recent, but the pair of s2 and s3.
  const recent: ShownPair[] = [
    ["s0", "s1"],
    ["s0", "s2"],
    ["s0", "s3"],
    ["s1", "s2"],
    ["s1", "s3"],
  ];
  const key = (pair: { a: string; b: string }): string => [pair.a, pair.b].sort().join(" ");
  const seeds = Array.from({ length: 40 }, (_, i) => `seed-${String(i)}`);

  it("gives the one fresh pair with the full search of the app", () => {
    for (const seed of seeds) expect(key(RULES.app.choose({ ladder, sites, seed, recent })!)).toBe("s2 s3");
  });

  it("gives a recent pair at times with no full search, and never a filler", () => {
    const pairs = seeds.map((seed) => chooseWithoutFullSearch({ ladder, sites, seed, recent })!);
    for (const pair of pairs) expect(sites).toEqual(expect.arrayContaining([pair.a, pair.b]));
    expect(pairs.some((pair) => key(pair) !== "s2 s3")).toBe(true);
  });

  it("gives a random pair of two different sites, and no pair for one site", () => {
    for (const seed of seeds) {
      const pair = chooseRandom({ ladder, sites, seed, recent: [] })!;
      expect(pair.a).not.toBe(pair.b);
    }
    expect(chooseRandom({ ladder, sites: ["s0"], seed: "one", recent: [] })).toBeUndefined();
  });

  it("avoids the last pairs of the app window", () => {
    expect(RULES.app.recent).toBe(APP_RECENT);
    expect(RULES["no recent"].recent).toBe(0);
    expect(RULES["dense fit"].ladder.denseLimit).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("the gate", () => {
  const gate: PairGate = { rule: "app", sites: 10, seeds: [1, 2, 3, 4, 5], basis: [100, 120, 110, 130, 90], where: "test", from: "a test" };
  const result = (seed: number, picks: number | null, cap = 1000): DuelResult => ({
    sites: 10,
    seed,
    rule: "app",
    picks,
    cap,
    target: 0.8,
    tau: 0.8,
    repeats: 0,
    chooseMs: 0,
    fitMs: 0,
    dense: [],
  });

  it("sets the limit to the worst count plus the spread of the counts", () => {
    expect(limitOf([100, 120, 110, 130, 90])).toBe(170);
    expect(() => limitOf([1, 2, 3])).toThrow(RangeError);
  });

  it("gives within, beyond, no read and open", () => {
    const within = gateVerdict(gate, [1, 2, 3, 4, 5].map((seed) => result(seed, 150)));
    expect(within.outcome).toBe("within");
    expect(within.limit).toBe(170);
    expect(failsGate(within)).toBe(false);

    const beyond = gateVerdict(gate, [1, 2, 3, 4, 5].map((seed) => result(seed, seed === 4 ? 171 : 150)));
    expect(beyond.outcome).toBe("beyond");
    expect(failsGate(beyond)).toBe(true);

    const capped = gateVerdict(gate, [1, 2, 3, 4, 5].map((seed) => result(seed, seed === 2 ? null : 150)));
    expect(capped.outcome).toBe("beyond");

    const missing = gateVerdict(gate, [1, 2, 3, 4].map((seed) => result(seed, 150)));
    expect(missing.outcome).toBe("no read");
    expect(failsGate(missing)).toBe(true);

    const low = gateVerdict(gate, [1, 2, 3, 4, 5].map((seed) => result(seed, seed === 5 ? null : 150, 160)));
    expect(low.outcome).toBe("no read");

    const open = gateVerdict({ ...gate, basis: undefined }, [1, 2, 3, 4, 5].map((seed) => result(seed, 150)));
    expect(open.outcome).toBe("open");
    expect(failsGate(open)).toBe(false);
  });

  it("has 5 seeds or more in each gated case, and a basis for each seed", () => {
    for (const item of PAIR_GATES) {
      expect(item.seeds.length).toBeGreaterThanOrEqual(MIN_SEEDS);
      if (item.basis !== undefined) expect(item.basis.length).toBe(item.seeds.length);
    }
  });

  it("holds the rule of the app at 20 sites", () => {
    const item = PAIR_GATES.find((entry) => entry.where === "test")!;
    const results = item.seeds.map((seed) => duel({ sites: item.sites, seed, rule: item.rule }));
    const verdict = gateVerdict(item, results);
    expect(verdict.outcome, verdict.reason).toBe(item.basis === undefined ? "open" : "within");
    const random = item.seeds.map((seed) => duel({ sites: item.sites, seed, rule: "random" }));
    const counts = (list: readonly DuelResult[]): number[] => list.map((entry) => entry.picks ?? entry.cap);
    expect(median(counts(results))).toBeLessThan(median(counts(random)));
  });
});

describe("the sweep", () => {
  it("has a job in the workflow for each job of the sweep", () => {
    const workflow = readFileSync(fileURLToPath(new URL("../../../../../.github/workflows/pair-bench.yml", import.meta.url)), "utf8");
    const lines = workflow.split(/\r?\n/).map((line) => line.trim());
    for (const job of SWEEP_JOBS) expect(lines).toContain(`- ${jobFile(job).replace(/\.json$/, "")}`);
  });

  it("gives a report with each rule, the dense probes, the work of a full search and the gate", () => {
    const results = [duel({ sites: SMALL, seed: 1, rule: "app" }, { probeEvery: 20 }), duel({ sites: SMALL, seed: 1, rule: "random" })];
    const gate: PairGate = { rule: "app", sites: SMALL, seeds: [1, 2, 3, 4, 5], basis: undefined, where: "workflow", from: "a test" };
    const report = sweepReport([{ job: "small", commit: "abc", at: "2026-11-14T00:00:00.000Z", node: "v26.0.0", results, fullSearch: [{ sites: 8, us: 1.5 }] }], [gateVerdict(gate, results)]);
    expect(report).toContain(`| ${String(SMALL)} | app | 1 |`);
    expect(report).toContain(`| ${String(SMALL)} | random | 1 |`);
    expect(report).toContain("### The sparse fit and the dense fit");
    expect(report).toContain("| 8 | 1.5 |");
    expect(report).toContain(`| ${String(SMALL)} | app | 5 | none | none | no read |`);
  });
});

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkLadder, ladderVerdict } from "@mark1russell7/rigor-bench";
import type { FreshRecord, FreshRun } from "@mark1russell7/rigor-bench/fresh";
import { openStore } from "@pairrank/store";
import { afterAll, describe, expect, it } from "vitest";
import { AA_PAIR, benchReport, rungRecord } from "./record.ts";
import { MEASURES, type RungSize, SCALE_LADDER, SCALE_RUNGS, type ScaleRung, scaleLog } from "./scale.ts";
import { timeStep } from "./steps.ts";

const SMALL: RungSize = { sites: 30, picks: 200, tags: 3 };

describe("the scale ladder", () => {
  it("has no problems for rigor-bench", () => {
    expect(checkLadder(SCALE_LADDER)).toEqual([]);
  });

  it("has a budget for each measure of each rung, with a noise limit of a quarter of the limit", () => {
    for (const rung of SCALE_LADDER.rungs) {
      expect(rung.budgets.map((budget) => budget.measure)).toEqual([...MEASURES]);
      for (const budget of rung.budgets) if (budget.kind === "median") expect(budget.maxDifference).toBe(budget.limit / 4);
    }
  });
});

describe("scaleLog", () => {
  it("gives the same log for the same size and seed, and another log for another seed", () => {
    expect(scaleLog(SMALL)).toEqual(scaleLog(SMALL));
    expect(scaleLog(SMALL, "other")).not.toEqual(scaleLog(SMALL));
  });

  it("gives a log that the store accepts, with each site, tag and pick of the size", () => {
    const store = openStore(":memory:");
    expect(store.appendAll(scaleLog(SMALL))).toEqual([]);
    expect(store.state.sites.size).toBe(SMALL.sites);
    expect(store.state.tags.size).toBe(SMALL.tags);
    expect(store.state.picks.size).toBe(SMALL.picks);
    for (const site of store.state.sites.values()) expect(site.tags.size).toBeGreaterThanOrEqual(1);
    store.close();
  });

  it("gives only pairs of two different sites, with each outcome", () => {
    const picks = scaleLog(SMALL).filter((event) => event.type === "pick");
    for (const pick of picks) expect(pick.a).not.toBe(pick.b);
    expect(new Set(picks.map((pick) => pick.outcome))).toEqual(new Set(["a", "b", "tie", "skip"]));
  });
});

describe("timeStep", () => {
  const folder = mkdtempSync(join(tmpdir(), "pairrank-bench-test-"));
  const base = join(folder, "base.sqlite");
  const store = openStore(base);
  store.appendAll(scaleLog(SMALL));
  store.close();
  afterAll(() => rmSync(folder, { recursive: true, force: true }));

  it.each(MEASURES.map((measure) => [measure]))("times the step %s, with the same hash in each run, and does not change the base file", async (measure) => {
    const first = await timeStep(measure, base);
    const second = await timeStep(measure, base);
    expect(first.ms).toBeGreaterThan(0);
    expect(second.hash).toBe(first.hash);
    const again = openStore(base);
    expect(again.state.picks.size).toBe(SMALL.picks);
    again.close();
  });
});

describe("rungRecord and benchReport", () => {
  const rung: ScaleRung = SCALE_RUNGS[0]!;
  const env = { cpu: "a test CPU", cores: 2, os: "linux", arch: "x64", node: "v26.0.0" };
  const runOf = (ms: number): FreshRun => {
    const records: FreshRecord[] = [];
    for (const measure of MEASURES) for (let round = 0; round < 12; round++) records.push({ case: measure, round, first: round % 2 === 0 ? "a" : "b", a: ms, b: ms + 1, job: "100", env });
    return { env, job: "100", pairs: { [AA_PAIR]: records }, skipped: [] };
  };
  const stamp = { commit: "abc", at: "2026-11-14T00:00:00.000Z" };

  it("gives the rounds from arm a and the A/A arm from arm b, for each measure", () => {
    const record = rungRecord(rung, runOf(5), stamp);
    expect(record.rung).toBe(rung.name);
    expect(record.evidence.map((item) => item.measure)).toEqual([...MEASURES]);
    for (const item of record.evidence) {
      if (item.kind !== "median") throw new Error("The evidence is not a median.");
      expect(item.rounds.map((round) => round.value)).toEqual(Array(12).fill(5));
      expect(item.aa.map((round) => round.value)).toEqual(Array(12).fill(6));
    }
  });

  it("gives a verdict within for fast steps and beyond for slow steps, and the report tells it", () => {
    const now = { now: "2026-11-14T01:00:00.000Z" };
    const fast = ladderVerdict(SCALE_LADDER, [rungRecord(rung, runOf(5), stamp)], now);
    expect(fast.rungs[0]!.outcome).toBe("within");
    expect(fast.held).toBe(rung.name);
    const slow = ladderVerdict(SCALE_LADDER, [rungRecord(rung, runOf(5000), stamp)], now);
    expect(slow.rungs[0]!.outcome).toBe("beyond");
    const report = benchReport(slow, [{ record: rungRecord(rung, runOf(5000), stamp), run: runOf(5000) }]);
    expect(report).toContain(`| ${rung.name} | open | start | 5000.0 ms | 5001.0 ms | beyond |`);
    expect(report).toContain("a test CPU");
  });
});

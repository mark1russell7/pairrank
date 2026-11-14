/**
 * The records and the report of the scale bench. A run of one rung gives a `RungRecord` of `@mark1russell7/rigor-bench`.
 * The verdict of the ladder reads the records of all rungs.
 */
import type { LadderVerdict, RungRecord } from "@mark1russell7/rigor-bench";
import type { FreshRun } from "@mark1russell7/rigor-bench/fresh";
import { MEASURES, type ScaleRung } from "./scale.ts";

/** The id of the arm of the bench. The two arms of its A/A pair run the same build. */
export const BENCH_ARM = "host";

/** The id of the A/A pair of a fresh run. */
export const AA_PAIR = `${BENCH_ARM}~aa`;

/** The parts of a run that are real. */
export const REAL: readonly string[] = [
  "the procedures of the host, called in its process",
  "a SQLite file on the disk of the runner",
  "a fresh Node.js process for each step",
];

/** The parts of a run that the bench makes up. */
export function syntheticOf(rung: ScaleRung): string[] {
  const { sites, picks, tags } = rung.size;
  return [`${String(sites)} sites with ${String(tags)} tags, and ${String(picks)} overall picks of a seeded hidden taste`, "a fixed clock and fixed ids"];
}

/** The commit and the time of a run. */
export interface RunStamp {
  readonly commit: string;
  readonly at: string;
}

/**
 * This function gives the record of one rung from a fresh run. Each measure is one case of the run. Arm `a` of the
 * A/A pair gives the rounds, and arm `b` gives the A/A arm. A skipped case gives no rounds, so its budget cannot decide.
 */
export function rungRecord(rung: ScaleRung, run: FreshRun, stamp: RunStamp): RungRecord {
  const pair = run.pairs[AA_PAIR] ?? [];
  return {
    rung: rung.name,
    commit: stamp.commit,
    at: stamp.at,
    real: [...REAL],
    synthetic: syntheticOf(rung),
    evidence: MEASURES.map((measure) => {
      const rounds = pair.filter((record) => record.case === measure);
      return {
        kind: "median" as const,
        measure,
        rounds: rounds.map((record) => ({ case: measure, round: record.round, value: record.a })),
        aa: rounds.map((record) => ({ case: measure, round: record.round, value: record.b })),
      };
    }),
  };
}

/** The output of the run of one rung: its record, and the fresh run with each raw time. */
export interface RungOutput {
  readonly record: RungRecord;
  readonly run: FreshRun;
}

/** This function gives the median of a list of numbers, or `undefined` for an empty list. */
function median(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((x, y) => x - y);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/** This function gives a time in milliseconds as text, or a dash when there is no time. */
function msText(value: number | undefined): string {
  return value === undefined ? "–" : `${value.toFixed(1)} ms`;
}

/**
 * This function gives the report of a verdict in Markdown, for the summary of the workflow. It has one row for each
 * rung and measure, with the median of each arm, the limit and the outcome. A list of the reasons follows.
 */
export function benchReport(verdict: LadderVerdict, outputs: readonly RungOutput[]): string {
  const lines = [
    `## The scale ladder of ${verdict.subject}`,
    "",
    verdict.failed ? `**Failed.** ${verdict.reason}` : `**Passed.** ${verdict.reason}`,
    "",
    `The highest rung that holds: ${verdict.held ?? "none"}. The next rung: ${verdict.next ?? "none"}.`,
    "",
    "| Rung | Gate | Measure | Median | A/A median | Outcome |",
    "| --- | --- | --- | --- | --- | --- |",
  ];
  for (const rung of verdict.rungs) {
    const output = outputs.find((item) => item.record.rung === rung.rung);
    for (const budget of rung.budgets) {
      const evidence = output?.record.evidence.find((item) => item.measure === budget.measure);
      const rounds = evidence?.kind === "median" ? evidence.rounds.map((round) => round.value) : [];
      const aa = evidence?.kind === "median" ? evidence.aa.map((round) => round.value) : [];
      lines.push(`| ${rung.rung} | ${rung.locked ? "locked" : "open"} | ${budget.measure} | ${msText(median(rounds))} | ${msText(median(aa))} | ${budget.outcome} |`);
    }
  }
  lines.push("", "### The reasons", "");
  for (const rung of verdict.rungs) for (const budget of rung.budgets) lines.push(`- ${rung.rung}, ${budget.measure}: ${budget.reason}`);
  const skips = outputs.flatMap((output) => output.run.skipped.map((skip) => `- ${output.record.rung}, ${skip.case}: ${skip.reason}`));
  if (skips.length > 0) lines.push("", "### The skipped cases", "", ...skips);
  const envs = outputs.map((output) => `- ${output.record.rung}: ${output.run.env.cpu}, ${String(output.run.env.cores)} cores, ${output.run.env.os}, Node.js ${output.run.env.node}`);
  if (envs.length > 0) lines.push("", "### The computers", "", ...envs);
  return `${lines.join("\n")}\n`;
}

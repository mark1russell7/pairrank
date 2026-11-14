/**
 * The cases, the gate and the report of the pair bench (R31). The workflow `pair-bench.yml` plays each job of
 * `SWEEP_JOBS`, and the verdict reads the results of all jobs.
 *
 * The gate holds the rule `app`, so a later change cannot make the duel slower to learn. The limit of each gated case
 * comes from the counts of earlier duels with the same seeds, by `limitOf`. A count of picks has no noise of time, so
 * the same code gives the same counts again.
 *
 * @packageDocumentation
 */
import { bootstrapMedian, median } from "@mark1russell7/rigor-statistics";
import { CAP_PER_SITE, type DuelResult, RULES, type RuleName, TARGET_TAU } from "./duel.ts";

/** The fewest seeds of a gated case. */
export const MIN_SEEDS = 5;

/** One job of the sweep: a count of sites, the rules, the seeds and the count of answers between two dense probes. */
export interface SweepJob {
  readonly name: string;
  readonly sites: number;
  readonly rules: readonly RuleName[];
  readonly seeds: readonly number[];
  /** The count of answers between two dense probes of the rule `app`, or 0 for no probe. */
  readonly probeEvery: number;
  /** The sizes of a pool for which the job times the work of a full search. */
  readonly costs: readonly number[];
}

/** The seeds 1 to `n`. */
export function seedsTo(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i + 1);
}

/** The sizes of a pool for which the sweep times the work of a full search. `PAIR_FULL_SEARCH` is 64. */
const FULL_SEARCH_COSTS: readonly number[] = [8, 16, 32, 64, 128, 256, 512, 1024];

/** The rules that the full search can change, and their copies with no full search. */
const FULL_SEARCH_RULES: readonly RuleName[] = ["app", "no full search", "candidates 2", "candidates 2, no full search"];

/**
 * The jobs of the sweep in CI. The sizes 50 and 300 are below and above the dense limit of 200 sites of `fitRatings`.
 * The size 20 is the gate of the tests. The small pools of 8 to 64 sites measure the full search of `choosePair`, which
 * only a pool of `PAIR_FULL_SEARCH` sites or fewer has.
 */
export const SWEEP_JOBS: readonly SweepJob[] = [
  { name: "20 sites", sites: 20, rules: ["app", "random"], seeds: seedsTo(8), probeEvery: 0, costs: [] },
  {
    name: "50 sites",
    sites: 50,
    rules: ["app", "candidates 2", "candidates 8", "candidates 64", "no recent", "no full search", "random"],
    seeds: seedsTo(8),
    probeEvery: 0,
    costs: [],
  },
  { name: "300 sites", sites: 300, rules: ["app", "candidates 8", "no recent", "random"], seeds: seedsTo(6), probeEvery: 100, costs: [] },
  { name: "300 sites, dense fit", sites: 300, rules: ["dense fit"], seeds: seedsTo(6), probeEvery: 0, costs: [] },
  ...[8, 16, 32, 64].map(
    (sites): SweepJob => ({ name: `${String(sites)} sites, full search`, sites, rules: FULL_SEARCH_RULES, seeds: seedsTo(8), probeEvery: 0, costs: sites === 8 ? FULL_SEARCH_COSTS : [] }),
  ),
];

/** This function gives the name of the file of a job: its name in lower case, with a hyphen for each other character. */
export function jobFile(job: SweepJob): string {
  return `${job.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.json`;
}

/** One gated case: the rule `app` at a count of sites, with the counts that set its limit. */
export interface PairGate {
  readonly rule: RuleName;
  readonly sites: number;
  readonly seeds: readonly number[];
  /**
   * The count of picks of each seed in the duels that set the limit, in the order of `seeds`. With no counts, the case
   * only reports.
   */
  readonly basis: readonly number[] | undefined;
  /** The check that holds the case first: the tests of `vitest`, or only the verdict of the workflow `pair-bench.yml`. */
  readonly where: "test" | "workflow";
  /** The source of the basis: the test or the workflow run that gave the counts. */
  readonly from: string;
}

/**
 * This function gives the limit of a gated case from the counts of its seeds: the worst count plus the spread of the
 * counts. The spread is the worst count minus the best count. Thus the limit is `max + (max - min)`.
 *
 * A change that keeps the quality of the rule gives new counts in the old range, so it passes. A change that makes the
 * worst seed slower by more than the whole spread of the seeds fails.
 */
export function limitOf(basis: readonly number[]): number {
  if (basis.length < MIN_SEEDS) throw new RangeError(`limitOf: a limit needs ${String(MIN_SEEDS)} counts or more, not ${String(basis.length)}.`);
  const worst = Math.max(...basis);
  return worst + (worst - Math.min(...basis));
}

/**
 * The gated cases. The verdict of the workflow `pair-bench.yml` holds each case. A test of `vitest` also holds the case
 * of 20 sites, so a change fails before the sweep.
 */
export const PAIR_GATES: readonly PairGate[] = [
  { rule: "app", sites: 20, seeds: seedsTo(8), basis: undefined, where: "test", from: "duel.test.ts" },
  { rule: "app", sites: 50, seeds: seedsTo(8), basis: undefined, where: "workflow", from: "pair-bench.yml" },
  { rule: "app", sites: 300, seeds: seedsTo(6), basis: undefined, where: "workflow", from: "pair-bench.yml" },
];

/** The outcome of a gated case. */
export type GateOutcome = "within" | "beyond" | "no read" | "open";

/** The verdict of one gated case. */
export interface GateVerdict {
  readonly gate: PairGate;
  readonly outcome: GateOutcome;
  /** The limit, or `undefined` for an open case. */
  readonly limit: number | undefined;
  /** The worst count of the seeds, or `undefined` when a seed has no count. */
  readonly worst: number | undefined;
  /** The reason of the outcome, in words. */
  readonly reason: string;
}

/**
 * This function gives the verdict of one gated case from the results of the duels.
 *
 * - `no read`: a seed has no result, or a duel got to its cap below the limit. The bench cannot measure the case.
 * - `beyond`: a seed needs more picks than the limit. A duel that gets to its cap at the limit or above is beyond.
 * - `within`: each seed has a count, and the worst count is the limit or less.
 * - `open`: the case has no limit, so it only reports.
 */
export function gateVerdict(gate: PairGate, results: readonly DuelResult[]): GateVerdict {
  const limit = gate.basis === undefined ? undefined : limitOf(gate.basis);
  const of = gate.seeds.map((seed) => results.find((result) => result.rule === gate.rule && result.sites === gate.sites && result.seed === seed));
  const missing = gate.seeds.filter((_, i) => of[i] === undefined);
  const counts = of.flatMap((result) => (result?.picks === null || result === undefined ? [] : [result.picks]));
  const worst = counts.length === gate.seeds.length ? Math.max(...counts) : undefined;
  const verdict = (outcome: GateOutcome, reason: string): GateVerdict => ({ gate, outcome, limit, worst, reason });
  if (missing.length > 0) return verdict("no read", `no result for the seeds ${missing.join(", ")}`);
  const capped = of.filter((result) => result?.picks === null) as DuelResult[];
  if (limit === undefined) return verdict("open", capped.length > 0 ? `${String(capped.length)} seeds got to the cap` : "the case has no limit yet");
  const low = capped.filter((result) => result.cap < limit);
  if (low.length > 0) return verdict("no read", `the seeds ${low.map((result) => result.seed).join(", ")} got to a cap below the limit`);
  if (capped.length > 0) return verdict("beyond", `the seeds ${capped.map((result) => result.seed).join(", ")} got to the cap`);
  const over = of.filter((result) => (result?.picks ?? 0) > limit) as DuelResult[];
  if (over.length > 0) return verdict("beyond", `the seeds ${over.map((result) => `${String(result.seed)} (${String(result.picks)})`).join(", ")} need more picks than the limit`);
  return verdict("within", `the worst seed needs ${String(worst)} picks`);
}

/** This function tells if a verdict fails the check: a gated case that is `beyond`, or that the bench cannot read. */
export function failsGate(verdict: GateVerdict): boolean {
  return verdict.outcome === "beyond" || verdict.outcome === "no read";
}

/** The output of one job of the sweep. */
export interface JobOutput {
  readonly job: string;
  readonly commit: string;
  readonly at: string;
  readonly node: string;
  readonly results: readonly DuelResult[];
  /** The time of the work of a full search for each size of a pool, in microseconds. Only the full-search jobs measure it. */
  readonly fullSearch: readonly { readonly sites: number; readonly us: number }[];
}

/** This function writes a number with `digits` digits after the point. */
const fixed = (value: number, digits = 0): string => value.toFixed(digits);

/** This function gives the median of the counts and its bootstrap interval at the level 0.95, as text. */
function countText(counts: readonly number[]): string {
  if (counts.length === 0) return "no count";
  const interval = bootstrapMedian(counts, { runs: 2000, seed: "pair-bench" });
  return `${fixed(interval.estimate)} [${fixed(interval.low)}, ${fixed(interval.high)}]`;
}

/**
 * This function gives the median ratio of the counts of a rule to the counts of `random` for the same seeds, with its
 * bootstrap interval. A ratio below 1 needs fewer picks than random pairs.
 */
function ratioText(rule: readonly DuelResult[], baseline: readonly DuelResult[]): string {
  const ratios = rule.flatMap((result) => {
    const base = baseline.find((other) => other.seed === result.seed);
    return result.picks === null || base?.picks === null || base === undefined ? [] : [result.picks / base.picks];
  });
  if (ratios.length === 0) return "no ratio";
  const interval = bootstrapMedian(ratios, { runs: 2000, seed: "pair-bench-ratio" });
  return `${fixed(interval.estimate, 2)} [${fixed(interval.low, 2)}, ${fixed(interval.high, 2)}]`;
}

/** This function gives the report of the sweep and the gate, in Markdown. */
export function sweepReport(outputs: readonly JobOutput[], verdicts: readonly GateVerdict[]): string {
  const results = outputs.flatMap((output) => output.results);
  const sizes = [...new Set(results.map((result) => result.sites))].sort((x, y) => x - y);
  const lines: string[] = [
    "## The pair bench (R31)",
    "",
    `Each duel ends when the Kendall tau of the ladder and the hidden taste is ${String(TARGET_TAU)} or more, or at ${String(CAP_PER_SITE)} answers for each site.`,
    "A count is the median of the answers over the seeds, with a bootstrap interval of the median at the level 0.95. A tie and a skip are answers.",
    "",
    "| Sites | Rule | Seeds | Picks to the target | Ratio to random | At the cap | Repeats | Choice (ms) | Fit (ms) |",
    "| ---: | --- | ---: | --- | --- | ---: | ---: | ---: | ---: |",
  ];
  for (const sites of sizes) {
    const here = results.filter((result) => result.sites === sites);
    const baseline = here.filter((result) => result.rule === "random");
    for (const name of Object.keys(RULES) as RuleName[]) {
      const rule = here.filter((result) => result.rule === name);
      if (rule.length === 0) continue;
      const counts = rule.flatMap((result) => (result.picks === null ? [] : [result.picks]));
      const capped = rule.length - counts.length;
      const ratio = baseline.length === 0 || name === "random" ? "" : ratioText(rule, baseline);
      const repeats = median(rule.map((result) => result.repeats));
      const choose = median(rule.map((result) => result.chooseMs));
      const fit = median(rule.map((result) => result.fitMs));
      lines.push(`| ${String(sites)} | ${name} | ${String(rule.length)} | ${countText(counts)} | ${ratio} | ${String(capped)} | ${fixed(repeats)} | ${fixed(choose, 3)} | ${fixed(fit, 2)} |`);
    }
  }

  const probes = results.flatMap((result) => result.dense);
  if (probes.length > 0) {
    const same = probes.filter((probe) => probe.same).length;
    lines.push(
      "",
      "### The sparse fit and the dense fit",
      "",
      "At each probe, the dense fit gets the same picks, and `choosePair` gets the same seed and the same recent pairs.",
      "",
      "| Probes | Same pair | Median information of the sparse pair | Lowest information of the sparse pair | Median SE ratio, sparse to dense |",
      "| ---: | ---: | ---: | ---: | ---: |",
      `| ${String(probes.length)} | ${fixed((100 * same) / probes.length, 1)} % | ${fixed(median(probes.map((probe) => probe.information)), 3)} | ${fixed(Math.min(...probes.map((probe) => probe.information)), 3)} | ${fixed(median(probes.map((probe) => probe.se)), 3)} |`,
    );
  }

  const costs = outputs.flatMap((output) => output.fullSearch);
  if (costs.length > 0) {
    lines.push("", "### The work of a full search", "", "| Sites | Time (µs) |", "| ---: | ---: |");
    for (const cost of [...costs].sort((x, y) => x.sites - y.sites)) lines.push(`| ${String(cost.sites)} | ${fixed(cost.us, 1)} |`);
  }

  lines.push("", "### The gate", "", "The limit of a gated case is the worst count of its seeds plus their spread: `max + (max - min)`.", "");
  lines.push("| Sites | Rule | Seeds | Limit | Worst | Outcome | Reason |", "| ---: | --- | ---: | ---: | ---: | --- | --- |");
  for (const verdict of verdicts) {
    const { gate } = verdict;
    lines.push(
      `| ${String(gate.sites)} | ${gate.rule} | ${String(gate.seeds.length)} | ${verdict.limit === undefined ? "none" : String(verdict.limit)} | ${verdict.worst === undefined ? "none" : String(verdict.worst)} | ${verdict.outcome} | ${verdict.reason} |`,
    );
  }
  const commits = [...new Set(outputs.map((output) => output.commit))].join(", ");
  lines.push("", `Commit ${commits}. Node.js ${[...new Set(outputs.map((output) => output.node))].join(", ")}.`, "");
  return `${lines.join("\n")}\n`;
}

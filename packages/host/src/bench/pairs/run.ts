/**
 * The runner of one job of the pair bench:
 *
 *     node packages/host/src/bench/pairs/run.ts --job 50-sites --out pair-records [--seeds 3]
 *
 * The runner plays each duel of the job, one rule and one seed after another. It writes the result of each duel to
 * `<out>/<job>.json`. The option `--seeds` keeps only the first seeds, for a short check on a local computer.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { random } from "@mark1russell7/rigor-generators";
import { type RatedItem, median, pairInformation } from "@mark1russell7/rigor-statistics";
import { type DuelResult, duel } from "./duel.ts";
import { type JobOutput, SWEEP_JOBS, jobFile } from "./gate.ts";

/** The rounds of the time of the work of a full search. */
const ROUNDS = 25;

/**
 * This function gives the median time of the work of a full search over a pool of `sites` items, in microseconds. The
 * work is the information of each pair of the pool and one draw for each pair, as in `choosePair`.
 */
function fullSearchWork(sites: number): number {
  const draw = random(`pair-bench/full-search/${String(sites)}`);
  const items: RatedItem[] = Array.from({ length: sites }, (_, i) => ({ id: `s${String(i)}`, rating: draw.normal(1500, 200), se: draw.range(30, 200), picks: draw.int(0, 20) }));
  const times: number[] = [];
  let sum = 0;
  for (let round = 0; round < ROUNDS; round++) {
    const start = performance.now();
    for (let i = 0; i < sites; i++) for (let j = i + 1; j < sites; j++) sum += pairInformation(items[i]!, items[j]!) + draw.next();
    times.push((performance.now() - start) * 1000);
  }
  // The sum keeps the loop from an optimization that removes it.
  if (!Number.isFinite(sum)) throw new Error("The work of the full search gave a sum that is not finite.");
  return median(times);
}

const { values } = parseArgs({ options: { job: { type: "string" }, out: { type: "string" }, seeds: { type: "string" } }, strict: true });
const job = SWEEP_JOBS.find((item) => jobFile(item) === `${values.job ?? ""}.json`);
const count = values.seeds === undefined ? undefined : Number(values.seeds);
if (job === undefined || values.out === undefined || (count !== undefined && !(Number.isInteger(count) && count >= 1))) {
  const names = SWEEP_JOBS.map((item) => jobFile(item).replace(/\.json$/, "")).join(" | ");
  process.stderr.write(`The runner needs --job <${names}>, --out <folder> and an optional --seeds <whole number>.\n`);
  process.exit(2);
}

const seeds = count === undefined ? job.seeds : job.seeds.slice(0, count);
const results: DuelResult[] = [];
for (const rule of job.rules) {
  for (const seed of seeds) {
    const start = performance.now();
    const result = duel({ sites: job.sites, seed, rule }, { probeEvery: rule === "app" ? job.probeEvery : 0 });
    results.push(result);
    const seconds = ((performance.now() - start) / 1000).toFixed(1);
    process.stdout.write(`${job.name} | ${rule} | seed ${String(seed)}: ${result.picks === null ? "the cap" : `${String(result.picks)} picks`}, tau ${result.tau.toFixed(3)}, ${seconds} s\n`);
  }
}
const fullSearch = job.costs.map((sites) => ({ sites, us: fullSearchWork(sites) }));
const output: JobOutput = { job: job.name, commit: process.env["GITHUB_SHA"] ?? "local", at: new Date().toISOString(), node: process.version, results, fullSearch };
mkdirSync(values.out, { recursive: true });
const file = join(values.out, jobFile(job));
writeFileSync(file, `${JSON.stringify(output, null, 2)}\n`);
process.stdout.write(`The results of the job are in ${file}.\n`);

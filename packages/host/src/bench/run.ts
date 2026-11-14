/**
 * The runner of one rung of the scale bench:
 *
 *     node packages/host/src/bench/run.ts --sites 1000 --out bench-records [--rounds 12]
 *
 * The runner writes the log of the rung to a SQLite file, and examines that the store accepts each event. Then
 * `freshRun` of `@mark1russell7/rigor-bench` starts the child (`child.ts`) for each measure and round, with an A/A pair.
 * The runner writes the record of the rung and each raw time to `<out>/rung-<sites>.json`.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { freshRun } from "@mark1russell7/rigor-bench/fresh";
import { openStore } from "@pairrank/store";
import { BENCH_ARM, type RungOutput, rungRecord } from "./record.ts";
import { MEASURES, SCALE_RUNGS, scaleLog } from "./scale.ts";

/** The rounds of a job. A median budget at the level 0.95 needs 6 rounds or more in each arm. */
const ROUNDS = 12;

/** The longest time of one child. A child over it in the first round skips its case, so the job ends in time. */
const CHILD_LIMIT_MS = 120_000;

const { values } = parseArgs({
  options: { sites: { type: "string" }, out: { type: "string" }, rounds: { type: "string" } },
  strict: true,
});
const rung = SCALE_RUNGS.find((item) => String(item.size.sites) === values.sites);
const rounds = values.rounds === undefined ? ROUNDS : Number(values.rounds);
if (rung === undefined || values.out === undefined || !Number.isInteger(rounds) || rounds < 1) {
  const sizes = SCALE_RUNGS.map((item) => String(item.size.sites)).join(" | ");
  process.stderr.write(`The runner needs --sites <${sizes}>, --out <folder> and an optional --rounds <whole number>.\n`);
  process.exit(2);
}

const folder = mkdtempSync(join(tmpdir(), "pairrank-rung-"));
try {
  const base = join(folder, "base.sqlite");
  const store = openStore(base);
  const problems = store.appendAll(scaleLog(rung.size));
  const counts = { sites: store.state.sites.size, picks: store.state.picks.size };
  store.close();
  if (problems.length > 0) throw new Error(`The store refused ${String(problems.length)} events of the rung. The first: ${JSON.stringify(problems[0])}`);
  process.stdout.write(`The rung ${rung.name} has ${String(counts.sites)} sites and ${String(counts.picks)} picks.\n`);

  const child = fileURLToPath(new URL("./child.ts", import.meta.url));
  const run = await freshRun({
    base: { id: BENCH_ARM, command: [process.execPath, child, "--base", base] },
    candidates: [],
    cases: [...MEASURES],
    rounds,
    aa: true,
    timeoutMs: CHILD_LIMIT_MS,
    overLimit: "skip",
    job: String(rung.size.sites),
  });
  const output: RungOutput = { record: rungRecord(rung, run, { commit: process.env["GITHUB_SHA"] ?? "local", at: new Date().toISOString() }), run };
  mkdirSync(values.out, { recursive: true });
  const file = join(values.out, `rung-${String(rung.size.sites)}.json`);
  writeFileSync(file, `${JSON.stringify(output, null, 2)}\n`);
  process.stdout.write(`The record of the rung is in ${file}.\n`);
} finally {
  rmSync(folder, { recursive: true, force: true });
}

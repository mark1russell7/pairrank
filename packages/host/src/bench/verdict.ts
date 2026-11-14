/**
 * The verdict of the scale ladder, from the records of the rungs:
 *
 *     node packages/host/src/bench/verdict.ts --records bench-records
 *
 * The verdict reads each file `rung-*.json` of the folder, and writes its report to the output and to the summary of
 * the workflow (`GITHUB_STEP_SUMMARY`). It stops with the exit code 1 when a locked rung is not `within`.
 */
import { appendFileSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { ladderVerdict } from "@mark1russell7/rigor-bench";
import { type RungOutput, benchReport } from "./record.ts";
import { SCALE_LADDER } from "./scale.ts";

const { values } = parseArgs({ options: { records: { type: "string" } }, strict: true });
if (values.records === undefined) {
  process.stderr.write("The verdict needs --records <folder>.\n");
  process.exit(2);
}
const folder = values.records;
const files = readdirSync(folder).filter((name) => /^rung-\d+\.json$/.test(name));
const outputs = files.map((name) => JSON.parse(readFileSync(join(folder, name), "utf8")) as RungOutput);
const verdict = ladderVerdict(
  SCALE_LADDER,
  outputs.map((output) => output.record),
  { now: new Date().toISOString() },
);
const report = benchReport(verdict, outputs);
process.stdout.write(report);
const summary = process.env["GITHUB_STEP_SUMMARY"];
if (summary !== undefined) appendFileSync(summary, report);
process.exitCode = verdict.failed ? 1 : 0;

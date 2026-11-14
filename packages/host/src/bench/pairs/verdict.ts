/**
 * The verdict of the pair bench, from the results of all jobs:
 *
 *     node packages/host/src/bench/pairs/verdict.ts --records pair-records
 *
 * The verdict reads each JSON file of the folder, and writes its report to the output and to the summary of the
 * workflow (`GITHUB_STEP_SUMMARY`). It stops with the exit code 1 when a gated case is `beyond`, or when the bench
 * cannot read it. The job `20-sites` gives the case of the tests too.
 */
import { appendFileSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { type JobOutput, PAIR_GATES, failsGate, gateVerdict, sweepReport } from "./gate.ts";

const { values } = parseArgs({ options: { records: { type: "string" } }, strict: true });
if (values.records === undefined) {
  process.stderr.write("The verdict needs --records <folder>.\n");
  process.exit(2);
}
const folder = values.records;
const outputs = readdirSync(folder)
  .filter((name) => name.endsWith(".json"))
  .map((name) => JSON.parse(readFileSync(join(folder, name), "utf8")) as JobOutput);
const results = outputs.flatMap((output) => output.results);
const verdicts = PAIR_GATES.map((gate) => gateVerdict(gate, results));
const report = sweepReport(outputs, verdicts);
process.stdout.write(report);
const summary = process.env["GITHUB_STEP_SUMMARY"];
if (summary !== undefined) appendFileSync(summary, report);
process.exitCode = verdicts.some(failsGate) ? 1 : 0;

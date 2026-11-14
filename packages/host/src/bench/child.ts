/**
 * The child of the scale bench. The runner (`run.ts`) starts it in a fresh process for each step:
 *
 *     node packages/host/src/bench/child.ts --base <SQLite file of the rung> --case <measure>
 *
 * The child times one step on a copy of the file, and writes the JSON line `{"ms":..,"hash":..}` of `freshRun`.
 */
import { parseArgs } from "node:util";
import { MEASURES, type Measure } from "./scale.ts";
import { timeStep } from "./steps.ts";

const { values } = parseArgs({ options: { base: { type: "string" }, case: { type: "string" } }, strict: true });
const measure = MEASURES.find((item) => item === values.case);
if (values.base === undefined || measure === undefined) {
  process.stderr.write(`The child needs --base <file> and --case <${MEASURES.join(" | ")}>.\n`);
  process.exit(2);
}
const time = await timeStep(measure satisfies Measure, values.base);
process.stdout.write(`${JSON.stringify(time)}\n`);

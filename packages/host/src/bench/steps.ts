/**
 * The steps that the scale bench times. Each step uses its own copy of the SQLite file of a rung. Thus a step that
 * writes does not change the file of the next step. The child of the bench (`child.ts`) does one step in a fresh process.
 */
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { canonicalHash } from "@mark1russell7/rigor-generators";
import type { Scope } from "@pairrank/core";
import { type Store, openStore } from "@pairrank/store";
import { callerOf } from "@procedures/client";
import { pairrankModule } from "../module.ts";
import type { DuelPair, ViewerAnswer } from "../views.ts";
import type { Measure } from "./scale.ts";

/** The time of one step in milliseconds, and the hash of its result. Each run of a step on one file gives the same hash. */
export interface StepTime {
  readonly ms: number;
  readonly hash: string;
}

const OVERALL: Scope = { kind: "overall" };

/** The time of each new event of a step. A fixed time and fixed ids make the hash the same in each run. */
const STEP_TIME = "2026-06-01T00:00:00.000Z";

/** This function gives the procedures of the host over a store, with fixed ids and a fixed clock. */
function callerOver(store: Store): ReturnType<typeof callerOf> {
  let next = 0;
  return callerOf(pairrankModule(store, { key: (url) => url, id: () => `bench-${String(next++)}`, now: () => STEP_TIME }));
}

/** This function gives the pair of a duel, or an error when the rung has no pair. */
async function pairOf(call: ReturnType<typeof callerOf>, seed: number, recent: [string, string][]): Promise<DuelPair> {
  const pair = await call<DuelPair | null>(["pairrank", "pair"], { scope: OVERALL, seed, recent });
  if (pair === null) throw new Error("The rung has no pair for a duel.");
  return pair;
}

/** This function writes one pick of the left site of a pair, then it gives the next pair. The person waits for this. */
async function pickStep(call: ReturnType<typeof callerOf>, pair: DuelPair, seed: number): Promise<DuelPair> {
  await call(["pairrank", "apply"], { drafts: [{ type: "pick", a: pair.a, b: pair.b, scope: OVERALL, outcome: "a" }] });
  return pairOf(call, seed, [[pair.a, pair.b]]);
}

/** This function times the open of the store: the read of the SQLite file and the replay of the log. */
function start(file: string): StepTime {
  const begin = performance.now();
  const store = openStore(file);
  const ms = performance.now() - begin;
  const hash = canonicalHash([store.state.sites.size, store.state.picks.size, store.problems.length]);
  store.close();
  return { ms, hash };
}

/**
 * This function times one step of a duel: the pick, then the choice of the next pair. One step before it warms the
 * code, as in a duel that already runs. The pick clears the cache of the ladders, so the next pair needs a new fit.
 */
async function duelStep(file: string): Promise<StepTime> {
  const store = openStore(file);
  try {
    const call = callerOver(store);
    const warm = await pickStep(call, await pairOf(call, 0, []), 1);
    const begin = performance.now();
    const pair = await pickStep(call, warm, 2);
    const ms = performance.now() - begin;
    return { ms, hash: canonicalHash([pair.a, pair.b, store.state.picks.size]) };
  } finally {
    store.close();
  }
}

/**
 * This function times the Sites screen in its default order: the overall ratings, with the best model by test. A first
 * request warms the code. The timed request uses a new module of procedures, so its cache is empty, as after a new pick.
 */
async function sitesScreen(file: string): Promise<StepTime> {
  const store = openStore(file);
  try {
    const input = { order: { kind: "rating", scopes: [OVERALL] }, model: "best" };
    await callerOver(store)<ViewerAnswer>(["pairrank", "viewer"], input);
    const call = callerOver(store);
    const begin = performance.now();
    const answer = await call<ViewerAnswer>(["pairrank", "viewer"], input);
    const ms = performance.now() - begin;
    if (!answer.ok) throw new Error(`The Sites screen gave a problem: ${answer.problem.message}`);
    return { ms, hash: canonicalHash([answer.total, answer.rows.slice(0, 20).map((row) => row.site)]) };
  } finally {
    store.close();
  }
}

/** This function times one step on a copy of the file `base`, and removes the copy after the step. */
export async function timeStep(measure: Measure, base: string): Promise<StepTime> {
  const folder = mkdtempSync(join(tmpdir(), "pairrank-bench-"));
  try {
    const file = join(folder, "pairrank.sqlite");
    copyFileSync(base, file);
    if (measure === "start") return start(file);
    if (measure === "duel step") return await duelStep(file);
    return await sitesScreen(file);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

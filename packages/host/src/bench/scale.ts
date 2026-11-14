/**
 * The scale ladder of pairrank (R32) gives the targets of the host at each power of ten of sites and picks. It is a
 * ladder of `@mark1russell7/rigor-bench`. The workflow `bench.yml` measures each rung, and each locked rung is a gate.
 *
 * A budget is the largest median time that a person waits for one of three steps:
 *
 * - `start`: the store opens its SQLite file and replays the log. The app does this one time when it starts.
 * - `duel step`: the host writes one pick, then it chooses the next pair. The person waits for this after each pick.
 * - `sites screen`: the Sites screen in the order of the ratings, with the best model by test. This is the default order.
 *
 * The limits come from the time that a person can wait. A reply in 100 ms looks instant. A reply in 1 s keeps the
 * person in the flow of the work. The largest rung gets more time, because few people keep 10,000 sites.
 */
import { random } from "@mark1russell7/rigor-generators";
import { LADDER_FORMAT, type Ladder, type MedianBudget } from "@mark1russell7/rigor-bench";
import { eloExpected } from "@mark1russell7/rigor-statistics";
import type { Event, Outcome } from "@pairrank/core";

/** The three steps that the bench measures. */
export const MEASURES = ["start", "duel step", "sites screen"] as const;

/** One step that the bench measures. */
export type Measure = (typeof MEASURES)[number];

/** The size of the log of one rung. */
export interface RungSize {
  readonly sites: number;
  readonly picks: number;
  /** The count of the tags. Each site has one or two tags. */
  readonly tags: number;
}

/** One rung of the ladder: its name, its size and the limit of each measure in milliseconds. */
export interface ScaleRung {
  readonly name: string;
  readonly size: RungSize;
  readonly limits: Readonly<Record<Measure, number>>;
  /** True when the gate holds the rung. A rung is locked only after CI runs show that it holds. */
  readonly locked: boolean;
}

/** The rungs, from the smallest to the largest. Each rung has 20 sites for each tag and 10 picks for each site. */
export const SCALE_RUNGS: readonly ScaleRung[] = [
  {
    name: "100 sites",
    size: { sites: 100, picks: 1_000, tags: 5 },
    limits: { start: 1_000, "duel step": 100, "sites screen": 100 },
    locked: false,
  },
  {
    name: "1,000 sites",
    size: { sites: 1_000, picks: 10_000, tags: 50 },
    limits: { start: 1_000, "duel step": 100, "sites screen": 300 },
    locked: false,
  },
  {
    name: "10,000 sites",
    size: { sites: 10_000, picks: 100_000, tags: 500 },
    limits: { start: 3_000, "duel step": 300, "sites screen": 1_000 },
    locked: false,
  },
];

/**
 * The part of a limit that the medians of the two arms of one build can differ by. A larger difference makes the run
 * too noisy for a verdict on that limit, and the budget is `cannot decide`.
 */
export const NOISE_SHARE = 0.25;

/** The name of the test of each rung in the workflow `bench.yml`. */
export const BENCH_TEST = "bench.yml";

/** This function gives the budget of one measure of a rung. */
function budget(rung: ScaleRung, measure: Measure): MedianBudget {
  const limit = rung.limits[measure];
  return { kind: "median", measure, unit: "ms", limit, maxDifference: limit * NOISE_SHARE };
}

/** The scale ladder of the host, in the format of `@mark1russell7/rigor-bench`. */
export const SCALE_LADDER: Ladder = {
  format: LADDER_FORMAT,
  subject: "the pairrank host",
  dimensions: [
    { name: "sites", describe: "one saved site" },
    { name: "picks", describe: "one pick of a duel" },
  ],
  rungs: SCALE_RUNGS.map((rung) => ({
    name: rung.name,
    at: { sites: rung.size.sites, picks: rung.size.picks },
    test: BENCH_TEST,
    locked: rung.locked,
    budgets: MEASURES.map((measure) => budget(rung, measure)),
  })),
};

/** The time of the first event of a log. Each event comes one second after the last event. */
const START = Date.UTC(2026, 0, 1);

/** The share of the picks that are a tie, and the share that are a skip. */
const TIE_SHARE = 0.05;
const SKIP_SHARE = 0.03;

/** The spread of the hidden taste on the Elo scale. */
const TASTE_SD = 200;

/**
 * This function gives the log of a rung: sites, tags and picks of a seeded hidden taste. The same size and seed give
 * the same log.
 *
 * - Each site has an address with the domain `example`, and one or two tags.
 * - Each pick is overall, and its pair is a uniform random pair of two sites.
 * - The taste gives each site a rating on the Elo scale. A pick takes the side of the pair by the odds of that scale.
 */
export function scaleLog(size: RungSize, seed = "pairrank-scale"): Event[] {
  const draw = random(`${seed}/${String(size.sites)}/${String(size.picks)}`);
  const events: Event[] = [];
  const add = (draft: Record<string, unknown>): void => {
    const n = events.length;
    events.push({ id: `e${String(n)}`, at: new Date(START + n * 1000).toISOString(), ...draft } as Event);
  };
  for (let tag = 0; tag < size.tags; tag++) add({ type: "tag.created", tag: `t${String(tag)}`, name: `Tag ${String(tag)}` });
  const taste: number[] = [];
  for (let site = 0; site < size.sites; site++) {
    const id = `s${String(site)}`;
    add({ type: "site.added", site: id, url: `https://s${String(site)}.example/`, title: `Site ${String(site)}` });
    const tags = size.tags === 0 ? [] : draw.sample([...Array(size.tags).keys()], Math.min(size.tags, draw.int(1, 2)));
    for (const tag of tags) add({ type: "site.tagged", site: id, tag: `t${String(tag)}` });
    taste.push(draw.normal(1500, TASTE_SD));
  }
  for (let pick = 0; pick < size.picks; pick++) {
    const a = draw.below(size.sites);
    const b = (a + 1 + draw.below(size.sites - 1)) % size.sites;
    const roll = draw.next();
    const outcome: Outcome =
      roll < SKIP_SHARE ? "skip" : roll < SKIP_SHARE + TIE_SHARE ? "tie" : draw.chance(eloExpected(taste[a]!, taste[b]!)) ? "a" : "b";
    add({ type: "pick", a: `s${String(a)}`, b: `s${String(b)}`, scope: { kind: "overall" }, outcome });
  }
  return events;
}

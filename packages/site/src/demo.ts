/**
 * The live demo of the site: a duel of eight sample sites and their ladder. The demo uses the code of the app. The
 * event log comes from `@pairrank/core`, and the ladders and the choice of the pair come from `@pairrank/ratings`.
 * The rules of the duel come from `@pairrank/ui`. The state is in the page only, and a reload starts it again.
 *
 * A hidden taste can also pick. It has a fixed order of the sample sites, and it picks the side of each pair by the
 * odds of the Elo scale. Thus the ladder of its picks moves to its order, and the agreement shows how near it is.
 */
import { random } from "@mark1russell7/rigor-generators";
import { eloExpected, kendallTau, ratingUncertainty } from "@mark1russell7/rigor-statistics";
import { type Draft, type Scope, type State, apply, createState, stamp } from "@pairrank/core";
import { type Ladder, type ModelName, type PairChoice, choosePair, ladderOf, ratedOf } from "@pairrank/ratings";
import { type DuelAction, type DuelStep, type Pair, outcomeOf, pickDraft, recentOf, seedOf, undoDraft } from "@pairrank/ui/duel";

/** A sample site of the demo. Its address uses the domain `example`, so it is not a real site. */
export interface SampleSite {
  readonly id: string;
  readonly title: string;
  readonly host: string;
  /** The rating of the site in the hidden taste. The demo does not show it until the person asks. */
  readonly taste: number;
}

/** The sample sites, in the order of the hidden taste: the first site is the best. */
export const SAMPLE_SITES: readonly SampleSite[] = [
  { id: "trails", title: "Trail maps", host: "trail-maps.example", taste: 1780 },
  { id: "tides", title: "Tide tables", host: "tide-tables.example", taste: 1700 },
  { id: "stars", title: "Star chart", host: "star-chart.example", taste: 1630 },
  { id: "bread", title: "Bread notes", host: "bread-notes.example", taste: 1560 },
  { id: "knots", title: "Knot guide", host: "knot-guide.example", taste: 1480 },
  { id: "birds", title: "Bird calls", host: "bird-calls.example", taste: 1400 },
  { id: "rain", title: "Rain radar", host: "rain-radar.example", taste: 1320 },
  { id: "tea", title: "Tea timer", host: "tea-timer.example", taste: 1250 },
];

/** The models of the ladder, with their names on the page. */
export const MODELS: readonly { readonly model: ModelName; readonly name: string }[] = [
  { model: "bradley-terry", name: "Bradley-Terry" },
  { model: "elo", name: "Elo" },
  { model: "glicko2", name: "Glicko-2" },
];

/** The scope of each pick of the demo. The demo has no tags. */
const OVERALL: Scope = { kind: "overall" };

/** The id of the duel of the demo, in each pick. */
const DUEL = "demo";

/** The time of the first event of the demo. Each event comes one second after the last event. */
const START = Date.UTC(2026, 0, 1);

/** The state of the demo. The functions of this module change it. */
export interface Demo {
  readonly state: State;
  /** The seed of the choice of each pair and of the hidden taste. */
  readonly seed: string;
  /** The count of events in the log. It gives the id and the time of the next event. */
  events: number;
  /** The steps that an undo can remove, the last step last. Each step is a pick, a tie or a skip. */
  readonly steps: DuelStep[];
  /** The pair on the screen, or `undefined` when no pair is possible. */
  pair: Pair | undefined;
  model: ModelName;
}

/** This function adds one event to the log of the demo, and gives its id. A refusal of the log is a defect, so it throws. */
function record(demo: Demo, draft: Draft): string {
  const id = `demo-${String(demo.events)}`;
  const problem = apply(demo.state, stamp(draft, id, new Date(START + demo.events * 1000).toISOString()));
  if (problem !== undefined) throw new Error(`The demo log refused ${draft.type}: ${problem.message}`);
  demo.events += 1;
  return id;
}

/** This function makes a new demo: the eight sample sites, no picks, and the first pair. */
export function createDemo(seed = "pairrank-demo", model: ModelName = "bradley-terry"): Demo {
  const demo: Demo = { state: createState(), seed, events: 0, steps: [], pair: undefined, model };
  for (const site of SAMPLE_SITES) record(demo, { type: "site.added", site: site.id, url: `https://${site.host}/`, title: site.title });
  demo.pair = nextPair(demo);
  return demo;
}

/** This function gives the ladder of the demo, with the model of the demo. */
export function ladderOfDemo(demo: Demo): Ladder {
  return ladderOf(demo.state, OVERALL, { model: demo.model });
}

/** This function gives the next pair: the pair with the most information that is not one of the last pairs of the duel. */
function nextPair(demo: Demo): Pair | undefined {
  const choice: PairChoice | undefined = choosePair(
    ladderOfDemo(demo),
    SAMPLE_SITES.map((site) => site.id),
    { seed: seedOf(`${demo.seed}/${DUEL}`, demo.events), recent: recentOf(demo.steps) },
  );
  return choice === undefined ? undefined : { a: choice.a, b: choice.b };
}

/**
 * This function does one action of the duel: a pick of a side, a tie, a skip or an undo. An undo shows the pair of the
 * last pick again, as the app does. The function gives `false` when the action does nothing. An undo with no pick and
 * the action `hide` do nothing, because the demo cannot hide a site.
 */
export function act(demo: Demo, action: DuelAction): boolean {
  if (action === "hide") return false;
  if (action === "undo") {
    const last = demo.steps.pop();
    if (last === undefined) return false;
    record(demo, undoDraft(last));
    demo.pair = last.pair;
    return true;
  }
  const pair = demo.pair;
  if (pair === undefined) return false;
  const outcome = outcomeOf(action);
  const event = record(demo, pickDraft(pair, OVERALL, outcome, DUEL));
  demo.steps.push({ kind: "pick", pair, outcome, event, asks: [OVERALL], ask: 0 });
  demo.pair = nextPair(demo);
  return true;
}

/** This function changes the model of the ladder. The picks stay, and the pair on the screen stays. */
export function setModel(demo: Demo, model: ModelName): void {
  demo.model = model;
}

/** This function gives the side that the hidden taste picks in the pair on the screen. A seeded draw gives the same side again. */
export function tasteAction(demo: Demo): "left" | "right" | undefined {
  const pair = demo.pair;
  if (pair === undefined) return undefined;
  const taste = (id: string): number => SAMPLE_SITES.find((site) => site.id === id)?.taste ?? 1500;
  const draw = random(`${demo.seed}/taste/${String(demo.events)}`);
  return draw.chance(eloExpected(taste(pair.a), taste(pair.b))) ? "left" : "right";
}

/** This function lets the hidden taste do `count` picks, and gives the count that it did. */
export function tastePicks(demo: Demo, count: number): number {
  let done = 0;
  for (; done < count; done++) {
    const action = tasteAction(demo);
    if (action === undefined || !act(demo, action)) break;
  }
  return done;
}

/**
 * This function gives the agreement of the ladder with the order of the hidden taste: the Kendall tau-b of the two
 * orders. It is 1 when the orders are the same, 0 when they have no relation, and -1 when one is the reverse. Before
 * the first pick, all the ratings are equal. The ladder then has no order, and the function gives `undefined`.
 */
export function agreementOf(ladder: Ladder): number | undefined {
  const rating = new Map(ladder.ratings.map((row) => [row.site, row.rating]));
  const ratings = SAMPLE_SITES.map((site) => rating.get(site.id) ?? 1500);
  if (ratings.every((value) => value === ratings[0])) return undefined;
  const tau = kendallTau(
    SAMPLE_SITES.map((site) => site.taste),
    ratings,
  );
  return Number.isFinite(tau) ? tau : undefined;
}

/** One row of the ladder on the page. */
export interface LadderRow {
  readonly site: SampleSite;
  /** The place of the site on the ladder, from 1. */
  readonly place: number;
  /** The place of the site in the hidden taste, from 1. */
  readonly tastePlace: number;
  readonly rating: number;
  /** The uncertainty of the rating, in rating points: its standard error, or an estimate from its count of picks. */
  readonly uncertainty: number;
  readonly wins: number;
  readonly losses: number;
  readonly ties: number;
}

/**
 * This function gives the rows of the ladder, from the highest rating. Each sample site has a row. A site with no
 * pick is at 1500 with the uncertainty of a site with no picks.
 */
export function rowsOf(ladder: Ladder): LadderRow[] {
  const rated = new Map(ladder.ratings.map((row) => [row.site, row]));
  const rows = SAMPLE_SITES.map((site, index) => {
    const row = rated.get(site.id) ?? { site: site.id, rating: 1500, se: undefined, wins: 0, losses: 0, ties: 0 };
    return { site, tastePlace: index + 1, rating: row.rating, uncertainty: ratingUncertainty(ratedOf(row)), wins: row.wins, losses: row.losses, ties: row.ties };
  });
  // A stable sort keeps the order of the ladder for the sites in it
  const order = new Map(ladder.ratings.map((row, index) => [row.site, index]));
  rows.sort((x, y) => y.rating - x.rating || (order.get(x.site.id) ?? Infinity) - (order.get(y.site.id) ?? Infinity));
  return rows.map((row, index) => ({ ...row, place: index + 1 }));
}

/** This function gives the sample site of an id. */
export function siteOf(id: string): SampleSite {
  const site = SAMPLE_SITES.find((sample) => sample.id === id);
  if (site === undefined) throw new Error(`The demo has no site ${id}.`);
  return site;
}

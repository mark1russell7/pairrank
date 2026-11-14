/**
 * The duel of the pair bench (R31). A simulated person has a seeded hidden taste over a list of sites. A rule of the
 * pairs shows two sites, the person picks one, and the ladder fits again. The bench counts the picks until the order of
 * the ladder agrees with the order of the taste.
 *
 * The count is a count of picks, not a time. Thus a seed gives the same count again on each computer.
 *
 * @packageDocumentation
 */
import { type Random, random } from "@mark1russell7/rigor-generators";
import {
  PAIR_FULL_SEARCH,
  type PairChoice,
  type RatedItem,
  choosePair as choosePairOf,
  eloExpected,
  kendallTau,
  median,
  pairInformation,
} from "@mark1russell7/rigor-statistics";
import { type Outcome, type Scope, type SiteId, type State, apply, createState } from "@pairrank/core";
import { type Ladder, type LadderOptions, choosePair, ladderOf, pairableOf, ratedOf } from "@pairrank/ratings";

/** The scope of each pick of the bench. */
export const OVERALL: Scope = { kind: "overall" };

/** The spread of the hidden taste on the Elo scale. The scale bench (`scale.ts`) uses the same spread. */
export const TASTE_SD = 200;

/** The share of the answers that are a tie, and the share that are a skip. The scale bench uses the same shares. */
export const TIE_SHARE = 0.05;
export const SKIP_SHARE = 0.03;

/**
 * The count of the last pairs that the app avoids. It is `RECENT_PAIRS` of `@pairrank/ui`, which sends the last pairs
 * of a duel to `pairrank.pair`. The bench also counts a repeat against this window for each rule.
 */
export const APP_RECENT = 20;

/**
 * The agreement that ends a duel: the Kendall tau of the ladder and the taste. A tau of 0.8 puts 9 of 10 pairs of
 * sites in the order of the taste, because the share of the pairs in order is `(1 + tau) / 2`.
 */
export const TARGET_TAU = 0.8;

/**
 * The largest count of answers of one duel, for each site. A duel that does not get to the target before
 * `CAP_PER_SITE * sites` answers stops with no count.
 */
export const CAP_PER_SITE = 60;

/** One pair of sites, as the app shows it: the left site, then the right site. */
export type ShownPair = readonly [SiteId, SiteId];

/** The data of one choice of a pair. */
export interface PairAsk {
  /** The ladder of the picks so far. */
  readonly ladder: Ladder;
  /** The sites that can be in a pair. */
  readonly sites: readonly SiteId[];
  /** The seed of this choice. Each choice of a duel has its own seed, as in the app. */
  readonly seed: string;
  /** The last pairs of the duel that the rule avoids. The newest pair is last. */
  readonly recent: readonly ShownPair[];
}

/** One rule of the pairs. */
export interface PairRule {
  readonly name: string;
  /** The rule in words, for the report. */
  readonly describe: string;
  /** The options of the fit of the ladder. */
  readonly ladder: LadderOptions;
  /** The count of the last pairs that the rule avoids. */
  readonly recent: number;
  /** This function gives the next pair, or `undefined` when there is no pair. */
  readonly choose: (ask: PairAsk) => PairChoice | undefined;
}

/** This function gives the rule of `choosePair` of `@pairrank/ratings` with the options of the app and other options. */
function choosePairRule(name: string, describe: string, options: { readonly candidates?: number; readonly recent?: number; readonly ladder?: LadderOptions } = {}): PairRule {
  const { candidates } = options;
  return {
    name,
    describe,
    ladder: options.ladder ?? {},
    recent: options.recent ?? APP_RECENT,
    choose: ({ ladder, sites, seed, recent }) => choosePair(ladder, sites, candidates === undefined ? { seed, recent } : { seed, recent, candidates }),
  };
}

/** The id of a site that only fills a pool. It has no permitted pair. */
const FILLER = "\u0000filler";

/**
 * This function chooses a pair as `choosePair` of `@pairrank/ratings` does, but with no full search. The pool gets
 * fillers up to `PAIR_FULL_SEARCH + 1` items, so `choosePair` of `@mark1russell7/rigor-statistics` skips its full
 * search. A filler has no permitted pair, and its weight in the draw of the first item is near 0.
 */
export function chooseWithoutFullSearch(ask: PairAsk, candidates?: number): PairChoice | undefined {
  const rated = new Map(ask.ladder.ratings.map((rating) => [rating.site, rating]));
  const items: RatedItem[] = ask.sites.map((site) => ratedOf(rated.get(site) ?? { site, rating: 1500, se: undefined, wins: 0, losses: 0, ties: 0 }));
  const fillers = Math.max(0, PAIR_FULL_SEARCH + 1 - items.length);
  for (let i = 0; i < fillers; i++) items.push({ id: `${FILLER}${String(i)}`, rating: -1e9, picks: Number.MAX_SAFE_INTEGER });
  const real = (item: RatedItem): boolean => !item.id.startsWith(FILLER);
  return choosePairOf(items, {
    seed: ask.seed,
    recent: ask.recent,
    ...(candidates === undefined ? {} : { candidates }),
    information: (a, b) => (real(a) && real(b) ? pairInformation(a, b) : undefined),
  });
}

/** This function gives a uniform random pair of two sites, with a random side. It is the fair baseline. */
export function chooseRandom(ask: PairAsk): PairChoice | undefined {
  const n = ask.sites.length;
  if (n < 2) return undefined;
  const draw = random(ask.seed);
  const a = draw.below(n);
  const b = (a + 1 + draw.below(n - 1)) % n;
  return { a: ask.sites[a] as SiteId, b: ask.sites[b] as SiteId, information: 0 };
}

/** The names of the rules. */
export type RuleName = (typeof RULE_NAMES)[number];

/** The names of the rules, in the order of the report. */
export const RULE_NAMES = [
  "app",
  "candidates 2",
  "candidates 8",
  "candidates 64",
  "no recent",
  "no full search",
  "candidates 2, no full search",
  "dense fit",
  "random",
] as const;

/** The rules of the pairs. The rule `app` has the options of the app. The others change one option, and `random` is the baseline. */
export const RULES: Readonly<Record<RuleName, PairRule>> = {
  app: choosePairRule("app", "the options of the app: 24 candidates, and no pair of the last 20 pairs"),
  "candidates 2": choosePairRule("candidates 2", "2 candidates for the second site: 1 neighbor in the order and 1 random site", { candidates: 2 }),
  "candidates 8": choosePairRule("candidates 8", "8 candidates for the second site: 4 neighbors in the order and 4 random sites", { candidates: 8 }),
  "candidates 64": choosePairRule("candidates 64", "64 candidates for the second site: 32 neighbors in the order and 32 random sites", { candidates: 64 }),
  "no recent": choosePairRule("no recent", "the options of the app, but a recent pair can come again at once", { recent: 0 }),
  "no full search": {
    name: "no full search",
    describe: "the options of the app, with no full search when each candidate pair is recent",
    ladder: {},
    recent: APP_RECENT,
    choose: (ask) => chooseWithoutFullSearch(ask),
  },
  "candidates 2, no full search": {
    name: "candidates 2, no full search",
    describe: "2 candidates, with no full search when each candidate pair is recent",
    ladder: {},
    recent: APP_RECENT,
    choose: (ask) => chooseWithoutFullSearch(ask, 2),
  },
  "dense fit": choosePairRule("dense fit", "the options of the app, with the dense fit of the ladder at each size", { ladder: { denseLimit: Number.POSITIVE_INFINITY } }),
  random: { name: "random", describe: "a uniform random pair of two sites: the fair baseline", ladder: {}, recent: 0, choose: chooseRandom },
};

/** One duel of the bench: a count of sites, a seed of the taste and a rule. */
export interface DuelCase {
  readonly sites: number;
  readonly seed: number;
  readonly rule: RuleName;
}

/** The result of one choice of the dense fit beside the choice of the sparse fit, for the same picks. */
export interface DenseProbe {
  /** The count of the answers before the choice. */
  readonly picks: number;
  /** True when the two fits choose the same two sites. */
  readonly same: boolean;
  /**
   * The information of the sparse pair over the information of the dense pair, both with the dense ratings. A value
   * of 1 loses nothing.
   */
  readonly information: number;
  /** The median of the approximate standard error of the sparse fit over the standard error of the dense fit. */
  readonly se: number;
}

/** The result of one duel. */
export interface DuelResult extends DuelCase {
  /** The count of the answers until the target, or `null` when the duel got to the cap first. A tie and a skip are answers. */
  readonly picks: number | null;
  readonly cap: number;
  readonly target: number;
  /** The Kendall tau of the ladder and the taste at the end of the duel. */
  readonly tau: number;
  /** The count of the pairs that were in the last `APP_RECENT` pairs of the duel. */
  readonly repeats: number;
  /** The median time of one choice of a pair, in milliseconds. */
  readonly chooseMs: number;
  /** The median time of one fit of the ladder, in milliseconds. */
  readonly fitMs: number;
  /** The dense probes, when the options ask for them. */
  readonly dense: readonly DenseProbe[];
}

/** The options of `duel`. */
export interface DuelOptions {
  readonly target?: number;
  /** The largest count of answers. The default is `CAP_PER_SITE * sites`. */
  readonly cap?: number;
  /** The count of answers between two dense probes. The default is 0, with no probe. */
  readonly probeEvery?: number;
}

/** The first time of the log. Each event comes one second after the last event. */
const START = Date.UTC(2026, 0, 1);

/** This function gives the hidden taste of a duel: one rating on the Elo scale for each site. The site `s<i>` has the rating at `i`. */
export function tasteOf(sites: number, seed: number): number[] {
  const draw = random(`pairrank-pairs/${String(sites)}/${String(seed)}/taste`);
  return Array.from({ length: sites }, () => draw.normal(1500, TASTE_SD));
}

/** This function gives the id of the site at index `i`. */
export function siteOf(i: number): SiteId {
  return `s${String(i)}`;
}

/** This function gives the state with the sites of a duel, and no picks. Each site has an address with the domain `example`. */
export function sitesState(sites: number): State {
  const state = createState();
  for (let i = 0; i < sites; i++) {
    const problem = apply(state, { type: "site.added", id: `site${String(i)}`, at: new Date(START).toISOString(), site: siteOf(i), url: `https://s${String(i)}.example/`, title: `Site ${String(i)}` });
    if (problem !== undefined) throw new Error(problem.message);
  }
  return state;
}

/**
 * This function gives the Kendall tau of the order of a ladder and the order of the taste. The order of the ladder is
 * the order that the app shows: two equal ratings keep the order of the sites. Thus the order has no ties, and a site
 * with no picks does not make the agreement larger.
 */
export function agreementOf(ladder: Ladder, taste: readonly number[]): number {
  const place = new Map(ladder.ratings.map((item, i) => [item.site, i]));
  return kendallTau(
    taste.map((_, i) => -(place.get(siteOf(i)) ?? ladder.ratings.length)),
    taste,
  );
}

/** The key of a pair in each order. */
const pairKey = (a: SiteId, b: SiteId): string => (a < b ? `${a} ${b}` : `${b} ${a}`);

/** This function compares the choice of the sparse fit with the choice of the dense fit for the same picks. */
function denseProbe(state: State, ask: PairAsk, sparse: PairChoice | undefined, picks: number): DenseProbe {
  const ladder = ladderOf(state, OVERALL, { denseLimit: Number.POSITIVE_INFINITY });
  const dense = choosePair(ladder, ask.sites, { seed: ask.seed, recent: ask.recent });
  const rated = new Map(ladder.ratings.map((rating) => [rating.site, ratedOf(rating)]));
  const informationOf = (choice: PairChoice | undefined): number => (choice === undefined ? 0 : pairInformation(rated.get(choice.a)!, rated.get(choice.b)!));
  const sparseSe = new Map(ask.ladder.ratings.map((rating) => [rating.site, rating.se]));
  const ratios = ladder.ratings.flatMap((rating) => {
    const se = sparseSe.get(rating.site);
    return se === undefined || rating.se === undefined || rating.se === 0 ? [] : [se / rating.se];
  });
  const denseInformation = informationOf(dense);
  return {
    picks,
    same: sparse !== undefined && dense !== undefined && pairKey(sparse.a, sparse.b) === pairKey(dense.a, dense.b),
    information: denseInformation === 0 ? 1 : informationOf(sparse) / denseInformation,
    se: ratios.length === 0 ? 1 : median(ratios),
  };
}

/** This function gives the answer of the person for a pair, by the odds of the Elo scale, with ties and skips. */
function answerOf(draw: Random, a: number, b: number): Outcome {
  const roll = draw.next();
  if (roll < SKIP_SHARE) return "skip";
  if (roll < SKIP_SHARE + TIE_SHARE) return "tie";
  return draw.chance(eloExpected(a, b)) ? "a" : "b";
}

/**
 * This function plays one duel. Before each choice, the ladder fits the picks so far, and the duel ends when its
 * Kendall tau with the taste gets to the target. The same case and options give the same result, but the times.
 */
export function duel(test: DuelCase, options: DuelOptions = {}): DuelResult {
  const rule = RULES[test.rule];
  const target = options.target ?? TARGET_TAU;
  const cap = options.cap ?? CAP_PER_SITE * test.sites;
  const taste = tasteOf(test.sites, test.seed);
  const index = new Map(taste.map((_, i) => [siteOf(i), i]));
  const person = random(`pairrank-pairs/${String(test.sites)}/${String(test.seed)}/person`);
  const state = sitesState(test.sites);
  const shown: ShownPair[] = [];
  const chooseMs: number[] = [];
  const fitMs: number[] = [];
  const dense: DenseProbe[] = [];
  let repeats = 0;
  let answers = 0;
  let ladder = ladderOf(state, OVERALL, rule.ladder);
  let tau = agreementOf(ladder, taste);
  while (tau < target && answers < cap) {
    const ask: PairAsk = { ladder, sites: pairableOf(state, OVERALL), seed: `pairrank-pairs/${String(test.seed)}:${String(answers)}`, recent: rule.recent === 0 ? [] : shown.slice(-rule.recent) };
    const start = performance.now();
    const choice = rule.choose(ask);
    chooseMs.push(performance.now() - start);
    if (choice === undefined) throw new Error(`The rule ${rule.name} gave no pair for ${String(test.sites)} sites.`);
    if (options.probeEvery !== undefined && options.probeEvery > 0 && answers % options.probeEvery === 0) dense.push(denseProbe(state, ask, choice, answers));
    const key = pairKey(choice.a, choice.b);
    if (shown.slice(-APP_RECENT).some(([a, b]) => pairKey(a, b) === key)) repeats++;
    shown.push([choice.a, choice.b]);
    const outcome = answerOf(person, taste[index.get(choice.a)!]!, taste[index.get(choice.b)!]!);
    const problem = apply(state, { type: "pick", id: `pick${String(answers)}`, at: new Date(START + (answers + 1) * 1000).toISOString(), a: choice.a, b: choice.b, scope: OVERALL, outcome });
    if (problem !== undefined) throw new Error(problem.message);
    answers++;
    // A skip is not a pick of a ladder, so the ladder does not change.
    if (outcome === "skip") continue;
    const fit = performance.now();
    ladder = ladderOf(state, OVERALL, rule.ladder);
    fitMs.push(performance.now() - fit);
    tau = agreementOf(ladder, taste);
  }
  return {
    ...test,
    picks: tau >= target ? answers : null,
    cap,
    target,
    tau,
    repeats,
    chooseMs: chooseMs.length === 0 ? 0 : median(chooseMs),
    fitMs: fitMs.length === 0 ? 0 : median(fitMs),
    dense,
  };
}

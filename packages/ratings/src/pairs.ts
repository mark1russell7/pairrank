/**
 * The choice of the next pair of a duel. A good pair has a result that is not sure: two sites with near ratings, or
 * sites with few picks. The choice uses a seed, so a seed gives the same pair again.
 */
import { random } from "@mark1russell7/rigor-generators";
import { eloExpected } from "@mark1russell7/rigor-statistics";
import type { SiteId } from "@pairrank/core";
import type { Ladder, Rating } from "./ladder.ts";

/**
 * The uncertainty of a site with no standard error and no picks, in rating points. It is the first deviation of
 * Glicko-2. Elo gives no standard error, so its uncertainty falls with the square root of the count of picks.
 */
export const START_UNCERTAINTY = 350;

/** The largest pool of sites for a full search of a pair that is not recent. */
export const FULL_SEARCH = 64;

/** The options of `choosePair`. */
export interface PairOptions {
  /** The seed of the draw. */
  readonly seed: number | string;
  /** The pairs of the last duels, in each order. The choice takes a recent pair only when there is no other pair. */
  readonly recent?: readonly (readonly [SiteId, SiteId])[];
  /** The count of second sites to examine for the first site. The default is 24. */
  readonly candidates?: number;
}

/** A pair for a duel. `a` is the left site, and `b` is the right site. */
export interface PairChoice {
  readonly a: SiteId;
  readonly b: SiteId;
  /** The expected information of the pick: the variance of the result, times the sum of the two variances of the ratings. */
  readonly information: number;
}

/** This function gives the count of the picks of a site. */
export function picksOf(rating: Rating): number {
  return rating.wins + rating.losses + rating.ties;
}

/** This function gives the uncertainty of a rating, in rating points: its standard error, or an estimate from its picks. */
export function uncertaintyOf(rating: Rating): number {
  return rating.se ?? START_UNCERTAINTY / Math.sqrt(1 + picksOf(rating));
}

/**
 * This function gives the expected information of a pick between two sites. It is high when the result is not sure
 * (a probability near 0.5) and the two ratings are not sure.
 */
export function informationOf(a: Rating, b: Rating): number {
  const p = eloExpected(a.rating, b.rating);
  return p * (1 - p) * (uncertaintyOf(a) ** 2 + uncertaintyOf(b) ** 2);
}

const pairKey = (a: SiteId, b: SiteId): string => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`);

/** This function gives the indexes of the second sites to examine: the neighbors in the ladder, and random sites. */
function candidatesOf(first: number, size: number, count: number, draw: (n: number) => number): number[] {
  if (size - 1 <= count) return [...Array(size).keys()].filter((index) => index !== first);
  const chosen = new Set<number>();
  const near = Math.ceil(count / 2);
  for (let step = 1; chosen.size < near; step++) {
    if (first - step >= 0) chosen.add(first - step);
    if (chosen.size < near && first + step < size) chosen.add(first + step);
  }
  while (chosen.size < count) {
    const index = draw(size);
    if (index !== first) chosen.add(index);
  }
  return [...chosen];
}

/**
 * This function chooses the next pair of a duel from the sites `sites`, with the ratings of `ladder`. A site with no
 * rating in the ladder starts at 1500 with no picks.
 *
 * 1. A draw selects the first site. The weight of a site is 1 / (1 + its picks), so the sites with few picks come first.
 * 2. The second site is the candidate with the most information (`informationOf`). The candidates are the neighbors of
 *    the first site in the ladder, and random sites. A recent pair loses to each pair that is not recent.
 * 3. A draw selects the left and the right side, so the side does not change the picks.
 *
 * In a pool of `FULL_SEARCH` sites or fewer, a recent pair comes only when each pair is recent. The function gives
 * `undefined` for fewer than two sites.
 */
export function choosePair(ladder: Ladder, sites: readonly SiteId[], options: PairOptions): PairChoice | undefined {
  const rated = new Map(ladder.ratings.map((rating) => [rating.site, rating]));
  const pool = [...new Set(sites)]
    .map((site): Rating => rated.get(site) ?? { site, rating: 1500, se: undefined, wins: 0, losses: 0, ties: 0 })
    .sort((x, y) => y.rating - x.rating);
  if (pool.length < 2) return undefined;
  const draw = random(options.seed);
  const recent = new Set((options.recent ?? []).map(([a, b]) => pairKey(a, b)));
  const isRecent = (i: number, j: number): boolean => recent.has(pairKey(pool[i]!.site, pool[j]!.site));
  const jitter = draw.fork("jitter");

  let best: { i: number; j: number; fresh: boolean; score: number; tie: number } | undefined;
  const consider = (i: number, j: number): void => {
    const option = { i, j, fresh: !isRecent(i, j), score: informationOf(pool[i]!, pool[j]!), tie: jitter.next() };
    if (
      best === undefined ||
      (option.fresh && !best.fresh) ||
      (option.fresh === best.fresh && (option.score > best.score || (option.score === best.score && option.tie > best.tie)))
    ) {
      best = option;
    }
  };

  const first = draw.fork("first").weighted(pool.map((rating) => 1 / (1 + picksOf(rating))));
  const second = draw.fork("second");
  for (const j of candidatesOf(first, pool.length, Math.max(1, options.candidates ?? 24), (n) => second.below(n))) consider(first, j);
  if (!best!.fresh && pool.length <= FULL_SEARCH) {
    for (let i = 0; i < pool.length; i++) for (let j = i + 1; j < pool.length; j++) consider(i, j);
  }

  const { i, j, score } = best!;
  const [left, right] = draw.fork("side").chance(0.5) ? [pool[j]!, pool[i]!] : [pool[i]!, pool[j]!];
  return { a: left.site, b: right.site, information: score };
}

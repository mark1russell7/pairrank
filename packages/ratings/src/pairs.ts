/**
 * The choice of the next pair of a duel in a ladder. The math is `choosePair` of `@mark1russell7/rigor-statistics`.
 * This file only gives it the sites of the duel, with their ratings in the ladder.
 */
import { type PairChoice, type PairChoiceOptions, type RatedItem, choosePair as choosePairOf } from "@mark1russell7/rigor-statistics";
import type { SiteId } from "@pairrank/core";
import type { Ladder, Rating } from "./ladder.ts";

export type { PairChoice } from "@mark1russell7/rigor-statistics";

/** The options of `choosePair`: the seed, the recent pairs of sites and the count of candidates. */
export type PairOptions = Omit<PairChoiceOptions, "information">;

/** This function gives the count of the picks of a site. */
export function picksOf(rating: Rating): number {
  return rating.wins + rating.losses + rating.ties;
}

/** This function gives a rating as a rated item of `@mark1russell7/rigor-statistics`. The id of the item is the site. */
export function ratedOf(rating: Rating): RatedItem {
  return { id: rating.site, rating: rating.rating, se: rating.se, picks: picksOf(rating) };
}

/**
 * This function chooses the next pair of a duel from the sites `sites`, with the ratings of `ladder`. A site with no
 * rating in the ladder starts at 1500 with no picks. Each pair is permitted, and its information is `pairInformation`
 * of `@mark1russell7/rigor-statistics`. The function `choosePair` of that package tells the steps.
 */
export function choosePair(ladder: Ladder, sites: readonly SiteId[], options: PairOptions): PairChoice | undefined {
  const rated = new Map(ladder.ratings.map((rating) => [rating.site, rating]));
  const items = sites.map((site) => ratedOf(rated.get(site) ?? { site, rating: 1500, se: undefined, wins: 0, losses: 0, ties: 0 }));
  return choosePairOf(items, options);
}

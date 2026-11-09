/**
 * The pairs of the duel modes. A mode gives a pool of sites, and the asks of each pair. The information of a pair is
 * the sum of the information of its asks, each in the ladder of its scope.
 */
import { mean } from "@mark1russell7/rigor-statistics";
import { type Ask, type Scope, type Site, type SiteId, type State, type TagQuery, asksOf, scopeKey } from "@pairrank/core";
import { type LadderOptions, type PairOptions, type PoolSite, type Rating, choosePairWith, informationOf, ladderOf, picksOf } from "@pairrank/ratings";
import { sitesOfQuery } from "./viewer.ts";
import type { DuelPair } from "./views.ts";

/** The parts of a mode that choose its pairs. */
export interface ModeRule {
  readonly pool: TagQuery;
  readonly asks: readonly Ask[];
}

/**
 * This function chooses the next pair of a duel in a mode. The pairs are two shown sites of the pool with one ask or
 * more. A site of the pool takes its place in the order from the mean of its ratings in the scopes that it can have.
 * Its count of picks is the sum over those scopes. `choosePairWith` tells the steps of the choice.
 *
 * @returns the pair and its asks, or `undefined` when there is no pair
 */
export function modePair(state: State, mode: ModeRule, options: PairOptions, ladderOptions: LadderOptions = {}): DuelPair | undefined {
  const ladders = new Map<string, ReadonlyMap<SiteId, Rating>>();
  const ratingIn = (scope: Scope, site: SiteId): Rating => {
    const key = scopeKey(scope);
    let ladder = ladders.get(key);
    if (ladder === undefined) {
      ladder = new Map(ladderOf(state, scope, ladderOptions).ratings.map((rating) => [rating.site, rating]));
      ladders.set(key, ladder);
    }
    return ladder.get(site) ?? { site, rating: 1500, se: undefined, wins: 0, losses: 0, ties: 0 };
  };

  // The asks of a site with itself are the scopes that a pair can ask of the site
  const sites = sitesOfQuery(state, mode.pool).filter((site) => asksOf(state, mode.asks, site, site).length > 0);
  const bySite = new Map<SiteId, Site>(sites.map((site) => [site.id, site]));
  const pool = sites.map((site): PoolSite => {
    const ratings = asksOf(state, mode.asks, site, site).map((scope) => ratingIn(scope, site.id));
    return { site: site.id, rating: mean(ratings.map((rating) => rating.rating)), picks: ratings.reduce((sum, rating) => sum + picksOf(rating), 0) };
  });
  const asked = (a: SiteId, b: SiteId): Scope[] => asksOf(state, mode.asks, bySite.get(a)!, bySite.get(b)!);

  const choice = choosePairWith(pool, {
    ...options,
    information: (a, b) => {
      const scopes = asked(a, b);
      return scopes.length === 0 ? undefined : scopes.reduce((sum, scope) => sum + informationOf(ratingIn(scope, a), ratingIn(scope, b)), 0);
    },
  });
  return choice === undefined ? undefined : { ...choice, asks: asked(choice.a, choice.b) };
}

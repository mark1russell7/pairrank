/**
 * The ladders of pairrank: one rating for each site in each scope, from the picks of the log. The math is in
 * `@mark1russell7/rigor-statistics`. This file only selects the picks and the sites of a scope.
 *
 * @packageDocumentation
 */
import { type PairComparison, type RatingFitOptions, type RatingModel, fitRatings, selectRatingModel, strengthToRating } from "@mark1russell7/rigor-statistics";
import { type Pick, type Scope, type SiteId, type State, picksIn, scopeKey } from "@pairrank/core";

/** The models of a ladder. */
export type ModelName = RatingModel;

/**
 * The model setting of a ladder: a model, or `best`. The setting `best` gives the model with the lowest log-loss on the
 * last picks of the scope. `selectModel` tells the test.
 */
export type ModelSetting = ModelName | "best";

/** The rating of one site in one scope. */
export interface Rating {
  readonly site: SiteId;
  /** The rating on the Elo scale: 1500 is the center, and 400 points give odds of 10 to 1. */
  readonly rating: number;
  /** The standard error of the rating, in rating points. Elo has no standard error, so it gives `undefined`. */
  readonly se: number | undefined;
  readonly wins: number;
  readonly losses: number;
  readonly ties: number;
}

/** The ladder of one scope. */
export interface Ladder {
  readonly scope: Scope;
  /** The key of the scope: `overall`, or `tag:<id>`. */
  readonly key: string;
  readonly model: ModelName;
  /** The ratings, from the highest to the lowest. Two equal ratings keep the order of the sites in the state. */
  readonly ratings: readonly Rating[];
  /** The count of picks that the ladder uses. A skip is not a pick of a ladder. */
  readonly picks: number;
  /** The Davidson tie parameter of the Bradley-Terry fit, or 0 for the other models. */
  readonly tie: number;
}

/**
 * The options of a ladder: the model, and the options of `fitRatings` of `@mark1russell7/rigor-statistics`. The prior
 * SD of the Bradley-Terry fit is 1, and the K factor of Elo is 32, when the options do not set them.
 */
export interface LadderOptions extends RatingFitOptions {
  /** The model, or `best` for the model that the test of the scope chooses. The default is `bradley-terry`. */
  readonly model?: ModelSetting;
}

/** This function gives the sites that can be in a pair of a scope. A site must not be hidden, and in a tag scope it must have the tag. */
export function pairableOf(state: State, scope: Scope): SiteId[] {
  const sites: SiteId[] = [];
  for (const site of state.sites.values()) {
    if (site.hidden) continue;
    if (scope.kind === "tag" && !site.tags.has(scope.tag)) continue;
    sites.push(site.id);
  }
  return sites;
}

/** The sites of a ladder: each site that can be in a pair of the scope, and each site of a pick of the scope. */
export function sitesOf(state: State, scope: Scope, picks: readonly Pick[]): SiteId[] {
  const sites = new Set<SiteId>(pairableOf(state, scope));
  for (const pick of picks) {
    sites.add(pick.a);
    sites.add(pick.b);
  }
  return [...state.sites.keys()].filter((site) => sites.has(site));
}

/** The comparisons of picks, by the index of each site in `sites`. */
export function comparisonsOf(picks: readonly Pick[], index: ReadonlyMap<SiteId, number>): PairComparison[] {
  return picks.flatMap((pick) => {
    const a = index.get(pick.a);
    const b = index.get(pick.b);
    if (a === undefined || b === undefined || pick.outcome === "skip") return [];
    return [{ a, b, outcome: pick.outcome }];
  });
}

/** The log of a scope: the sites of its ladder, and its picks as comparisons by the index of each site in `sites`. */
export interface ScopeLog {
  readonly sites: readonly SiteId[];
  readonly comparisons: readonly PairComparison[];
}

/** This function gives the log of a scope, in the order of the picks. */
export function logOf(state: State, scope: Scope): ScopeLog {
  const picks = picksIn(state, scope);
  const sites = sitesOf(state, scope, picks);
  const index = new Map(sites.map((site, i) => [site, i]));
  return { sites, comparisons: comparisonsOf(picks, index) };
}

/** This function gives the ladder of one scope. `fitRatings` of `@mark1russell7/rigor-statistics` fits the model. */
export function ladderOf(state: State, scope: Scope, options: LadderOptions = {}): Ladder {
  const { sites, comparisons } = logOf(state, scope);
  const model = options.model === "best" ? selectRatingModel(sites.length, comparisons, options).model : (options.model ?? "bradley-terry");
  const result = fitRatings(model, sites.length, comparisons, options);

  const counts = sites.map(() => ({ wins: 0, losses: 0, ties: 0 }));
  for (const { a, b, outcome } of comparisons) {
    const ca = counts[a] as { wins: number; losses: number; ties: number };
    const cb = counts[b] as { wins: number; losses: number; ties: number };
    if (outcome === "a") (ca.wins++, cb.losses++);
    else if (outcome === "b") (cb.wins++, ca.losses++);
    else (ca.ties++, cb.ties++);
  }
  const ratings = sites.map((site, i): Rating => {
    const se = result.se[i];
    return {
      site,
      rating: strengthToRating(result.strengths[i] as number),
      se: se === undefined ? undefined : strengthToRating(se) - 1500,
      ...(counts[i] as { wins: number; losses: number; ties: number }),
    };
  });
  // A stable sort keeps the order of the state for equal ratings
  ratings.sort((x, y) => y.rating - x.rating);
  return { scope, key: scopeKey(scope), model, ratings, picks: comparisons.length, tie: result.tie };
}

/** This function gives each scope that has a pick: the overall scope first, then each tag in the order of the state. */
export function scopesOf(state: State): Scope[] {
  const scopes: Scope[] = [{ kind: "overall" }];
  for (const tag of state.tags.keys()) scopes.push({ kind: "tag", tag });
  return scopes;
}

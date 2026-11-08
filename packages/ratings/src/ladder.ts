/**
 * The ladders of pairrank: one rating for each site in each scope, from the picks of the log. The math is in
 * `@mark1russell7/rigor-statistics`. This file only selects the picks and the sites of a scope.
 *
 * @packageDocumentation
 */
import {
  type PairComparison,
  bradleyTerry,
  eloUpdate,
  glicko2Update,
  ratingToStrength,
  strengthToRating,
} from "@mark1russell7/rigor-statistics";
import { type Pick, type Scope, type SiteId, type State, picksIn, scopeKey } from "@pairrank/core";

/** The models of a ladder. */
export type ModelName = "bradley-terry" | "elo" | "glicko2";

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

/** The options of a ladder. */
export interface LadderOptions {
  /** The model. The default is `bradley-terry`. */
  readonly model?: ModelName;
  /** The standard deviation of the prior of each log-strength of the Bradley-Terry fit. The default is 1. */
  readonly priorSd?: number;
  /** The K factor of Elo. The default is 32. */
  readonly k?: number;
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

/** The fitted strengths of a model: a log-strength and its standard error for each site, and a tie parameter. */
export interface Fit {
  readonly strengths: readonly number[];
  readonly se: readonly (number | undefined)[];
  readonly tie: number;
}

const score = (outcome: PairComparison["outcome"]): number => (outcome === "a" ? 1 : outcome === "b" ? 0 : 0.5);

/** This function fits a model to the comparisons of `items` sites, in the order of the comparisons. */
export function fit(model: ModelName, items: number, comparisons: readonly PairComparison[], options: LadderOptions = {}): Fit {
  // A scope with no site has an empty ladder. The Bradley-Terry fit refuses 0 items
  if (items === 0) return { strengths: [], se: [], tie: 0 };
  switch (model) {
    case "bradley-terry": {
      const result = bradleyTerry(items, comparisons, { priorSd: options.priorSd ?? 1 });
      return { strengths: result.strengths, se: result.se, tie: result.tie };
    }
    case "elo": {
      const ratings = new Array<number>(items).fill(1500);
      for (const { a, b, outcome } of comparisons) {
        const next = eloUpdate(ratings[a] as number, ratings[b] as number, score(outcome), { k: options.k ?? 32 });
        ratings[a] = next.a;
        ratings[b] = next.b;
      }
      return { strengths: ratings.map((rating) => ratingToStrength(rating)), se: ratings.map(() => undefined), tie: 0 };
    }
    case "glicko2": {
      const players = Array.from({ length: items }, () => ({ rating: 1500, rd: 350, volatility: 0.06 }));
      // Each pick is one rating period of its two sites, so the order of the picks counts, as in Elo
      for (const { a, b, outcome } of comparisons) {
        const pa = players[a] as (typeof players)[number];
        const pb = players[b] as (typeof players)[number];
        players[a] = glicko2Update(pa, [{ rating: pb.rating, rd: pb.rd, score: score(outcome) }]);
        players[b] = glicko2Update(pb, [{ rating: pa.rating, rd: pa.rd, score: 1 - score(outcome) }]);
      }
      return {
        strengths: players.map((player) => ratingToStrength(player.rating)),
        se: players.map((player) => ratingToStrength(1500 + player.rd)),
        tie: 0,
      };
    }
  }
}

/** This function gives the ladder of one scope. */
export function ladderOf(state: State, scope: Scope, options: LadderOptions = {}): Ladder {
  const model = options.model ?? "bradley-terry";
  const picks = picksIn(state, scope);
  const sites = sitesOf(state, scope, picks);
  const index = new Map(sites.map((site, i) => [site, i]));
  const comparisons = comparisonsOf(picks, index);
  const result = fit(model, sites.length, comparisons, options);

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

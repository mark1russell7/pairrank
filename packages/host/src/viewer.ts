/**
 * The viewer of pairrank: the sites that agree with a tag query, in the order of a score. Two Vex programs make the
 * calculation at each site. The filter program reads the tags of the site. The score program gives the mean of the
 * ratings of the site in a set of ladders, and the standard error of that mean.
 */
import { type Expr, type Space, app, axes, each, evaluate, let_, lit, ref, space, v } from "@mark1russell7/vex";
import { BoolDomain, JsonDomain, NumDomain, TextDomain } from "@mark1russell7/vex-domains";
import { type State, type TagQuery, scopeKey, tagsOfQuery } from "@pairrank/core";
import { type LadderOptions, ladderOf } from "@pairrank/ratings";
import type { ViewerInput, ViewerResult, ViewerRow } from "./views.ts";

/** The record of one site in the space of the programs. */
interface SiteRecord {
  /** For each tag of the query: `true` when the site has the tag. */
  readonly has: Readonly<Record<string, boolean>>;
  /** For each scope of the order that has the site: its rating, and the square of its standard error. */
  readonly ratings: Readonly<Record<string, number>>;
  readonly variances: Readonly<Record<string, number>>;
}

const DOMAINS = [NumDomain, BoolDomain, TextDomain, JsonDomain];

/** This function gives the filter program of a query. It reads the field `has` of a site. */
export function filterProgram(query: TagQuery): Expr {
  switch (query.kind) {
    case "all":
      return lit(true);
    case "tag":
      return ref(["has", query.tag]);
    case "not":
      return app("not", filterProgram(query.query));
    default:
      return app(query.kind, ...query.queries.map(filterProgram));
  }
}

/** This function gives the list of the values of a field of a site at each scope key of the variable `scopes`. */
const atEachScope = (field: string): Expr =>
  let_({ values: ref(field) }, each(axes.list(v("scopes")), app("field", v("values"), v("scope")), undefined, ["scope"]));

/**
 * The programs of the score, by field. Each one reads the variable `scopes`. A list op skips a scope that does not have
 * the site, so the mean is over the ladders that have the site.
 */
export const SCORE_PROGRAMS: Readonly<Record<"score" | "se" | "ladders", Expr>> = {
  score: app("mean", atEachScope("ratings")),
  // The standard error of a mean of independent ratings: the square root of the sum of the variances, over the count
  se: let_(
    { variances: atEachScope("variances") },
    app("divide", app("sqrt", app("sum", v("variances"))), app("count", v("variances"))),
  ),
  ladders: app("count", atEachScope("ratings")),
};

const valueOf = (expr: Expr, at: Space<string, SiteRecord>, origin: string, scopes: readonly string[]): unknown => {
  const result = evaluate(expr, { space: at, origin, domains: DOMAINS, vars: { scopes } });
  return result.ok ? result.value : undefined;
};

/** This function gives the sites of the viewer. A hidden site is not in the viewer. */
export function viewerOf(state: State, input: ViewerInput, options: LadderOptions = {}): ViewerResult {
  const sites = [...state.sites.values()].filter((site) => !site.hidden);
  const tags = tagsOfQuery(input.query);
  const scopes = input.order.kind === "rating" ? input.order.scopes : [];
  const keys = scopes.map(scopeKey);
  const ladders = scopes.map((scope) => new Map(ladderOf(state, scope, options).ratings.map((rating) => [rating.site, rating])));

  const records: Record<string, SiteRecord> = {};
  for (const site of sites) {
    const ratings: Record<string, number> = {};
    const variances: Record<string, number> = {};
    ladders.forEach((ladder, i) => {
      const rating = ladder.get(site.id);
      if (rating === undefined) return;
      ratings[keys[i] as string] = rating.rating;
      if (rating.se !== undefined) variances[keys[i] as string] = rating.se ** 2;
    });
    records[site.id] = { has: Object.fromEntries(tags.map((tag) => [tag, site.tags.has(tag)])), ratings, variances };
  }
  const at = space.record(records);
  const filter = filterProgram(input.query);

  const rows: ViewerRow[] = sites
    .filter((site) => valueOf(filter, at, site.id, keys) === true)
    .map((site) => {
      if (scopes.length === 0) return { site: site.id, score: undefined, se: undefined, ladders: 0 };
      const score = valueOf(SCORE_PROGRAMS.score, at, site.id, keys);
      const se = valueOf(SCORE_PROGRAMS.se, at, site.id, keys);
      const count = valueOf(SCORE_PROGRAMS.ladders, at, site.id, keys);
      return {
        site: site.id,
        score: typeof score === "number" ? score : undefined,
        se: typeof se === "number" ? se : undefined,
        ladders: typeof count === "number" ? count : 0,
      };
    });

  // Each sort is stable, so two equal values keep the order of the state
  const order = input.order;
  if (order.kind === "rating") rows.sort((x, y) => (y.score ?? -Infinity) - (x.score ?? -Infinity));
  else if (order.kind === "added") {
    const added = new Map(sites.map((site) => [site.id, site.added]));
    rows.sort((x, y) => (added.get(y.site) ?? "").localeCompare(added.get(x.site) ?? ""));
  } else {
    const names = new Map(sites.map((site) => [site.id, (site.title ?? site.url).toLowerCase()]));
    rows.sort((x, y) => (names.get(x.site) ?? "").localeCompare(names.get(y.site) ?? ""));
  }
  return { rows, total: sites.length };
}

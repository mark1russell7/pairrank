/**
 * The viewer of pairrank: the sites that agree with a tag query, in the order of a score. Two Vex programs make the
 * calculation at each site. The filter program reads the tags of the site. The score program gives the mean of the
 * ratings of the site in a set of ladders, and the standard error of that mean. The mix program gives a log-weight to
 * each site, and `plackettLuceOrder` of `@mark1russell7/rigor-generators` loosens the order of the ratings with these weights.
 */
import { plackettLuceOrder } from "@mark1russell7/rigor-generators";
import { type Expr, type Space, app, axes, each, evaluate, let_, lit, ref, space, v } from "@mark1russell7/vex";
import { BoolDomain, JsonDomain, NumDomain, TextDomain } from "@mark1russell7/vex-domains";
import { type Site, type State, type TagQuery, scopeKey, tagsOfQuery } from "@pairrank/core";
import { type LadderOptions, ladderOf } from "@pairrank/ratings";
import type { ViewerInput, ViewerMix, ViewerResult, ViewerRow } from "./views.ts";

/** The record of one site in the space of the filter program: for each tag of the query, `true` when the site has the tag. */
interface TagsRecord {
  readonly has: Readonly<Record<string, boolean>>;
}

/** The record of one site in the space of the score programs. */
interface SiteRecord {
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

/** The record of one site with a score in the space of the mix program. */
interface MixRecord {
  readonly score: number;
}

/**
 * The program of the log-weight of the mix, at a site with a score. It reads the variables `top` and `temperature`. A
 * difference of 400 in the ratings is a factor of 10 in the strength of Bradley-Terry. Thus `score * ln(10) / 400` is
 * the log of the strength. The program subtracts the highest score `top`, so each log-weight is 0 or less. Thus a low
 * temperature gives minus infinity, not plus infinity.
 *
 * `plackettLuceOrder` adds a Gumbel draw to each log-weight, and sorts by the sums. The chance that a site comes first
 * is then in proportion to its strength to the power `1 / temperature`. Each next place follows the same law over the
 * sites that are left (Plackett-Luce).
 */
export const MIX_PROGRAM: Expr = app("divide", app("multiply", app("subtract", ref("score"), v("top")), lit(Math.LN10 / 400)), v("temperature"));

/** The highest temperature of a mix. At this temperature, the chances of two sites with a rating difference of 400 have the ratio 1.023. */
export const MAX_TEMPERATURE = 100;

/**
 * This function gives the rows with a score in the order of the mix. Each site has its own stream of draws, so a
 * change of the other sites does not change the draw of a site.
 */
function mixed(rows: readonly ViewerRow[], mix: ViewerMix): ViewerRow[] {
  const records: Record<string, MixRecord> = {};
  for (const row of rows) records[row.site] = { score: row.score as number };
  const at = space.record(records);
  const top = rows.reduce((highest, row) => Math.max(highest, row.score as number), Number.NEGATIVE_INFINITY);
  const logWeights = new Map(
    rows.map((row) => {
      const result = evaluate(MIX_PROGRAM, { space: at, origin: row.site, domains: DOMAINS, vars: { top, temperature: mix.temperature } });
      return [row.site, result.ok && typeof result.value === "number" ? result.value : Number.NEGATIVE_INFINITY];
    }),
  );
  return plackettLuceOrder(mix.seed, rows, (row) => logWeights.get(row.site) ?? Number.NEGATIVE_INFINITY, (row) => row.site);
}

const valueOf = (expr: Expr, at: Space<string, SiteRecord>, origin: string, scopes: readonly string[]): unknown => {
  const result = evaluate(expr, { space: at, origin, domains: DOMAINS, vars: { scopes } });
  return result.ok ? result.value : undefined;
};

/** This function gives the sites that agree with a query, in the order of the state. A hidden site is not in the result. */
export function sitesOfQuery(state: State, query: TagQuery): Site[] {
  const sites = [...state.sites.values()].filter((site) => !site.hidden);
  if (query.kind === "all") return sites;
  const tags = tagsOfQuery(query);
  const at: Space<string, TagsRecord> = space.record(
    Object.fromEntries(sites.map((site) => [site.id, { has: Object.fromEntries(tags.map((tag) => [tag, site.tags.has(tag)])) }])),
  );
  const filter = filterProgram(query);
  return sites.filter((site) => {
    const result = evaluate(filter, { space: at, origin: site.id, domains: DOMAINS });
    return result.ok && result.value === true;
  });
}

/** This function gives the sites of the viewer. A hidden site is not in the viewer. */
export function viewerOf(state: State, input: ViewerInput, options: LadderOptions = {}): ViewerResult {
  const shown = [...state.sites.values()].filter((site) => !site.hidden).length;
  const sites = sitesOfQuery(state, input.query);
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
    records[site.id] = { ratings, variances };
  }
  const at = space.record(records);

  const rows: ViewerRow[] = sites.map((site) => {
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
  // A site with no score comes after each site with a score
  if (order.kind === "rating") {
    rows.sort((x, y) => (x.score === undefined ? (y.score === undefined ? 0 : 1) : y.score === undefined ? -1 : y.score - x.score));
    // The mix changes only the order of the sites with a score. The sites with no score stay last.
    if (order.mix !== undefined && order.mix.temperature > 0) {
      const scored = rows.filter((row) => row.score !== undefined);
      return { rows: [...mixed(scored, order.mix), ...rows.slice(scored.length)], total: shown };
    }
  } else if (order.kind === "added") {
    const added = new Map(sites.map((site) => [site.id, site.added]));
    rows.sort((x, y) => (added.get(y.site) ?? "").localeCompare(added.get(x.site) ?? ""));
  } else {
    const names = new Map(sites.map((site) => [site.id, (site.title ?? site.url).toLowerCase()]));
    rows.sort((x, y) => (names.get(x.site) ?? "").localeCompare(names.get(y.site) ?? ""));
  }
  return { rows, total: shown };
}

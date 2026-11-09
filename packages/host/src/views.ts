/**
 * The values that the host sends to the interface. This module has no Node.js code, so the interface imports it with
 * no store (`@pairrank/host/views`).
 */
import { type Problem, type QueryProblem, type Scope, type SiteId, type State, type TagQuery, scopeKey } from "@pairrank/core";
import type { EntryProblem, ImportReport } from "@pairrank/input";

/** One site, as a value that a port can send. */
export interface SiteView {
  readonly id: string;
  readonly url: string;
  readonly title: string | undefined;
  readonly source: string | undefined;
  readonly added: string;
  readonly dated: string | undefined;
  readonly hidden: boolean;
  readonly hiddenReason: string | undefined;
  readonly tags: readonly string[];
}

/** One tag, as a value that a port can send. */
export interface TagView {
  readonly id: string;
  readonly name: string;
  readonly color: string | undefined;
  readonly key: string | undefined;
  readonly sites: number;
}

/** The view of the state: the sites, the tags, and the count of picks in each scope. */
export interface StateView {
  readonly sites: readonly SiteView[];
  readonly tags: readonly TagView[];
  /** The count of picks that are not skips, for each scope key (`overall` or `tag:<id>`). */
  readonly picks: Readonly<Record<string, number>>;
  /** The count of events that the rules refused at the last replay. */
  readonly problems: number;
}

/** The result of `pairrank.apply`. */
export interface ApplyResult {
  /** The id of each event, in the order of the drafts. A refused draft also gets an id, which its problem names. */
  readonly events: readonly string[];
  readonly problems: readonly Problem[];
}

/** The result of an import plan. */
export interface ImportPreview {
  readonly report: ImportReport;
  /** The entries of the list that are not valid. The import skips them. */
  readonly entries: readonly EntryProblem[];
}

/** The result of an import. */
export interface ImportResult extends ImportPreview {
  /** The events that the rules refused. A correct plan gives none. */
  readonly problems: readonly Problem[];
}

/**
 * The order of the viewer. A `rating` order gives the mean rating of each site over the ladders of its scopes, from the
 * highest. A site with no rating in each of the scopes comes last. `added` gives the newest site first.
 */
export type ViewerOrder = { readonly kind: "rating"; readonly scopes: readonly Scope[] } | { readonly kind: "title" } | { readonly kind: "added" };

/** The input of the viewer: a query as data, and an order. */
export interface ViewerInput {
  readonly query: TagQuery;
  readonly order: ViewerOrder;
}

/** One site of the viewer. */
export interface ViewerRow {
  readonly site: SiteId;
  /** The mean rating over the ladders of the order that have the site, or `undefined` when none has it. */
  readonly score: number | undefined;
  /** The standard error of the mean rating. Elo has no standard error, so it gives `undefined`. */
  readonly se: number | undefined;
  /** The count of the ladders of the order that have the site. */
  readonly ladders: number;
}

/** The result of the viewer: the sites in their order, and the count of the sites that are not hidden. */
export interface ViewerResult {
  readonly rows: readonly ViewerRow[];
  readonly total: number;
}

/** The answer of `pairrank.viewer`: the sites and the text of the query, or the problem of the text of the query. */
export type ViewerAnswer = (ViewerResult & { readonly ok: true; readonly query: string }) | { readonly ok: false; readonly problem: QueryProblem };

/** This function gives the view of a state. */
export function viewOf(state: State, problems: number): StateView {
  const counts = new Map<string, number>();
  for (const site of state.sites.values()) for (const tag of site.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  const picks: Record<string, number> = {};
  for (const pick of state.picks.values()) {
    if (pick.outcome === "skip") continue;
    const key = scopeKey(pick.scope);
    picks[key] = (picks[key] ?? 0) + 1;
  }
  return {
    sites: [...state.sites.values()].map((site) => ({
      id: site.id,
      url: site.url,
      title: site.title,
      source: site.source,
      added: site.added,
      dated: site.dated,
      hidden: site.hidden,
      hiddenReason: site.hiddenReason,
      tags: [...site.tags],
    })),
    tags: [...state.tags.values()].map((tag) => ({ id: tag.id, name: tag.name, color: tag.color, key: tag.key, sites: counts.get(tag.id) ?? 0 })),
    picks,
    problems,
  };
}

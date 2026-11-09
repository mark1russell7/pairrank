/**
 * The settings of the viewer on the Sites screen, with no React. They are the text of the tag query, the order, and
 * the tags of a mean. The app keeps the settings while the user is on another screen.
 */
import type { TagView, ViewerOrder } from "@pairrank/host/views";

/** The settings of the viewer. The order is the value of a choice: `added`, `title`, `overall`, `tag:<id>` or `mean`. */
export interface ViewerSettings {
  readonly query: string;
  readonly order: string;
  /** The tags of the order `mean`. */
  readonly mean: readonly string[];
}

/** The settings at the start: no query, and the newest sites first. */
export const FIRST_SETTINGS: ViewerSettings = { query: "", order: "added", mean: [] };

/** This function gives the order of the settings, or `undefined` for a mean with no tags. A value that it does not know gives `added`. */
export function orderOf(settings: ViewerSettings): ViewerOrder | undefined {
  const { order } = settings;
  if (order === "title") return { kind: "title" };
  if (order === "overall") return { kind: "rating", scopes: [{ kind: "overall" }] };
  if (order.startsWith("tag:") && order.length > "tag:".length) return { kind: "rating", scopes: [{ kind: "tag", tag: order.slice("tag:".length) }] };
  if (order === "mean") return settings.mean.length === 0 ? undefined : { kind: "rating", scopes: settings.mean.map((tag) => ({ kind: "tag", tag })) };
  return { kind: "added" };
}

/** One choice of the order: its value and its name. */
export interface OrderChoice {
  readonly value: string;
  readonly name: string;
}

/** This function gives the choices of the order. Each tag has its ladder. */
export function orderChoices(tags: readonly TagView[]): OrderChoice[] {
  return [
    { value: "added", name: "Newest first" },
    { value: "title", name: "Title" },
    { value: "overall", name: "Rating overall" },
    ...[...tags].sort((a, b) => a.name.localeCompare(b.name)).map((tag) => ({ value: `tag:${tag.id}`, name: `Rating in ${tag.name}` })),
    { value: "mean", name: "Mean rating of tags" },
  ];
}

/** This function gives the text of a rating and its standard error, for example `1623 ± 45`. */
export function ratingText(score: number, se: number | undefined): string {
  return se === undefined ? `${Math.round(score)}` : `${Math.round(score)} ± ${Math.round(se)}`;
}

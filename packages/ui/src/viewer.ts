/**
 * The settings of the viewer on the Sites screen, with no React. They are the text of the tag query, the order, the
 * tags of a mean, and the mix of an order by rating. The app keeps the settings while the user is on another screen.
 */
import type { TagView, ViewerOrder } from "@pairrank/host/views";

/** The settings of the viewer. The order is the value of a choice: `added`, `title`, `overall`, `tag:<id>` or `mean`. */
export interface ViewerSettings {
  readonly query: string;
  readonly order: string;
  /** The tags of the order `mean`. */
  readonly mean: readonly string[];
  /** The temperature of the mix of an order by rating. The value 0 keeps the strict order. */
  readonly temperature: number;
  /** The seed of the mix. The button "Shuffle again" adds 1. */
  readonly seed: number;
}

/** The settings at the start: no query, the newest sites first, and no mix. */
export const FIRST_SETTINGS: ViewerSettings = { query: "", order: "added", mean: [], temperature: 0, seed: 1 };

/** One level of the mix: its temperature, its name, and the words that tell what it does. */
export interface MixLevel {
  readonly temperature: number;
  readonly name: string;
  readonly hint: string;
}

/** The levels of the mix, from no mix. At the temperature 1, the chances follow the strengths of the ratings. */
export const MIX_LEVELS: readonly MixLevel[] = [
  { temperature: 0, name: "None", hint: "The order follows the ratings." },
  { temperature: 0.5, name: "Low", hint: "Sites with near ratings change places. A much lower rating seldom moves up." },
  { temperature: 1, name: "Fair", hint: "The chance that a site comes first follows the strength of its rating." },
  { temperature: 2, name: "High", hint: "A site with a low rating often moves up." },
  { temperature: 8, name: "Near random", hint: "The order is near a random shuffle. The ratings change it only a little." },
];

/** This function gives the index of the level of a temperature. A temperature that no level has gives the nearest level. */
export function mixLevelOf(temperature: number): number {
  let best = 0;
  MIX_LEVELS.forEach((level, i) => {
    if (Math.abs(level.temperature - temperature) < Math.abs((MIX_LEVELS[best] as MixLevel).temperature - temperature)) best = i;
  });
  return best;
}

/**
 * This function gives the order of the settings, or `undefined` for a mean with no tags. A value that it does not know
 * gives `added`. An order by rating gets the mix when the temperature is more than 0.
 */
export function orderOf(settings: ViewerSettings): ViewerOrder | undefined {
  const { order } = settings;
  if (order === "title") return { kind: "title" };
  const mix = settings.temperature > 0 ? { mix: { temperature: settings.temperature, seed: settings.seed } } : {};
  if (order === "overall") return { kind: "rating", scopes: [{ kind: "overall" }], ...mix };
  if (order.startsWith("tag:") && order.length > "tag:".length) return { kind: "rating", scopes: [{ kind: "tag", tag: order.slice("tag:".length) }], ...mix };
  if (order === "mean") return settings.mean.length === 0 ? undefined : { kind: "rating", scopes: settings.mean.map((tag) => ({ kind: "tag", tag })), ...mix };
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

/**
 * The events of the log. The log is the source of truth: the state and each rating come from a replay of the log.
 *
 * @packageDocumentation
 */

/** The id of a site. */
export type SiteId = string;

/** The id of a tag. A rename keeps the id, so the picks under the tag stay correct. */
export type TagId = string;

/** The id of an event. */
export type EventId = string;

/** The scope of a pick: the overall ladder, or the ladder of one tag. */
export type Scope = { readonly kind: "overall" } | { readonly kind: "tag"; readonly tag: TagId };

/** The result of a pick. `skip` keeps the record of the pair, but it gives no data to a rating. */
export type Outcome = "a" | "b" | "tie" | "skip";

/** The fields of each event. `at` is an ISO 8601 time. */
interface Base {
  readonly id: EventId;
  readonly at: string;
}

/** This event adds a site. */
export interface SiteAdded extends Base {
  readonly type: "site.added";
  readonly site: SiteId;
  readonly url: string;
  readonly title?: string;
  /** The source of the site, for example `chrome-bookmarks`. */
  readonly source?: string;
  /** The ISO 8601 time that the source gives for the site, for example the date of a bookmark. */
  readonly dated?: string;
}

/** This event changes the URL or the title of a site. */
export interface SiteEdited extends Base {
  readonly type: "site.edited";
  readonly site: SiteId;
  readonly url?: string;
  readonly title?: string;
}

/** This event hides a site. A hidden site is not in the pairs or the viewer. Its picks stay in the ratings. */
export interface SiteHidden extends Base {
  readonly type: "site.hidden";
  readonly site: SiteId;
  readonly reason?: string;
}

/** This event shows a hidden site again. */
export interface SiteRestored extends Base {
  readonly type: "site.restored";
  readonly site: SiteId;
}

/** This event makes a tag. */
export interface TagCreated extends Base {
  readonly type: "tag.created";
  readonly tag: TagId;
  readonly name: string;
  readonly color?: string;
  readonly key?: string;
}

/** This event changes the name, the color or the key of a tag. A `null` value removes the color or the key. */
export interface TagEdited extends Base {
  readonly type: "tag.edited";
  readonly tag: TagId;
  readonly name?: string;
  readonly color?: string | null;
  readonly key?: string | null;
}

/** This event merges the tag `tag` into the tag `into`. The sites and the picks of `tag` go to `into`. */
export interface TagMerged extends Base {
  readonly type: "tag.merged";
  readonly tag: TagId;
  readonly into: TagId;
}

/** This event deletes a tag. Its picks stay in the log, but they leave each ladder. */
export interface TagDeleted extends Base {
  readonly type: "tag.deleted";
  readonly tag: TagId;
}

/** This event puts a tag on a site. */
export interface SiteTagged extends Base {
  readonly type: "site.tagged";
  readonly site: SiteId;
  readonly tag: TagId;
}

/** This event removes a tag from a site. The past picks of the site under the tag stay in the ladder. */
export interface SiteUntagged extends Base {
  readonly type: "site.untagged";
  readonly site: SiteId;
  readonly tag: TagId;
}

/** This event records one pick between the sites `a` and `b`, under one scope. */
export interface Picked extends Base {
  readonly type: "pick";
  readonly a: SiteId;
  readonly b: SiteId;
  readonly scope: Scope;
  readonly outcome: Outcome;
  /** The id of the duel that showed the pair. The picks of one screen have one duel id. */
  readonly duel?: string;
}

/** This event removes an earlier pick from the ratings. */
export interface PickUndone extends Base {
  readonly type: "pick.undone";
  readonly pick: EventId;
}

/** One event of the log. */
export type Event =
  | SiteAdded
  | SiteEdited
  | SiteHidden
  | SiteRestored
  | TagCreated
  | TagEdited
  | TagMerged
  | TagDeleted
  | SiteTagged
  | SiteUntagged
  | Picked
  | PickUndone;

/** The type words of the events. */
export type EventType = Event["type"];

/** Each type word of the events, in the order of the union. */
export const EVENT_TYPES: readonly EventType[] = [
  "site.added",
  "site.edited",
  "site.hidden",
  "site.restored",
  "tag.created",
  "tag.edited",
  "tag.merged",
  "tag.deleted",
  "site.tagged",
  "site.untagged",
  "pick",
  "pick.undone",
];

const TYPES = new Set<string>(EVENT_TYPES);

/**
 * This function changes a stored value into an event. It examines the id, the time and the type word. The rules of the
 * state examine the other fields.
 *
 * @throws Error when the value is not an object with a text `id`, a text `at` and a known `type`
 */
export function parseEvent(value: unknown): Event {
  if (typeof value !== "object" || value === null) throw new Error("An event must be an object.");
  const record = value as { readonly id?: unknown; readonly at?: unknown; readonly type?: unknown };
  if (typeof record.id !== "string" || record.id === "") throw new Error("An event must have a text id.");
  if (typeof record.at !== "string" || Number.isNaN(Date.parse(record.at))) throw new Error(`The event ${record.id} must have an ISO time at.`);
  if (typeof record.type !== "string" || !TYPES.has(record.type)) throw new Error(`The event ${record.id} has an unknown type ${String(record.type)}.`);
  return value as Event;
}

/** This function gives the key of a scope: `overall`, or `tag:<id>`. */
export function scopeKey(scope: Scope): string {
  return scope.kind === "overall" ? "overall" : `tag:${scope.tag}`;
}

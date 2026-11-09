/**
 * The events of the log. The log is the source of truth: the state and each rating come from a replay of the log.
 *
 * @packageDocumentation
 */

import { type TagQuery, isTagQuery } from "./query.ts";

/** The id of a site. */
export type SiteId = string;

/** The id of a tag. A rename keeps the id, so the picks under the tag stay correct. */
export type TagId = string;

/** The id of an event. */
export type EventId = string;

/** The scope of a pick: the overall ladder, or the ladder of one tag. */
export type Scope = { readonly kind: "overall" } | { readonly kind: "tag"; readonly tag: TagId };

/** The id of a duel mode. */
export type ModeId = string;

/**
 * One ask of a duel mode: a pick overall, a pick under one tag, or a pick under each tag of the two sites. A tag ask
 * applies to a pair only when the two sites have the tag.
 */
export type Ask = { readonly kind: "overall" } | { readonly kind: "tag"; readonly tag: TagId } | { readonly kind: "shared" };

/** The most asks of a duel mode. */
export const MAX_ASKS = 100;

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

/**
 * This event saves a duel mode: a pool of sites and the asks of each pair. A save with the id of a mode replaces that
 * mode. The pool is a tag query. The duel shows two sites of the pool that have an ask in common.
 */
export interface ModeSaved extends Base {
  readonly type: "mode.saved";
  readonly mode: ModeId;
  readonly name: string;
  readonly pool: TagQuery;
  readonly asks: readonly Ask[];
}

/** This event deletes a duel mode. The picks of its duels stay. */
export interface ModeDeleted extends Base {
  readonly type: "mode.deleted";
  readonly mode: ModeId;
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
  | PickUndone
  | ModeSaved
  | ModeDeleted;

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
  "mode.saved",
  "mode.deleted",
];

/** The kind of one field. It is a text that is not empty, an optional text, a text or `null`, a scope or an outcome. It can also be a query or a list of asks. */
type FieldKind = "id" | "text?" | "time?" | "nullable?" | "scope" | "outcome" | "query" | "asks";

/** The fields of each type, other than `id`, `at` and `type`. An event can have no other fields. */
const FIELDS: { readonly [T in EventType]: Readonly<Record<string, FieldKind>> } = {
  "site.added": { site: "id", url: "id", title: "text?", source: "text?", dated: "time?" },
  "site.edited": { site: "id", url: "text?", title: "text?" },
  "site.hidden": { site: "id", reason: "text?" },
  "site.restored": { site: "id" },
  "tag.created": { tag: "id", name: "id", color: "text?", key: "text?" },
  "tag.edited": { tag: "id", name: "text?", color: "nullable?", key: "nullable?" },
  "tag.merged": { tag: "id", into: "id" },
  "tag.deleted": { tag: "id" },
  "site.tagged": { site: "id", tag: "id" },
  "site.untagged": { site: "id", tag: "id" },
  pick: { a: "id", b: "id", scope: "scope", outcome: "outcome", duel: "text?" },
  "pick.undone": { pick: "id" },
  "mode.saved": { mode: "id", name: "id", pool: "query", asks: "asks" },
  "mode.deleted": { mode: "id" },
};

const OUTCOMES = new Set<unknown>(["a", "b", "tie", "skip"]);

const isTime = (value: unknown): boolean => typeof value === "string" && !Number.isNaN(Date.parse(value));

function fieldIsValid(kind: FieldKind, value: unknown): boolean {
  switch (kind) {
    case "id":
      return typeof value === "string" && value !== "";
    case "text?":
      return value === undefined || typeof value === "string";
    case "time?":
      return value === undefined || isTime(value);
    case "nullable?":
      return value === undefined || value === null || typeof value === "string";
    case "outcome":
      return OUTCOMES.has(value);
    case "scope":
      return isScope(value);
    case "query":
      return isTagQuery(value);
    case "asks":
      return Array.isArray(value) && value.length >= 1 && value.length <= MAX_ASKS && value.every((ask) => isAsk(ask));
  }
}

function isScope(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const scope = value as { kind?: unknown; tag?: unknown };
  const keys = Object.keys(scope);
  if (scope.kind === "overall") return keys.length === 1;
  return scope.kind === "tag" && typeof scope.tag === "string" && scope.tag !== "" && keys.length === 2;
}

function isAsk(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return (value as { kind?: unknown }).kind === "shared" ? Object.keys(value).length === 1 : isScope(value);
}

/** This function gives the problem of the fields of a draft (an event with no `id` and no `at`), or `undefined`. */
function draftProblem(record: Readonly<Record<string, unknown>>): string | undefined {
  const type = record["type"];
  if (typeof type !== "string" || !Object.hasOwn(FIELDS, type)) return `The type ${String(type)} is not known.`;
  const fields = FIELDS[type as EventType];
  for (const [name, kind] of Object.entries(fields)) {
    if (!fieldIsValid(kind, record[name])) return `The field ${name} of a ${type} event is not valid.`;
  }
  for (const name of Object.keys(record)) {
    if (name !== "type" && name !== "id" && name !== "at" && !Object.hasOwn(fields, name)) return `A ${type} event has no field ${name}.`;
  }
  return undefined;
}

function recordOf(value: unknown, what: string): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${what} must be an object.`);
  return value as Readonly<Record<string, unknown>>;
}

/**
 * This function changes a stored value into an event. It examines the id, the time, the type word and each field of the
 * type. The rules of the state examine the relations between events.
 *
 * @throws Error when the value is not a valid event
 */
export function parseEvent(value: unknown): Event {
  const record = recordOf(value, "An event");
  const id = record["id"];
  if (typeof id !== "string" || id === "") throw new Error("An event must have a text id.");
  if (!isTime(record["at"])) throw new Error(`The event ${id} must have an ISO time at.`);
  const problem = draftProblem(record);
  if (problem !== undefined) throw new Error(`The event ${id} is not valid. ${problem}`);
  return value as Event;
}

/** An event with no `id` and no `at`. The host gives them when it writes the event. */
export type Draft = Event extends infer E ? (E extends Event ? Omit<E, "id" | "at"> : never) : never;

/**
 * This function changes a value from a caller into a draft. It examines the type word and each field of the type.
 *
 * @throws Error when the value is not a valid draft
 */
export function parseDraft(value: unknown): Draft {
  const record = recordOf(value, "A draft");
  if (record["id"] !== undefined || record["at"] !== undefined) throw new Error("A draft has no id and no at. The host gives them.");
  const problem = draftProblem(record);
  if (problem !== undefined) throw new Error(problem);
  return value as Draft;
}

/** This function makes an event from a draft, an id and a time. */
export function stamp(draft: Draft, id: EventId, at: string): Event {
  return { ...draft, id, at } as Event;
}

/** This function gives the key of a scope: `overall`, or `tag:<id>`. */
export function scopeKey(scope: Scope): string {
  return scope.kind === "overall" ? "overall" : `tag:${scope.tag}`;
}

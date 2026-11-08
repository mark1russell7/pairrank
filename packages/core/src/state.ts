/**
 * The state that a replay of the log gives, and the rules that each event must obey.
 *
 * @packageDocumentation
 */
import { type Event, type EventId, type Outcome, type Scope, type SiteId, type TagId, scopeKey } from "./events.ts";

/** One site of the state. `tags` holds the current tags of the site. */
export interface Site {
  readonly id: SiteId;
  url: string;
  title: string | undefined;
  readonly source: string | undefined;
  readonly added: string;
  hidden: boolean;
  hiddenReason: string | undefined;
  readonly tags: Set<TagId>;
}

/** One tag of the state. */
export interface Tag {
  readonly id: TagId;
  name: string;
  color: string | undefined;
  key: string | undefined;
  readonly created: string;
}

/** One pick of the state. A merge of tags changes its scope to the tag that stays. */
export interface Pick {
  readonly id: EventId;
  readonly at: string;
  readonly a: SiteId;
  readonly b: SiteId;
  scope: Scope;
  readonly outcome: Outcome;
  readonly duel: string | undefined;
}

/** The state of the app. The functions of this module change it, and no other code changes it. */
export interface State {
  readonly sites: Map<SiteId, Site>;
  readonly tags: Map<TagId, Tag>;
  /** The picks that count, in the order of the log. A pick that is undone, or under a deleted tag, is not here. */
  readonly picks: Map<EventId, Pick>;
  /** The ids of all events that the state accepted. */
  readonly events: Set<EventId>;
  /** The tags that were merged into another tag, or deleted. Each later event that names one of them is a problem. */
  readonly retired: Map<TagId, "merged" | "deleted">;
  readonly urls: Map<string, SiteId>;
}

/** The words of the problems. */
export type ProblemCode =
  | "duplicate-event"
  | "duplicate-site"
  | "duplicate-url"
  | "unknown-site"
  | "duplicate-tag"
  | "duplicate-name"
  | "duplicate-key"
  | "unknown-tag"
  | "retired-tag"
  | "same-site"
  | "same-tag"
  | "hidden-site"
  | "not-hidden"
  | "missing-tag"
  | "unknown-pick"
  | "empty-name";

/** A problem is an event that breaks a rule. The state does not change for that event. */
export interface Problem {
  readonly event: EventId;
  readonly code: ProblemCode;
  readonly message: string;
}

/** This function makes an empty state. */
export function createState(): State {
  return { sites: new Map(), tags: new Map(), picks: new Map(), events: new Set(), retired: new Map(), urls: new Map() };
}

/** This class carries a problem out of the checks of one event. */
class Refusal extends Error {
  readonly code: ProblemCode;

  constructor(code: ProblemCode, message: string) {
    super(message);
    this.code = code;
  }
}

function refuse(code: ProblemCode, message: string): never {
  throw new Refusal(code, message);
}

function siteOf(state: State, id: SiteId): Site {
  return state.sites.get(id) ?? refuse("unknown-site", `There is no site ${id}.`);
}

function tagOf(state: State, id: TagId): Tag {
  const retired = state.retired.get(id);
  if (retired) refuse("retired-tag", `The tag ${id} was ${retired}.`);
  return state.tags.get(id) ?? refuse("unknown-tag", `There is no tag ${id}.`);
}

function checkName(state: State, name: string, self?: TagId): void {
  if (name.trim() === "") refuse("empty-name", "A tag name must not be empty.");
  const folded = name.trim().toLowerCase();
  for (const tag of state.tags.values()) {
    if (tag.id !== self && tag.name.trim().toLowerCase() === folded) refuse("duplicate-name", `The tag ${tag.id} has the name "${tag.name}".`);
  }
}

function checkKey(state: State, key: string | undefined, self?: TagId): void {
  if (key === undefined) return;
  for (const tag of state.tags.values()) {
    if (tag.id !== self && tag.key === key) refuse("duplicate-key", `The tag ${tag.id} has the key "${key}".`);
  }
}

function checkUrl(state: State, url: string, self?: SiteId): void {
  const owner = state.urls.get(url);
  if (owner !== undefined && owner !== self) refuse("duplicate-url", `The site ${owner} has the URL ${url}.`);
}

/** This function removes a tag from each site and moves the picks under it, or removes them when `into` is not given. */
function moveTag(state: State, tag: TagId, into: TagId | undefined): void {
  for (const site of state.sites.values()) {
    if (site.tags.delete(tag) && into !== undefined) site.tags.add(into);
  }
  for (const [id, pick] of state.picks) {
    if (pick.scope.kind !== "tag" || pick.scope.tag !== tag) continue;
    if (into === undefined) state.picks.delete(id);
    else pick.scope = { kind: "tag", tag: into };
  }
}

/** This function makes the change of one event. It examines each rule first, so a refused event changes nothing. */
function change(state: State, event: Event): void {
  switch (event.type) {
    case "site.added": {
      if (state.sites.has(event.site)) refuse("duplicate-site", `The site ${event.site} exists.`);
      checkUrl(state, event.url);
      state.sites.set(event.site, {
        id: event.site,
        url: event.url,
        title: event.title,
        source: event.source,
        added: event.at,
        hidden: false,
        hiddenReason: undefined,
        tags: new Set(),
      });
      state.urls.set(event.url, event.site);
      return;
    }
    case "site.edited": {
      const site = siteOf(state, event.site);
      if (event.url !== undefined) {
        checkUrl(state, event.url, site.id);
        state.urls.delete(site.url);
        state.urls.set(event.url, site.id);
        site.url = event.url;
      }
      if (event.title !== undefined) site.title = event.title;
      return;
    }
    case "site.hidden": {
      const site = siteOf(state, event.site);
      if (site.hidden) refuse("hidden-site", `The site ${site.id} is hidden.`);
      site.hidden = true;
      site.hiddenReason = event.reason;
      return;
    }
    case "site.restored": {
      const site = siteOf(state, event.site);
      if (!site.hidden) refuse("not-hidden", `The site ${site.id} is not hidden.`);
      site.hidden = false;
      site.hiddenReason = undefined;
      return;
    }
    case "tag.created": {
      if (state.tags.has(event.tag) || state.retired.has(event.tag)) refuse("duplicate-tag", `The tag ${event.tag} exists.`);
      checkName(state, event.name);
      checkKey(state, event.key);
      state.tags.set(event.tag, { id: event.tag, name: event.name.trim(), color: event.color, key: event.key, created: event.at });
      return;
    }
    case "tag.edited": {
      const tag = tagOf(state, event.tag);
      if (event.name !== undefined) checkName(state, event.name, tag.id);
      if (event.key !== undefined && event.key !== null) checkKey(state, event.key, tag.id);
      if (event.name !== undefined) tag.name = event.name.trim();
      if (event.color !== undefined) tag.color = event.color ?? undefined;
      if (event.key !== undefined) tag.key = event.key ?? undefined;
      return;
    }
    case "tag.merged": {
      if (event.tag === event.into) refuse("same-tag", `A tag cannot merge into itself (${event.tag}).`);
      tagOf(state, event.tag);
      tagOf(state, event.into);
      moveTag(state, event.tag, event.into);
      state.tags.delete(event.tag);
      state.retired.set(event.tag, "merged");
      return;
    }
    case "tag.deleted": {
      tagOf(state, event.tag);
      moveTag(state, event.tag, undefined);
      state.tags.delete(event.tag);
      state.retired.set(event.tag, "deleted");
      return;
    }
    case "site.tagged": {
      const site = siteOf(state, event.site);
      tagOf(state, event.tag);
      site.tags.add(event.tag);
      return;
    }
    case "site.untagged": {
      const site = siteOf(state, event.site);
      tagOf(state, event.tag);
      if (!site.tags.has(event.tag)) refuse("missing-tag", `The site ${site.id} does not have the tag ${event.tag}.`);
      site.tags.delete(event.tag);
      return;
    }
    case "pick": {
      if (event.a === event.b) refuse("same-site", `A pick needs two different sites (${event.a}).`);
      const sites = [siteOf(state, event.a), siteOf(state, event.b)];
      for (const site of sites) if (site.hidden) refuse("hidden-site", `The site ${site.id} is hidden.`);
      if (event.scope.kind === "tag") {
        const tag = tagOf(state, event.scope.tag);
        for (const site of sites) {
          if (!site.tags.has(tag.id)) refuse("missing-tag", `The site ${site.id} does not have the tag ${tag.id}.`);
        }
      }
      state.picks.set(event.id, {
        id: event.id,
        at: event.at,
        a: event.a,
        b: event.b,
        scope: event.scope,
        outcome: event.outcome,
        duel: event.duel,
      });
      return;
    }
    case "pick.undone": {
      if (!state.picks.has(event.pick)) refuse("unknown-pick", `There is no pick ${event.pick} that counts.`);
      state.picks.delete(event.pick);
      return;
    }
  }
}

/**
 * This function applies one event to the state.
 *
 * @returns a problem when the event breaks a rule, and then the state does not change
 */
export function apply(state: State, event: Event): Problem | undefined {
  try {
    if (state.events.has(event.id)) refuse("duplicate-event", `The event ${event.id} is in the log.`);
    change(state, event);
    state.events.add(event.id);
    return undefined;
  } catch (error) {
    if (error instanceof Refusal) return { event: event.id, code: error.code, message: error.message };
    throw error;
  }
}

/** The result of a replay. */
export interface Replay {
  readonly state: State;
  readonly problems: readonly Problem[];
}

/** This function replays a log in its order. It applies each event that obeys the rules, and it lists the others. */
export function replay(events: Iterable<Event>): Replay {
  const state = createState();
  const problems: Problem[] = [];
  for (const event of events) {
    const problem = apply(state, event);
    if (problem) problems.push(problem);
  }
  return { state, problems };
}

/** This function gives the picks of one scope that count, with no skips, in the order of the log. */
export function picksIn(state: State, scope: Scope): Pick[] {
  const key = scopeKey(scope);
  return [...state.picks.values()].filter((pick) => pick.outcome !== "skip" && scopeKey(pick.scope) === key);
}

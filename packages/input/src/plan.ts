/**
 * The plan of an import: the events that put a site list into the log. The plan changes nothing. The caller shows the
 * report, and then appends the events.
 */
import type { Event, SiteId, State, TagId } from "@pairrank/core";
import type { SiteList } from "./format.ts";

/** The options of a plan. */
export interface PlanOptions {
  /**
   * This function gives the key of a URL. Two URLs with one key are one site. The app gives `canonicalUrl` of
   * `polite-crawler`. The key is only for the comparison: each site keeps its URL as the source gives it.
   */
  readonly key: (url: string) => string;
  /** This function gives a new id for each event, site and tag. */
  readonly id: () => string;
  /** The ISO 8601 time of the import. Each event gets this time. */
  readonly at: string;
}

/** What an import does. */
export interface ImportReport {
  /** The count of new sites. */
  readonly added: number;
  /** The count of entries that have the key of an earlier entry of the list. Their tags go to the earlier entry. */
  readonly merged: number;
  /** The count of entries that have the key of a site of the state. Their new tags go to that site. */
  readonly existing: number;
  /** The count of tags that the import puts on sites. */
  readonly tagged: number;
  /** The names of the new tags. */
  readonly tagsCreated: readonly string[];
}

/** A plan: the events in their order, and the report. */
export interface ImportPlan {
  readonly events: readonly Event[];
  readonly report: ImportReport;
}

interface Draft {
  readonly site: SiteId;
  readonly url: string;
  title: string | undefined;
  dated: string | undefined;
  readonly tags: Set<TagId>;
  /** The tags of the site before the import. They are not tagged again. */
  readonly had: ReadonlySet<TagId>;
  readonly isNew: boolean;
}

function earlier(a: string | undefined, b: string | undefined): string | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Date.parse(b) < Date.parse(a) ? b : a;
}

/**
 * This function plans the import of a site list into a state. Entries with one key become one site, with the tags of
 * each entry. The plan finds a tag by its name, with no difference between capitals and small letters.
 */
export function planImport(state: State, list: SiteList, options: PlanOptions): ImportPlan {
  const { key, id, at } = options;
  const keyOf = (url: string): string => {
    try {
      return key(url);
    } catch {
      return url;
    }
  };

  const tagByName = new Map<string, TagId>();
  for (const tag of state.tags.values()) tagByName.set(tag.name.trim().toLowerCase(), tag.id);
  const created: { tag: TagId; name: string }[] = [];
  const tagFor = (name: string): TagId | undefined => {
    const trimmed = name.trim();
    if (trimmed === "") return undefined;
    const folded = trimmed.toLowerCase();
    let tag = tagByName.get(folded);
    if (tag === undefined) {
      tag = id();
      tagByName.set(folded, tag);
      created.push({ tag, name: trimmed });
    }
    return tag;
  };

  const existingByKey = new Map<string, SiteId>();
  for (const site of state.sites.values()) existingByKey.set(keyOf(site.url), site.id);

  const drafts = new Map<string, Draft>();
  let merged = 0;
  let existing = 0;
  for (const entry of list.sites) {
    const k = keyOf(entry.url);
    let draft = drafts.get(k);
    if (draft !== undefined) {
      merged += 1;
      draft.title ??= entry.title;
      draft.dated = earlier(draft.dated, entry.dated);
    } else {
      const owner = existingByKey.get(k);
      const site = owner === undefined ? undefined : state.sites.get(owner);
      if (site !== undefined) existing += 1;
      draft = {
        site: site?.id ?? id(),
        url: site?.url ?? entry.url,
        title: entry.title,
        dated: entry.dated,
        tags: new Set(),
        had: site?.tags ?? new Set(),
        isNew: site === undefined,
      };
      drafts.set(k, draft);
    }
    for (const name of entry.tags ?? []) {
      const tag = tagFor(name);
      if (tag !== undefined) draft.tags.add(tag);
    }
  }

  const events: Event[] = [];
  for (const { tag, name } of created) events.push({ type: "tag.created", id: id(), at, tag, name });
  let added = 0;
  for (const draft of drafts.values()) {
    if (!draft.isNew) continue;
    added += 1;
    events.push({
      type: "site.added",
      id: id(),
      at,
      site: draft.site,
      url: draft.url,
      source: list.source,
      ...(draft.title === undefined ? {} : { title: draft.title }),
      ...(draft.dated === undefined ? {} : { dated: draft.dated }),
    });
  }
  let tagged = 0;
  for (const draft of drafts.values()) {
    for (const tag of draft.tags) {
      if (draft.had.has(tag)) continue;
      tagged += 1;
      events.push({ type: "site.tagged", id: id(), at, site: draft.site, tag });
    }
  }
  return { events, report: { added, merged, existing, tagged, tagsCreated: created.map((each) => each.name) } };
}

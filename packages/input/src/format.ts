/**
 * The standard input format: one list of sites from one source. Each adapter (for example the Chrome bookmarks) gives
 * this format, and the import reads only this format.
 *
 * @packageDocumentation
 */

/** The format word of a site list. */
export const FORMAT = "pairrank.sites";

/** The version of the format that this code reads and writes. */
export const FORMAT_VERSION = 1;

/** One site of a list. */
export interface Entry {
  /** The URL of the site. Only `http` and `https` URLs are sites. */
  readonly url: string;
  readonly title?: string;
  /** The names of the tags of the site. The import makes each tag that does not exist. */
  readonly tags?: readonly string[];
  /** The ISO 8601 time that the source gives, for example the date of a bookmark. */
  readonly dated?: string;
  /**
   * The place of the site in the source, for example the names of its bookmark folders. An adapter and its wizard use the
   * path to select sites. The import does not keep it, and a path does not become a tag.
   */
  readonly path?: readonly string[];
}

/** A list of sites from one source. */
export interface SiteList {
  readonly format: typeof FORMAT;
  readonly version: typeof FORMAT_VERSION;
  /** The source of the list, for example `chrome-bookmarks`. */
  readonly source: string;
  readonly sites: readonly Entry[];
}

/** The words of the problems of an entry. */
export type EntryProblemCode = "not-an-object" | "bad-url" | "not-a-web-url" | "bad-title" | "bad-tags" | "bad-date" | "bad-path";

/** One entry of a list that the import cannot use. */
export interface EntryProblem {
  /** The position of the entry in the list, from 0. */
  readonly index: number;
  readonly code: EntryProblemCode;
  readonly message: string;
}

/** The result of a parse: the entries that are valid, and a problem for each other entry. */
export interface Parsed {
  readonly list: SiteList;
  readonly problems: readonly EntryProblem[];
}

/** A URL starts with a scheme. This code is also for a browser, so it does not use the `URL` class of Node. */
const SCHEME = /^[a-z][a-z0-9+.-]*:\S*$/i;

/** A web URL has the scheme `http` or `https`, a host, and no spaces. */
const WEB = /^https?:\/\/[^\s/?#]+\S*$/i;

function isStrings(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((each) => typeof each === "string");
}

function entryProblem(value: unknown): [EntryProblemCode, string] | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return ["not-an-object", "An entry must be an object."];
  const entry = value as { url?: unknown; title?: unknown; tags?: unknown; dated?: unknown; path?: unknown };
  if (typeof entry.url !== "string" || !SCHEME.test(entry.url)) return ["bad-url", `The URL ${String(entry.url)} is not valid.`];
  if (!WEB.test(entry.url)) return ["not-a-web-url", `The URL ${entry.url} is not an http or https URL with a host.`];
  if (entry.title !== undefined && typeof entry.title !== "string") return ["bad-title", "The title must be a text."];
  if (entry.tags !== undefined && !isStrings(entry.tags)) return ["bad-tags", "The tags must be a list of texts."];
  if (entry.dated !== undefined && (typeof entry.dated !== "string" || Number.isNaN(Date.parse(entry.dated)))) {
    return ["bad-date", `The date ${String(entry.dated)} is not an ISO 8601 time.`];
  }
  if (entry.path !== undefined && !isStrings(entry.path)) return ["bad-path", "The path must be a list of texts."];
  return undefined;
}

/**
 * This function reads a site list. It keeps each valid entry, and gives a problem for each other entry.
 *
 * @throws Error when the value is not a site list of this version
 */
export function parseSiteList(value: unknown): Parsed {
  if (typeof value !== "object" || value === null) throw new Error("A site list must be an object.");
  const record = value as { format?: unknown; version?: unknown; source?: unknown; sites?: unknown };
  if (record.format !== FORMAT) throw new Error(`The format must be "${FORMAT}".`);
  if (record.version !== FORMAT_VERSION) throw new Error(`This code reads the version ${FORMAT_VERSION} of the format, not ${String(record.version)}.`);
  if (typeof record.source !== "string" || record.source === "") throw new Error("A site list must have a source.");
  if (!Array.isArray(record.sites)) throw new Error("A site list must have a list of sites.");
  const sites: Entry[] = [];
  const problems: EntryProblem[] = [];
  record.sites.forEach((entry: unknown, index) => {
    const problem = entryProblem(entry);
    if (problem === undefined) sites.push(entry as Entry);
    else problems.push({ index, code: problem[0], message: problem[1] });
  });
  return { list: { format: FORMAT, version: FORMAT_VERSION, source: record.source, sites }, problems };
}

/** This function makes a site list from entries. An adapter uses it. */
export function siteList(source: string, sites: readonly Entry[]): SiteList {
  return { format: FORMAT, version: FORMAT_VERSION, source, sites };
}

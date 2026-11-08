/**
 * The adapter of the Chrome bookmarks. It reads the JSON of a Chrome bookmarks file, and gives a tree of folders. A
 * selection includes or excludes each folder. Then the adapter gives the sites of the included folders as a site list.
 * The names of the folders of a site go to its `path`, and not to its tags at any time.
 */
import { type Entry, type SiteList, isWebUrl, siteList } from "./format.ts";

/** The source of each site list of this adapter. */
export const CHROME_SOURCE = "chrome-bookmarks";

/** The deepest folder that the adapter reads. A deeper folder gives a problem, and the adapter does not read it. */
export const MAX_DEPTH = 100;

/** A folder of the bookmarks, with its sites and the folders in it. */
export interface BookmarkFolder {
  /** The key of the folder: its `guid`, or else its `id`, after the prefix of the read. Each read of a file gives the same keys. */
  readonly key: string;
  readonly name: string;
  /** The names of the folders from the root to this folder. The last name is the name of this folder. */
  readonly path: readonly string[];
  readonly folders: readonly BookmarkFolder[];
  /** The sites directly in this folder. Each site has the path of this folder. */
  readonly sites: readonly Entry[];
  /** The count of the sites in this folder and in each folder in it. */
  readonly total: number;
}

/** A part of a bookmarks file that the adapter cannot read. */
export interface ChromeProblem {
  /** The names of the folders to the part. */
  readonly path: readonly string[];
  readonly message: string;
}

/** The result of a read of a bookmarks file. */
export interface ChromeBookmarks {
  /** The root folders, for example "Bookmarks bar" and "Other bookmarks". */
  readonly roots: readonly BookmarkFolder[];
  /** The count of the bookmarks that are not web sites, for example `javascript:` or `chrome://` addresses. */
  readonly skipped: number;
  readonly problems: readonly ChromeProblem[];
}

/** The options of a read. */
export interface ChromeReadOptions {
  /** The text before each key. Two files of one profile have different prefixes, so their keys are different. */
  readonly prefix?: string;
}

/** The order of the roots that Chrome writes. A root with another name comes after them. */
const ROOT_ORDER = ["bookmark_bar", "other", "synced"];

/** The time from 1601-01-01 (the start of the Chrome times) to 1970-01-01, in milliseconds. */
const WINDOWS_EPOCH_MS = 11_644_473_600_000n;

/**
 * This function gives the ISO 8601 time of a Chrome time, or `undefined` for no time. A Chrome time is a text of the
 * microseconds from 1601-01-01 UTC. The function uses `BigInt`, because the value is larger than a safe integer.
 */
export function chromeTime(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^\d{1,20}$/.test(value)) return undefined;
  const ms = BigInt(value) / 1000n - WINDOWS_EPOCH_MS;
  // The time 0 means no time. A time before 1990 or after 9999 is not a date of a bookmark.
  if (ms < 631_152_000_000n || ms > 253_402_300_799_999n) return undefined;
  return new Date(Number(ms)).toISOString();
}

interface Node {
  readonly type?: unknown;
  readonly name?: unknown;
  readonly url?: unknown;
  readonly children?: unknown;
  readonly guid?: unknown;
  readonly id?: unknown;
  readonly date_added?: unknown;
}

function isNode(value: unknown): value is Node {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * This function reads the JSON value of a Chrome bookmarks file (the file `Bookmarks` or `AccountBookmarks` of a
 * profile). It gives a problem for each part that it cannot read, and it reads the other parts.
 *
 * @throws Error when the value has no roots, so it is not a bookmarks file
 */
export function parseChromeBookmarks(value: unknown, options: ChromeReadOptions = {}): ChromeBookmarks {
  const prefix = options.prefix ?? "";
  if (!isNode(value) || !isNode((value as { roots?: unknown }).roots)) throw new Error("A Chrome bookmarks file has an object roots.");
  const rootNodes = (value as { roots: Record<string, unknown> }).roots;
  const problems: ChromeProblem[] = [];
  let skipped = 0;

  const folderOf = (node: Node, parent: readonly string[], fallback: string, depth: number): BookmarkFolder => {
    const name = typeof node.name === "string" && node.name !== "" ? node.name : fallback;
    const path = [...parent, name];
    const own = typeof node.guid === "string" && node.guid !== "" ? node.guid : String(node.id ?? path.join("/"));
    const folders: BookmarkFolder[] = [];
    const sites: Entry[] = [];
    let total = 0;
    const children = Array.isArray(node.children) ? (node.children as unknown[]) : [];
    if (node.children !== undefined && !Array.isArray(node.children)) problems.push({ path, message: "The children of a folder must be a list." });
    for (const child of children) {
      if (!isNode(child)) {
        problems.push({ path, message: "A bookmark must be an object." });
      } else if (child.type === "url") {
        if (typeof child.url !== "string" || !isWebUrl(child.url)) {
          skipped++;
          continue;
        }
        const title = typeof child.name === "string" && child.name.trim() !== "" ? child.name : undefined;
        const dated = chromeTime(child.date_added);
        sites.push({ url: child.url, ...(title === undefined ? {} : { title }), ...(dated === undefined ? {} : { dated }), path });
        total++;
      } else if (child.type === "folder") {
        if (depth >= MAX_DEPTH) {
          problems.push({ path, message: `A folder is deeper than ${MAX_DEPTH} folders. The adapter does not read it.` });
          continue;
        }
        const folder = folderOf(child, path, "Folder", depth + 1);
        folders.push(folder);
        total += folder.total;
      } else {
        problems.push({ path, message: `A bookmark has the type ${String(child.type)}, not url or folder.` });
      }
    }
    return { key: `${prefix}${own}`, name, path, folders, sites, total };
  };

  const names = Object.keys(rootNodes).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  const roots: BookmarkFolder[] = [];
  for (const name of names) {
    const node = rootNodes[name];
    // The roots object of an old file also has values that are not folders, for example a sync transaction version
    if (!isNode(node) || node.type !== "folder") continue;
    roots.push(folderOf(node, [], name, 1));
  }
  return { roots, skipped, problems };
}

function rank(name: string): number {
  const index = ROOT_ORDER.indexOf(name);
  return index === -1 ? ROOT_ORDER.length : index;
}

/** The choice of a folder: its sites go into the import, or they stay out. */
export type FolderChoice = "include" | "exclude";

/**
 * A selection of folders. A folder with no choice of its own gets the choice of its parent folder. A root with no
 * choice gets the choice `otherwise`.
 */
export interface FolderSelection {
  readonly otherwise: FolderChoice;
  /** The choice of each folder that has a choice of its own, by its key. */
  readonly folders: Readonly<Record<string, FolderChoice>>;
}

/** The selection of all the folders. */
export const ALL_FOLDERS: FolderSelection = { otherwise: "include", folders: {} };

/** This function gives each folder to `visit` in the order of the tree, with the choice of the folder. */
function walk(roots: readonly BookmarkFolder[], selection: FolderSelection, visit: (folder: BookmarkFolder, choice: FolderChoice, inherited: FolderChoice) => void): void {
  const go = (folder: BookmarkFolder, inherited: FolderChoice): void => {
    const choice = selection.folders[folder.key] ?? inherited;
    visit(folder, choice, inherited);
    for (const each of folder.folders) go(each, choice);
  };
  for (const root of roots) go(root, selection.otherwise);
}

/** This function gives the sites of the included folders, in the order of the tree. */
export function selectedSites(roots: readonly BookmarkFolder[], selection: FolderSelection): Entry[] {
  const sites: Entry[] = [];
  walk(roots, selection, (folder, choice) => {
    if (choice === "include") sites.push(...folder.sites);
  });
  return sites;
}

/** This function gives the site list of the included folders. The import reads this list. */
export function chromeSiteList(roots: readonly BookmarkFolder[], selection: FolderSelection): SiteList {
  return siteList(CHROME_SOURCE, selectedSites(roots, selection));
}

/** This function gives the count of the included sites in each folder and in the folders in it, by the key of the folder. */
export function includedCounts(roots: readonly BookmarkFolder[], selection: FolderSelection): Map<string, number> {
  const counts = new Map<string, number>();
  const go = (folder: BookmarkFolder, inherited: FolderChoice): number => {
    const choice = selection.folders[folder.key] ?? inherited;
    let count = choice === "include" ? folder.sites.length : 0;
    for (const each of folder.folders) count += go(each, choice);
    counts.set(folder.key, count);
    return count;
  };
  for (const root of roots) go(root, selection.otherwise);
  return counts;
}

/**
 * This function gives the selection with a new choice for one folder. The folders in it lose their own choices, so
 * the whole folder follows the new choice. A choice that is the same as the choice of the parent is not kept.
 */
export function choose(roots: readonly BookmarkFolder[], selection: FolderSelection, key: string, choice: FolderChoice): FolderSelection {
  const folders: Record<string, FolderChoice> = { ...selection.folders };
  let found = false;
  const clear = (folder: BookmarkFolder): void => {
    delete folders[folder.key];
    for (const each of folder.folders) clear(each);
  };
  walk(roots, selection, (folder, _choice, inherited) => {
    if (found || folder.key !== key) return;
    found = true;
    clear(folder);
    if (choice !== inherited) folders[key] = choice;
  });
  return found ? { otherwise: selection.otherwise, folders } : selection;
}

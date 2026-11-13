/**
 * The adapter of the Chrome bookmarks. `parseChromeBookmarks` of `@procedures/browser/bookmarks` reads a bookmarks
 * file, and gives a tree of folders. A selection includes or excludes each folder. Then the adapter gives the sites of
 * the included folders as a site list. The names of the folders of a site go to its `path`, and not to its tags at any time.
 */
import type { Bookmark, BookmarkFileKind, BookmarkFolder } from "@procedures/browser/bookmarks";
import { type Entry, type SiteList, siteList } from "./format.ts";

/** The source of each site list of this adapter. */
export const CHROME_SOURCE = "chrome-bookmarks";

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
    if (choice === "include") sites.push(...folder.sites.map(entryOf));
  });
  return sites;
}

/** This function gives the entry of a bookmark. The time when the user added the bookmark is the date of the entry. */
function entryOf({ url, title, added, path }: Bookmark): Entry {
  return { url, ...(title === undefined ? {} : { title }), ...(added === undefined ? {} : { dated: added }), path };
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

/** This function gives the choice of each folder, by its key. The wizard shows a folder with no sites by its choice. */
export function choicesOf(roots: readonly BookmarkFolder[], selection: FolderSelection): Map<string, FolderChoice> {
  const choices = new Map<string, FolderChoice>();
  walk(roots, selection, (folder, choice) => choices.set(folder.key, choice));
  return choices;
}

/** A bookmarks file that the app can read. The host finds the files of the Chrome profiles. */
export interface BookmarkSource {
  /** The id of the file for the host. The host reads only the files that it found or that the user chose. */
  readonly id: string;
  /** The name of the profile, as Chrome shows it, or the name of the file that the user chose. */
  readonly name: string;
  /**
   * The kind of the file. `profile` is the file `Bookmarks` of a profile. `account` is the file `AccountBookmarks`: the
   * bookmarks of a Google account with no sync. `file` is a file that the user chose.
   */
  readonly kind: BookmarkFileKind | "file";
}

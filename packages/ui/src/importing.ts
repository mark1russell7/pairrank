/**
 * The rules of the import of the Chrome bookmarks, with no React. They give the state of the box of each folder and
 * the change of a click. They also read a file that the user chooses.
 */
import type { BookmarkSource, FolderChoice, FolderSelection } from "@pairrank/input";
import { type BookmarkFolder, type ChromeBookmarks, MAX_BOOKMARKS_BYTES, parseChromeBookmarks } from "@procedures/browser/bookmarks";

/** A bookmarks file that the interface read, with its folders and its sites. */
export interface Book {
  readonly source: BookmarkSource;
  readonly read: ChromeBookmarks;
}

/** The state of the box of a folder: all its sites go into the import, none of them, or some of them. */
export type BoxState = "on" | "off" | "mixed";

/**
 * This function gives the state of the box of a folder from the count of its included sites. A folder with no sites
 * shows its choice.
 */
export function boxState(folder: BookmarkFolder, included: number, choice: FolderChoice): BoxState {
  if (folder.total === 0) return choice === "include" ? "on" : "off";
  if (included === folder.total) return "on";
  return included === 0 ? "off" : "mixed";
}

/** This function gives the choice of a click on a box. A click on a full box excludes the folder, and other clicks include it. */
export function clickChoice(state: BoxState): FolderChoice {
  return state === "on" ? "exclude" : "include";
}

/** This function gives the root folders of the files, in the order of the files. The keys of two files are different. */
export function rootsOf(books: readonly Book[]): BookmarkFolder[] {
  return books.flatMap((book) => book.read.roots);
}

/** This function gives the selection that includes each folder, or excludes each folder. */
export function everyFolder(choice: FolderChoice): FolderSelection {
  return { otherwise: choice, folders: {} };
}

/** The part of a file that the read of a chosen file uses. A `File` of the browser has it. */
export interface ChosenFile {
  readonly name: string;
  readonly size: number;
  text(): Promise<string>;
}

/**
 * This function reads a bookmarks file that the user chose. `n` makes the id of the file, so two chosen files have
 * different keys.
 *
 * @throws Error with a message for the user, when the file is too large or is not a Chrome bookmarks file
 */
export async function readChosenFile(file: ChosenFile, n: number): Promise<Book> {
  const source: BookmarkSource = { id: `file:${n}`, name: file.name, kind: "file" };
  if (file.size > MAX_BOOKMARKS_BYTES) throw new Error(`The file ${file.name} is larger than 64 MB, so it is not a bookmarks file.`);
  try {
    return { source, read: parseChromeBookmarks(JSON.parse(await file.text()), { prefix: `${source.id}:` }) };
  } catch {
    throw new Error(`The file ${file.name} is not a bookmarks file of Chrome. Chrome keeps it in the folder of a profile, with the name Bookmarks.`);
  }
}

/** This function gives the words for the kind of a bookmarks file. */
export function kindText(kind: BookmarkSource["kind"]): string {
  if (kind === "account") return "Account bookmarks, not synced";
  return kind === "file" ? "Chosen file" : "Bookmarks";
}

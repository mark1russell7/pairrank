/**
 * The bookmarks files of the Chrome profiles, as procedures. The host finds the files, and reads only the files that it
 * found. The page cannot give a path. The page reads a file that the user chooses by itself. The entry
 * `@pairrank/host/bookmarks` has Node.js code, so the root of the package does not export it.
 *
 * The search and the read of the files are `findBookmarkFiles` and `readBookmarkFile` of `@procedures/browser`.
 */
import { homedir } from "node:os";
import {
  type BookmarkFile,
  type BookmarkSource,
  type BrowserDataFolder,
  type ChromeBookmarks,
  type FileAccess,
  browserDataFolders,
  diskFileAccess,
  findBookmarkFiles,
  readBookmarkFile,
} from "@procedures/browser";
import { type AnyProcedure, type ProcedureModule, createProcedure, defineModule, typed } from "@procedures/client";
import { z } from "zod";

/** The options of the module of the bookmarks. */
export interface BookmarksOptions {
  /** The folders of the user data of Chrome. The default is the folders of this computer and user. */
  readonly folders?: readonly BrowserDataFolder[] | undefined;
  /** The file operations. The default is `diskFileAccess` of `@procedures/browser`. A test gives files in memory. */
  readonly files?: FileAccess | undefined;
}

/** This function gives the folders of the user data of Chrome on this computer, for this user. */
export function chromeFolders(): BrowserDataFolder[] {
  return browserDataFolders(process.platform, process.env, homedir(), ["chrome"]);
}

/** The input of `bookmarks.read`: the id of a file that `bookmarks.sources` found. */
const SourceInput = z.strictObject({
  source: z.string({ error: "The input must have the id of a source." }).min(1, { error: "The input must have the id of a source." }),
});

const reads = { reads: ["chrome.bookmarks"], writes: [], idempotent: true, destructive: false };

/**
 * This function gives the module of the procedures of the bookmarks:
 *
 * - `bookmarks.sources` finds the bookmarks files of the Chrome profiles.
 * - `bookmarks.read` reads the folders and the sites of a file that `bookmarks.sources` found.
 */
export function bookmarksModule(options: BookmarksOptions = {}): ProcedureModule {
  const { folders = chromeFolders(), files = diskFileAccess } = options;
  const known = new Map<string, BookmarkFile>();
  const strip = ({ id, name, kind }: BookmarkFile): BookmarkSource => ({ id, name, kind });

  const procedures: AnyProcedure[] = [
    createProcedure()
      .path(["bookmarks", "sources"])
      .input(z.strictObject({}))
      .output(typed<BookmarkSource[]>())
      .meta({ description: "Find the bookmarks files of the Chrome profiles", effects: reads })
      .handler(async (): Promise<BookmarkSource[]> => {
        const found = await findBookmarkFiles(folders, files);
        known.clear();
        for (const source of found) known.set(source.id, source);
        return found.map(strip);
      })
      .build(),
    createProcedure()
      .path(["bookmarks", "read"])
      .input(SourceInput)
      .output(typed<ChromeBookmarks>())
      .meta({ description: "Read the folders and the sites of a bookmarks file", effects: reads })
      .handler(async ({ source }): Promise<ChromeBookmarks> => {
        const found = known.get(source);
        if (found === undefined) throw new Error("The app does not know this bookmarks file. Find the files again.");
        return readBookmarkFile(found, files);
      })
      .build(),
  ];
  return defineModule("@pairrank/desktop/bookmarks", procedures);
}

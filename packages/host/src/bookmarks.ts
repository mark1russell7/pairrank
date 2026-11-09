/**
 * The bookmarks files of the Chrome profiles, as procedures. The host finds the files, and reads only the files that it
 * found. The page cannot give a path. The page reads a file that the user chooses by itself. The entry
 * `@pairrank/host/bookmarks` has Node.js code, so the root of the package does not export it.
 */
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { BOOKMARK_FILES, type BookmarkSource, type ChromeBookmarks, MAX_BOOKMARKS_BYTES, parseChromeBookmarks, profileNames } from "@pairrank/input";
import { type AnyProcedure, type ProcedureModule, createProcedure, defineModule, zodAdapter } from "@procedures/client";

/** The file operations that the procedures use. A test gives files in memory. */
export interface Files {
  /** This function gives the names in a folder, or no names when the folder does not exist. */
  list(folder: string): Promise<readonly string[]>;
  /** This function gives the size of a file in bytes, or `undefined` when the file does not exist. */
  size(file: string): Promise<number | undefined>;
  /** This function gives the text of a file in UTF-8. */
  read(file: string): Promise<string>;
}

/** The file operations of the procedures on the disk. */
export const diskFiles: Files = {
  list: async (folder) => {
    try {
      return await readdir(folder);
    } catch {
      return [];
    }
  },
  size: async (file) => {
    try {
      const found = await stat(file);
      return found.isFile() ? found.size : undefined;
    } catch {
      return undefined;
    }
  },
  read: (file) => readFile(file, "utf8"),
};

/**
 * This function gives the folders of the user data of Chrome for a platform. Each profile of Chrome is a folder in
 * one of them.
 */
export function chromeDataFolders(platform: string, env: Readonly<Record<string, string | undefined>>, home: string): string[] {
  if (platform === "win32") {
    const local = env["LOCALAPPDATA"] ?? join(home, "AppData", "Local");
    return [join(local, "Google", "Chrome", "User Data")];
  }
  if (platform === "darwin") return [join(home, "Library", "Application Support", "Google", "Chrome")];
  return [join(env["XDG_CONFIG_HOME"] ?? join(home, ".config"), "google-chrome")];
}

/** A profile folder of Chrome has the name `Default` or `Profile <n>`. The guest and system profiles have no bookmarks. */
const PROFILE = /^(Default|Profile \d+)$/;

/** This function gives the order of two profile folders: `Default` first, then `Profile <n>` by the number. */
function profileOrder(a: string, b: string): number {
  const number = (name: string): number => (name === "Default" ? 0 : Number(name.slice("Profile ".length)));
  return number(a) - number(b);
}

/** A bookmarks file that the procedures found, with its path. The path stays in the main process. */
export interface FoundSource extends BookmarkSource {
  readonly path: string;
}

/** This function finds the bookmarks files of the Chrome profiles in the folders of the user data. */
export async function findSources(folders: readonly string[], files: Files): Promise<FoundSource[]> {
  const found: FoundSource[] = [];
  for (const folder of folders) {
    let names = new Map<string, string>();
    try {
      names = profileNames(JSON.parse(await files.read(join(folder, "Local State"))));
    } catch {
      // A missing or broken file Local State gives the names of the folders
    }
    const profiles = new Set([...names.keys(), ...(await files.list(folder))].filter((name) => PROFILE.test(name)));
    for (const profile of [...profiles].sort(profileOrder)) {
      for (const [file, kind] of Object.entries(BOOKMARK_FILES)) {
        const path = join(folder, profile, file);
        if ((await files.size(path)) === undefined) continue;
        found.push({ id: `chrome:${profile}:${file}`, name: names.get(profile) ?? profile, kind, path });
      }
    }
  }
  return found;
}

/** The options of the module of the bookmarks. */
export interface BookmarksOptions {
  /** The folders of the user data of Chrome. `chromeDataFolders` gives them. */
  readonly folders: readonly string[];
  readonly files: Files;
}

const as = <T>() => zodAdapter<T>({ parse: (value: unknown) => value as T });

const SourceInput = zodAdapter<{ source: string }>({
  parse: (value: unknown) => {
    const source = (value as { source?: unknown } | null)?.source;
    if (typeof source !== "string" || source === "") throw new Error("The input has the id of a source.");
    return { source };
  },
});

const reads = { reads: ["chrome.bookmarks"], writes: [], idempotent: true, destructive: false };

/**
 * This function gives the module of the procedures of the bookmarks:
 *
 * - `bookmarks.sources` finds the bookmarks files of the Chrome profiles.
 * - `bookmarks.read` reads the folders and the sites of a file that `bookmarks.sources` found.
 */
export function bookmarksModule(options: BookmarksOptions): ProcedureModule {
  const known = new Map<string, FoundSource>();
  const strip = ({ id, name, kind }: FoundSource): BookmarkSource => ({ id, name, kind });
  const notBookmarks = (path: string): Error => new Error(`The file ${path} is not a bookmarks file of Chrome.`);

  const procedures: AnyProcedure[] = [
    createProcedure()
      .path(["bookmarks", "sources"])
      .input(as<Record<string, never>>())
      .output(as<BookmarkSource[]>())
      .meta({ description: "Find the bookmarks files of the Chrome profiles", effects: reads })
      .handler(async (): Promise<BookmarkSource[]> => {
        const found = await findSources(options.folders, options.files);
        known.clear();
        for (const source of found) known.set(source.id, source);
        return found.map(strip);
      })
      .build(),
    createProcedure()
      .path(["bookmarks", "read"])
      .input(SourceInput)
      .output(as<ChromeBookmarks>())
      .meta({ description: "Read the folders and the sites of a bookmarks file", effects: reads })
      .handler(async ({ source }): Promise<ChromeBookmarks> => {
        const found = known.get(source);
        if (found === undefined) throw new Error("The app does not know this bookmarks file. Find the files again.");
        const size = await options.files.size(found.path);
        if (size === undefined) throw new Error(`The file ${found.path} is not there now.`);
        if (size > MAX_BOOKMARKS_BYTES) throw new Error(`The file ${found.path} is larger than 64 MB, so it is not a bookmarks file.`);
        let json: unknown;
        try {
          json = JSON.parse(await options.files.read(found.path));
        } catch {
          throw notBookmarks(found.path);
        }
        try {
          return parseChromeBookmarks(json, { prefix: `${source}:` });
        } catch {
          throw notBookmarks(found.path);
        }
      })
      .build(),
  ];
  return defineModule("@pairrank/desktop/bookmarks", procedures);
}

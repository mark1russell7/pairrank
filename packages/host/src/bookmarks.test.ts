import { join } from "node:path";
import { type BookmarkSource, type ChromeBookmarks, type FileAccess, MAX_BOOKMARKS_BYTES } from "@procedures/browser";
import { callerOf } from "@procedures/client";
import { describe, expect, it } from "vitest";
import { bookmarksModule, chromeFolders } from "./bookmarks.ts";

const DATA = join("home", "chrome");

/** A bookmarks file with one site in the bookmarks bar. */
const bookmarks = (url: string) => JSON.stringify({ roots: { bookmark_bar: { type: "folder", name: "Bookmarks bar", guid: "bar", children: [{ type: "url", name: "A", url }] } } });

/** This function gives files in memory. A size in `sizes` replaces the real size of a file. */
function memory(contents: Record<string, string>, sizes: Record<string, number> = {}): FileAccess {
  return {
    list: async (folder) => [...new Set(Object.keys(contents).filter((path) => path.startsWith(folder + "/") || path.startsWith(folder + "\\")).map((path) => path.slice(folder.length + 1).split(/[\\/]/)[0] ?? ""))],
    size: async (file) => (file in contents ? (sizes[file] ?? contents[file]?.length) : undefined),
    read: async (file) => {
      const text = contents[file];
      if (text === undefined) throw new Error(`no file ${file}`);
      return text;
    },
  };
}

const FILES = {
  [join(DATA, "Local State")]: JSON.stringify({ profile: { info_cache: { Default: { name: "Home" }, "Profile 2": { name: "Work" } } } }),
  [join(DATA, "Default", "Bookmarks")]: bookmarks("https://a.example/"),
  [join(DATA, "Default", "AccountBookmarks")]: bookmarks("https://b.example/"),
  [join(DATA, "Profile 10", "Bookmarks")]: bookmarks("https://c.example/"),
  [join(DATA, "Profile 2", "Bookmarks")]: bookmarks("https://d.example/"),
  [join(DATA, "Guest Profile", "Bookmarks")]: bookmarks("https://e.example/"),
  [join(DATA, "Profile 3", "Preferences")]: "{}",
};

describe("chromeFolders", () => {
  it("gives the one folder of the user data of Chrome on this computer", () => {
    const folders = chromeFolders();
    expect(folders).toHaveLength(1);
    expect(folders[0]?.browser).toBe("chrome");
  });
});

describe("bookmarksModule", () => {
  const open = (files: FileAccess) => callerOf(bookmarksModule({ folders: [{ browser: "chrome", folder: DATA }], files }));

  it("finds the files of each profile, with the names of Chrome, and gives no path to the page", async () => {
    const call = open(memory(FILES));
    const sources = await call<BookmarkSource[]>(["bookmarks", "sources"], {});
    expect(sources).toEqual([
      { id: "chrome:Default:Bookmarks", name: "Home", kind: "profile" },
      { id: "chrome:Default:AccountBookmarks", name: "Home", kind: "account" },
      { id: "chrome:Profile 2:Bookmarks", name: "Work", kind: "profile" },
      { id: "chrome:Profile 10:Bookmarks", name: "Profile 10", kind: "profile" },
    ]);
    const read = await call<ChromeBookmarks>(["bookmarks", "read"], { source: "chrome:Profile 2:Bookmarks" });
    expect(read.roots[0]?.sites.map((site) => site.url)).toEqual(["https://d.example/"]);
    expect(read.roots[0]?.key).toBe("chrome:Profile 2:Bookmarks:bar");
  });

  it("refuses a source that it did not find, so the page cannot read another file", async () => {
    const call = open(memory(FILES));
    await expect(call(["bookmarks", "read"], { source: "chrome:Default:Bookmarks" })).rejects.toThrow("does not know");
    await call(["bookmarks", "sources"], {});
    for (const source of [join(DATA, "Local State"), "chrome:Guest Profile:Bookmarks", "chrome:Default:Preferences"]) await expect(call(["bookmarks", "read"], { source })).rejects.toThrow("does not know");
    await expect(call(["bookmarks", "read"], {})).rejects.toThrow("The input must have the id of a source.");
  });

  it("refuses an input of the wrong type, an empty source and an extra field", async () => {
    const call = open(memory(FILES));
    await expect(call(["bookmarks", "sources"], { folder: DATA })).rejects.toThrow(/Unrecognized key/);
    await expect(call(["bookmarks", "read"], { source: 3 })).rejects.toThrow("The input must have the id of a source.");
    await expect(call(["bookmarks", "read"], { source: "" })).rejects.toThrow("The input must have the id of a source.");
    await expect(call(["bookmarks", "read"], { source: "chrome:Default:Bookmarks", path: DATA })).rejects.toThrow(/Unrecognized key/);
  });

  it("refuses a file that is not a bookmarks file, a very large file and a file that went away", async () => {
    const files = { ...FILES, [join(DATA, "Profile 2", "Bookmarks")]: "not json", [join(DATA, "Profile 10", "Bookmarks")]: "{}" };
    const sizes = { [join(DATA, "Default", "Bookmarks")]: MAX_BOOKMARKS_BYTES + 1 };
    const disk = memory(files, sizes);
    const call = open(disk);
    await call(["bookmarks", "sources"], {});
    await expect(call(["bookmarks", "read"], { source: "chrome:Profile 2:Bookmarks" })).rejects.toThrow("is not a bookmarks file");
    await expect(call(["bookmarks", "read"], { source: "chrome:Profile 10:Bookmarks" })).rejects.toThrow("roots");
    await expect(call(["bookmarks", "read"], { source: "chrome:Default:Bookmarks" })).rejects.toThrow("bytes at most");
    delete files[join(DATA, "Default", "AccountBookmarks")];
    await expect(call(["bookmarks", "read"], { source: "chrome:Default:AccountBookmarks" })).rejects.toThrow("is not there now");
    // A new search forgets the files that went away
    await call(["bookmarks", "sources"], {});
    await expect(call(["bookmarks", "read"], { source: "chrome:Default:AccountBookmarks" })).rejects.toThrow("does not know");
  });
});

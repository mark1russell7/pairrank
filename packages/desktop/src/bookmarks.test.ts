import { join } from "node:path";
import { type BookmarkSource, type ChromeBookmarks, MAX_BOOKMARKS_BYTES } from "@pairrank/input";
import { callerOf } from "@procedures/client";
import { describe, expect, it } from "vitest";
import { type Files, bookmarksModule, chromeDataFolders, findSources } from "./bookmarks.ts";

const DATA = join("home", "chrome");

/** A bookmarks file with one site in the bookmarks bar. */
const bookmarks = (url: string) => JSON.stringify({ roots: { bookmark_bar: { type: "folder", name: "Bookmarks bar", guid: "bar", children: [{ type: "url", name: "A", url }] } } });

/** This function gives files in memory. A size in `sizes` replaces the real size of a file. */
function memory(contents: Record<string, string>, sizes: Record<string, number> = {}): Files {
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
  [join(DATA, "Local State")]: JSON.stringify({ profile: { info_cache: { Default: { name: "Mark" }, "Profile 2": { name: "Work" } } } }),
  [join(DATA, "Default", "Bookmarks")]: bookmarks("https://a.example/"),
  [join(DATA, "Default", "AccountBookmarks")]: bookmarks("https://b.example/"),
  [join(DATA, "Profile 10", "Bookmarks")]: bookmarks("https://c.example/"),
  [join(DATA, "Profile 2", "Bookmarks")]: bookmarks("https://d.example/"),
  [join(DATA, "Guest Profile", "Bookmarks")]: bookmarks("https://e.example/"),
  [join(DATA, "Profile 3", "Preferences")]: "{}",
};

describe("chromeDataFolders", () => {
  it("gives the folder of the user data of Chrome on each platform", () => {
    expect(chromeDataFolders("win32", { LOCALAPPDATA: "C:\\Users\\m\\AppData\\Local" }, "C:\\Users\\m")).toEqual([join("C:\\Users\\m\\AppData\\Local", "Google", "Chrome", "User Data")]);
    expect(chromeDataFolders("darwin", {}, "/Users/m")).toEqual([join("/Users/m", "Library", "Application Support", "Google", "Chrome")]);
    expect(chromeDataFolders("linux", {}, "/home/m")).toEqual([join("/home/m", ".config", "google-chrome")]);
    expect(chromeDataFolders("linux", { XDG_CONFIG_HOME: "/cfg" }, "/home/m")).toEqual([join("/cfg", "google-chrome")]);
  });
});

describe("findSources", () => {
  it("finds the bookmarks files of each profile, with the names of Chrome, in the order of the profiles", async () => {
    const found = await findSources([DATA], memory(FILES));
    expect(found.map(({ id, name, kind }) => [id, name, kind])).toEqual([
      ["chrome:Default:Bookmarks", "Mark", "profile"],
      ["chrome:Default:AccountBookmarks", "Mark", "account"],
      ["chrome:Profile 2:Bookmarks", "Work", "profile"],
      ["chrome:Profile 10:Bookmarks", "Profile 10", "profile"],
    ]);
  });

  it("finds no file in a folder that does not exist, and reads the folders with a broken Local State", async () => {
    expect(await findSources([join("no", "where")], memory(FILES))).toEqual([]);
    const broken = { ...FILES, [join(DATA, "Local State")]: "{" };
    expect((await findSources([DATA], memory(broken))).map((source) => source.name)).toEqual(["Default", "Default", "Profile 2", "Profile 10"]);
  });
});

describe("bookmarksModule", () => {
  const open = (files: Files) => callerOf(bookmarksModule({ folders: [DATA], files }));

  it("reads a source that it found, and gives no path to the page", async () => {
    const call = open(memory(FILES));
    const sources = await call<BookmarkSource[]>(["bookmarks", "sources"], {});
    expect(JSON.stringify(sources)).not.toContain("home");
    const read = await call<ChromeBookmarks>(["bookmarks", "read"], { source: "chrome:Profile 2:Bookmarks" });
    expect(read.roots[0]?.sites.map((site) => site.url)).toEqual(["https://d.example/"]);
    expect(read.roots[0]?.key).toBe("chrome:Profile 2:Bookmarks:bar");
  });

  it("refuses a source that it did not find, so the page cannot read another file", async () => {
    const call = open(memory(FILES));
    await expect(call(["bookmarks", "read"], { source: "chrome:Default:Bookmarks" })).rejects.toThrow("does not know");
    await call(["bookmarks", "sources"], {});
    for (const source of [join(DATA, "Local State"), "chrome:Guest Profile:Bookmarks", "chrome:Default:Preferences"]) await expect(call(["bookmarks", "read"], { source })).rejects.toThrow("does not know");
    await expect(call(["bookmarks", "read"], {})).rejects.toThrow();
  });

  it("refuses a file that is not a bookmarks file, a very large file and a file that went away", async () => {
    const files = { ...FILES, [join(DATA, "Profile 2", "Bookmarks")]: "not json", [join(DATA, "Profile 10", "Bookmarks")]: "{}" };
    const sizes = { [join(DATA, "Default", "Bookmarks")]: MAX_BOOKMARKS_BYTES + 1 };
    const disk = memory(files, sizes);
    const call = open(disk);
    await call(["bookmarks", "sources"], {});
    await expect(call(["bookmarks", "read"], { source: "chrome:Profile 2:Bookmarks" })).rejects.toThrow("is not a bookmarks file");
    await expect(call(["bookmarks", "read"], { source: "chrome:Profile 10:Bookmarks" })).rejects.toThrow("is not a bookmarks file");
    await expect(call(["bookmarks", "read"], { source: "chrome:Default:Bookmarks" })).rejects.toThrow("larger than 64 MB");
    delete files[join(DATA, "Default", "AccountBookmarks")];
    await expect(call(["bookmarks", "read"], { source: "chrome:Default:AccountBookmarks" })).rejects.toThrow("is not there now");
    // A new search forgets the files that went away
    await call(["bookmarks", "sources"], {});
    await expect(call(["bookmarks", "read"], { source: "chrome:Default:AccountBookmarks" })).rejects.toThrow("does not know");
  });
});

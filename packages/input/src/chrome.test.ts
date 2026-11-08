import { type Random, random } from "@mark1russell7/rigor-generators";
import { describe, expect, it } from "vitest";
import { ALL_FOLDERS, type BookmarkFolder, CHROME_SOURCE, type FolderSelection, MAX_DEPTH, choicesOf, chromeSiteList, chromeTime, choose, includedCounts, parseChromeBookmarks, profileNames, selectedSites } from "./chrome.ts";
import { parseSiteList } from "./format.ts";

/** 2020-01-01T00:00:00.000Z as a Chrome time: microseconds from 1601-01-01. */
const NEW_YEAR_2020 = "13222310400000000";

/** A bookmarks file in the shape that Chrome writes. */
const FILE = {
  checksum: "0",
  version: 1,
  roots: {
    other: { type: "folder", name: "Other bookmarks", guid: "g-other", id: "2", children: [{ type: "url", name: "Docs", url: "https://docs.example/", date_added: "0", guid: "g-u3", id: "7" }] },
    bookmark_bar: {
      type: "folder",
      name: "Bookmarks bar",
      guid: "g-bar",
      id: "1",
      children: [
        { type: "url", name: "News", url: "https://news.example/", date_added: NEW_YEAR_2020, guid: "g-u1", id: "4" },
        { type: "url", name: "Script", url: "javascript:alert(1)", guid: "g-u2", id: "5" },
        {
          type: "folder",
          name: "Design",
          guid: "g-design",
          id: "6",
          children: [
            { type: "url", name: "", url: "https://a.example/", guid: "g-u4", id: "8" },
            { type: "folder", name: "Fonts", guid: "g-fonts", id: "9", children: [{ type: "url", name: "Type", url: "https://type.example/", guid: "g-u5", id: "10" }] },
          ],
        },
      ],
    },
    synced: { type: "folder", name: "Mobile bookmarks", guid: "g-synced", id: "3", children: [] },
    sync_transaction_version: "12",
  },
};

describe("chromeTime", () => {
  it("gives the ISO time of a Chrome time", () => {
    expect(chromeTime(NEW_YEAR_2020)).toBe("2020-01-01T00:00:00.000Z");
    // A Chrome time is larger than a safe integer, so a conversion with Number loses the microseconds
    expect(chromeTime("13222310400123456")).toBe("2020-01-01T00:00:00.123Z");
  });

  it("gives no time for 0, for a text that is not a number, and for a time out of range", () => {
    for (const value of ["0", "", "12a", "-5", 13222310400000000, undefined, "999999999999999999999"]) expect(chromeTime(value), String(value)).toBeUndefined();
  });
});

describe("parseChromeBookmarks", () => {
  const { roots, skipped, problems } = parseChromeBookmarks(FILE);

  it("reads the roots in the order of Chrome, and skips a value of the roots that is not a folder", () => {
    expect(roots.map((root) => root.name)).toEqual(["Bookmarks bar", "Other bookmarks", "Mobile bookmarks"]);
    expect(problems).toEqual([]);
  });

  it("gives each site the names of its folders as its path, and no tags", () => {
    const sites = selectedSites(roots, ALL_FOLDERS);
    expect(sites).toEqual([
      { url: "https://news.example/", title: "News", dated: "2020-01-01T00:00:00.000Z", path: ["Bookmarks bar"] },
      { url: "https://a.example/", path: ["Bookmarks bar", "Design"] },
      { url: "https://type.example/", title: "Type", path: ["Bookmarks bar", "Design", "Fonts"] },
      { url: "https://docs.example/", title: "Docs", path: ["Other bookmarks"] },
    ]);
  });

  it("counts the bookmarks that are not web sites, and keeps them out", () => {
    expect(skipped).toBe(1);
    expect(roots[0]?.total).toBe(3);
  });

  it("gives the keys of the guids, after the prefix", () => {
    const account = parseChromeBookmarks(FILE, { prefix: "account:" });
    expect(account.roots[0]?.key).toBe("account:g-bar");
    expect(account.roots[0]?.folders[0]?.key).toBe("account:g-design");
  });

  it("gives a problem for each part that it cannot read, and reads the other parts", () => {
    const bad = parseChromeBookmarks({
      roots: { bookmark_bar: { type: "folder", name: "Bar", children: [7, { type: "separator" }, { type: "url", url: "https://ok.example/" }, { type: "folder", name: "X", children: "no" }] } },
    });
    expect(bad.problems.map((problem) => problem.message)).toEqual([
      "A bookmark must be an object.",
      "A bookmark has the type separator, not url or folder.",
      "The children of a folder must be a list.",
    ]);
    expect(bad.roots[0]?.total).toBe(1);
  });

  it("refuses a value with no roots", () => {
    for (const value of [null, [], "x", {}, { roots: [] }]) expect(() => parseChromeBookmarks(value)).toThrow("roots");
  });

  it("stops at the deepest folder, with a problem, and does not overflow the stack", () => {
    let node: Record<string, unknown> = { type: "folder", name: "deep", children: [{ type: "url", url: "https://deep.example/" }] };
    for (let i = 0; i < 5000; i++) node = { type: "folder", name: `f${i}`, children: [node] };
    const read = parseChromeBookmarks({ roots: { bookmark_bar: node } });
    expect(read.problems).toHaveLength(1);
    expect(read.problems[0]?.path).toHaveLength(MAX_DEPTH);
    expect(read.roots[0]?.total).toBe(0);
  });
});

describe("a selection of folders", () => {
  const { roots } = parseChromeBookmarks(FILE);
  const urls = (selection: FolderSelection) => selectedSites(roots, selection).map((site) => site.url);

  it("excludes a folder and each folder in it, and a folder in it can be included again", () => {
    const noDesign = choose(roots, ALL_FOLDERS, "g-design", "exclude");
    expect(urls(noDesign)).toEqual(["https://news.example/", "https://docs.example/"]);
    const onlyFonts = choose(roots, noDesign, "g-fonts", "include");
    expect(urls(onlyFonts)).toEqual(["https://news.example/", "https://type.example/", "https://docs.example/"]);
    expect(includedCounts(roots, onlyFonts).get("g-design")).toBe(1);
  });

  it("clears the choices of the folders in a folder, so the whole folder follows the new choice", () => {
    const mixed = choose(roots, choose(roots, ALL_FOLDERS, "g-design", "exclude"), "g-fonts", "include");
    const back = choose(roots, mixed, "g-bar", "include");
    expect(back.folders).toEqual({});
    expect(urls(back)).toEqual(urls(ALL_FOLDERS));
  });

  it("does not change for a key that is not a folder", () => {
    expect(choose(roots, ALL_FOLDERS, "g-u1", "exclude")).toBe(ALL_FOLDERS);
  });

  it("gives a site list of the standard format, with the source of the adapter", () => {
    const list = chromeSiteList(roots, { otherwise: "exclude", folders: { "g-other": "include" } });
    expect(list.source).toBe(CHROME_SOURCE);
    const parsed = parseSiteList(JSON.parse(JSON.stringify(list)));
    expect(parsed.problems).toEqual([]);
    expect(parsed.list.sites.map((site) => site.url)).toEqual(["https://docs.example/"]);
  });
});

/** This function gives a random bookmarks node: a folder with sites, other bookmarks and folders in it. */
function folderNode(draw: Random, depth: number, name: string, ids: { next: number }): Record<string, unknown> {
  const children: unknown[] = [];
  const count = draw.int(0, depth > 3 ? 2 : 5);
  for (let i = 0; i < count; i++) {
    const id = ids.next++;
    if (draw.chance(0.3) && depth < 6) children.push(folderNode(draw, depth + 1, `F${id}`, ids));
    else if (draw.chance(0.1)) children.push({ type: "url", name: `S${id}`, url: `chrome://settings/${id}`, guid: `u${id}`, id: String(id) });
    else children.push({ type: "url", name: `S${id}`, url: `https://s${draw.int(0, 40)}.example/${id}`, guid: `u${id}`, id: String(id), date_added: String(13_222_310_400_000_000 + id) });
  }
  const id = ids.next++;
  return { type: "folder", name, guid: `f${id}`, id: String(id), children };
}

function allFolders(roots: readonly BookmarkFolder[]): BookmarkFolder[] {
  const out: BookmarkFolder[] = [];
  const go = (folder: BookmarkFolder): void => {
    out.push(folder);
    folder.folders.forEach(go);
  };
  roots.forEach(go);
  return out;
}

describe("the adapter on seeded random files (200 files, 20 choices each)", () => {
  it("keeps the folders out of the tags, and keeps the counts and the selections equal", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const draw = random(seed);
      const ids = { next: 1 };
      const file = { roots: { bookmark_bar: folderNode(draw, 1, "Bar", ids), other: folderNode(draw, 1, "Other", ids) } };
      const { roots, problems } = parseChromeBookmarks(file);
      expect(problems, `seed ${seed}`).toEqual([]);
      const folders = allFolders(roots);
      let selection: FolderSelection = ALL_FOLDERS;
      for (let step = 0; step < 20; step++) {
        selection = choose(roots, selection, draw.pick(folders).key, draw.chance(0.5) ? "include" : "exclude");
        const sites = selectedSites(roots, selection);
        const counts = includedCounts(roots, selection);
        // The count of each root is the count of its selected sites
        expect(roots.reduce((sum, root) => sum + (counts.get(root.key) ?? 0), 0), `seed ${seed}`).toBe(sites.length);
        for (const site of sites) {
          expect(site.tags, `seed ${seed}`).toBeUndefined();
          expect(site.url.startsWith("https://"), `seed ${seed}`).toBe(true);
        }
        // A folder never has more included sites than sites
        for (const folder of folders) expect((counts.get(folder.key) ?? 0) <= folder.total, `seed ${seed}`).toBe(true);
      }
      // Each site is in the folder of its path
      for (const folder of folders) for (const site of folder.sites) expect(site.path, `seed ${seed}`).toEqual(folder.path);
      expect(roots.reduce((sum, root) => sum + root.total, 0)).toBe(selectedSites(roots, ALL_FOLDERS).length);
    }
  });
});

describe("the sources of the bookmarks", () => {
  it("gives the name of each profile from the file Local State", () => {
    const names = profileNames({ profile: { info_cache: { Default: { name: "Person 1" }, "Profile 2": { name: "Work" }, "Profile 3": { name: " " }, bad: null } } });
    expect([...names]).toEqual([
      ["Default", "Person 1"],
      ["Profile 2", "Work"],
    ]);
    for (const value of [null, 3, {}, { profile: { info_cache: "x" } }]) expect(profileNames(value).size).toBe(0);
  });

  it("gives the choice of each folder, also of a folder with no sites", () => {
    const { roots } = parseChromeBookmarks(FILE);
    const choices = choicesOf(roots, choose(roots, ALL_FOLDERS, "g-bar", "exclude"));
    expect([choices.get("g-bar"), choices.get("g-fonts"), choices.get("g-synced")]).toEqual(["exclude", "exclude", "include"]);
  });
});

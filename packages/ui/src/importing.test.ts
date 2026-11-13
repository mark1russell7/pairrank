import { MAX_BOOKMARKS_BYTES, parseChromeBookmarks } from "@pairrank/input";
import { describe, expect, it } from "vitest";
import { boxState, clickChoice, everyFolder, kindText, readChosenFile, rootsOf } from "./importing.ts";

const FILE = {
  roots: {
    bookmark_bar: { type: "folder", name: "Bar", guid: "bar", children: [{ type: "url", name: "A", url: "https://a.example/" }] },
    other: { type: "folder", name: "Other", guid: "other", children: [] },
  },
};

const chosen = (text: string, size = text.length) => ({ name: "Bookmarks", size, text: async () => text });

describe("the box of a folder", () => {
  const [bar, other] = parseChromeBookmarks(FILE).roots;
  if (bar === undefined || other === undefined) throw new Error("no roots");

  it("is on, off or mixed by the count of the included sites", () => {
    expect(boxState({ ...bar, total: 4 }, 4, "include")).toBe("on");
    expect(boxState({ ...bar, total: 4 }, 0, "include")).toBe("off");
    expect(boxState({ ...bar, total: 4 }, 2, "exclude")).toBe("mixed");
  });

  it("shows the choice of a folder with no sites", () => {
    expect(boxState(other, 0, "include")).toBe("on");
    expect(boxState(other, 0, "exclude")).toBe("off");
  });

  it("excludes a full folder on a click, and includes the others", () => {
    expect(clickChoice("on")).toBe("exclude");
    expect(clickChoice("mixed")).toBe("include");
    expect(clickChoice("off")).toBe("include");
  });
});

describe("readChosenFile", () => {
  it("reads a chosen file, with the keys of its id", async () => {
    const book = await readChosenFile(chosen(JSON.stringify(FILE)), 3);
    expect(book.source).toEqual({ id: "file:3", name: "Bookmarks", kind: "file" });
    expect(book.read.roots[0]?.key).toBe("file:3:bar");
    expect(rootsOf([book, book]).map((root) => root.name)).toEqual(["Bar", "Other", "Bar", "Other"]);
  });

  it("refuses a file that is not a bookmarks file, and a very large file", async () => {
    await expect(readChosenFile(chosen("not json"), 1)).rejects.toThrow("is not a bookmarks file of Chrome");
    await expect(readChosenFile(chosen("{}"), 1)).rejects.toThrow("is not a bookmarks file of Chrome");
    await expect(readChosenFile(chosen("{}", MAX_BOOKMARKS_BYTES + 1), 1)).rejects.toThrow("larger than 64 MB");
  });
});

describe("the words", () => {
  it("gives the kind of a file", () => {
    expect([kindText("profile"), kindText("account"), kindText("file")]).toEqual(["Bookmarks", "Account bookmarks, not synced", "Chosen file"]);
    expect(everyFolder("exclude")).toEqual({ otherwise: "exclude", folders: {} });
  });
});

import { type Event, replay } from "@pairrank/core";
import { describe, expect, it } from "vitest";
import { type Entry, isWebUrl, parseSiteList, siteList } from "./format.ts";
import { planImport } from "./plan.ts";

/** A key for the tests only: no fragment, no final slash, a lowercase host. The app uses the key of the crawler. */
const key = (url: string): string => {
  const parsed = new URL(url);
  parsed.hash = "";
  return parsed.href.replace(/\/$/, "");
};

function options() {
  let n = 0;
  return { key, id: () => `i${++n}`, at: "2026-11-08T12:00:00Z" };
}

describe("parseSiteList", () => {
  it("keeps the valid entries, and names each other entry", () => {
    const { list, problems } = parseSiteList({
      format: "pairrank.sites",
      version: 1,
      source: "test",
      sites: [
        { url: "https://a.example/", title: "A", tags: ["x"], dated: "2020-01-01T00:00:00Z", path: ["Bar", "News"] },
        "text",
        { url: "not a url" },
        { url: "javascript:alert(1)" },
        { url: "https://b.example/", title: 3 },
        { url: "https://c.example/", tags: [1] },
        { url: "https://d.example/", dated: "soon" },
        { url: "https://e.example/", path: "Bar" },
      ],
    });
    expect(list.sites.map((site) => site.url)).toEqual(["https://a.example/"]);
    expect(problems.map((problem) => [problem.index, problem.code])).toEqual([
      [1, "not-an-object"],
      [2, "bad-url"],
      [3, "not-a-web-url"],
      [4, "bad-title"],
      [5, "bad-tags"],
      [6, "bad-date"],
      [7, "bad-path"],
    ]);
  });

  it("refuses a value that is not a site list of this version", () => {
    expect(() => parseSiteList(null)).toThrow(/object/);
    expect(() => parseSiteList({ format: "other", version: 1, source: "s", sites: [] })).toThrow(/format/);
    expect(() => parseSiteList({ format: "pairrank.sites", version: 2, source: "s", sites: [] })).toThrow(/version/);
    expect(() => parseSiteList({ format: "pairrank.sites", version: 1, source: "", sites: [] })).toThrow(/source/);
    expect(() => parseSiteList({ format: "pairrank.sites", version: 1, source: "s" })).toThrow(/list of sites/);
  });
});

describe("planImport", () => {
  const empty = replay([]).state;

  it("merges the entries with one key, and makes each new tag one time", () => {
    const entries: Entry[] = [
      { url: "https://a.example/", tags: ["News"], dated: "2021-05-01T00:00:00Z" },
      { url: "https://a.example#top", title: "A", tags: ["news", "Long reads"], dated: "2020-01-01T00:00:00Z" },
      { url: "https://b.example/", tags: [" "], path: ["Bar"] },
    ];
    const { events, report } = planImport(empty, siteList("test", entries), options());
    expect(report).toEqual({ added: 2, merged: 1, existing: 0, tagged: 2, tagsCreated: ["News", "Long reads"] });

    const { state, problems } = replay(events);
    expect(problems).toEqual([]);
    const a = [...state.sites.values()].find((site) => site.url === "https://a.example/");
    expect(a?.title).toBe("A");
    expect(a?.dated).toBe("2020-01-01T00:00:00Z");
    expect(a?.source).toBe("test");
    expect([...(a?.tags ?? [])].map((tag) => state.tags.get(tag)?.name)).toEqual(["News", "Long reads"]);
    expect([...state.tags.values()].map((tag) => tag.name)).toEqual(["News", "Long reads"]);
  });

  it("adds only the new tags to a site that exists, and uses the tags that exist", () => {
    const first = planImport(empty, siteList("test", [{ url: "https://a.example/", tags: ["News"] }]), options());
    const { state } = replay(first.events);
    let n = 100;
    const second = planImport(state, siteList("again", [{ url: "https://a.example", tags: ["NEWS", "Tools"] }, { url: "https://c.example/" }]), {
      ...options(),
      id: () => `j${++n}`,
    });
    expect(second.report).toEqual({ added: 1, merged: 0, existing: 1, tagged: 1, tagsCreated: ["Tools"] });

    const all: Event[] = [...first.events, ...second.events];
    const after = replay(all);
    expect(after.problems).toEqual([]);
    expect(after.state.sites.size).toBe(2);
    const a = [...after.state.sites.values()].find((site) => site.url === "https://a.example/");
    expect([...(a?.tags ?? [])].map((tag) => after.state.tags.get(tag)?.name)).toEqual(["News", "Tools"]);
  });

  it("does not keep the path of an entry", () => {
    const { events } = planImport(empty, siteList("test", [{ url: "https://a.example/", path: ["Bar", "News"] }]), options());
    expect(events).toHaveLength(1);
    expect(JSON.stringify(events)).not.toContain("Bar");
  });

  it("compares by the URL when the key throws", () => {
    const { report } = planImport(empty, siteList("test", [{ url: "https://a.example/" }, { url: "https://a.example/" }]), {
      ...options(),
      key: () => {
        throw new Error("no key");
      },
    });
    expect(report.added).toBe(1);
    expect(report.merged).toBe(1);
  });
});

describe("isWebUrl", () => {
  it("accepts http and https with a host, and refuses the rest", () => {
    expect(isWebUrl("https://example.com/a?b#c")).toBe(true);
    expect(isWebUrl("HTTP://example.com")).toBe(true);
    for (const url of ["chrome://settings", "file:///C:/a.html", "https://", "https:///path", "https://a b.com", "javascript:alert(1)"]) {
      expect(isWebUrl(url), url).toBe(false);
    }
  });

  it("tests a long URL in linear time", () => {
    const url = `http://${"!".repeat(100_000)} `;
    const start = performance.now();
    expect(isWebUrl(url)).toBe(false);
    expect(performance.now() - start).toBeLessThan(1000);
  });
});

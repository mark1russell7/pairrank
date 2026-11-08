import { type Draft, type Event, replay, stamp } from "@pairrank/core";
import type { StateView, TagView } from "@pairrank/host/views";
import { describe, expect, it } from "vitest";
import { APP_KEYS, TAG_COLORS, createDraft, editDraft, findTags, impactOf, keyOf, tagProblem, toggleDraft } from "./tagging.ts";

const tag = (id: string, name: string, key?: string, color?: string): TagView => ({ id, name, key, color, sites: 0 });
const tags = [tag("n", "News", "n"), tag("w", "World")];
const fields = (name: string, key = "", color?: string) => ({ name, key, color });

describe("tagProblem", () => {
  it("needs a name that no other tag has, in each case", () => {
    expect(tagProblem(fields("  "), tags)).toBe("Type a name for the tag.");
    expect(tagProblem(fields(" news "), tags)).toBe('The tag "News" has this name.');
    expect(tagProblem(fields("News"), tags, "n")).toBeUndefined();
    expect(tagProblem(fields("Sport"), tags)).toBeUndefined();
  });

  it("needs a key of one letter or digit that the app and the other tags do not use", () => {
    expect(tagProblem(fields("Sport", "ab"), tags)).toBe("A key is one letter or one digit.");
    expect(tagProblem(fields("Sport", "!"), tags)).toBe("A key is one letter or one digit.");
    expect(tagProblem(fields("Sport", "J"), tags)).toBe("The app uses the key j. Use a different key.");
    expect(tagProblem(fields("Sport", "N"), tags)).toBe('The tag "News" has the key n.');
    expect(tagProblem(fields("News", "n"), tags, "n")).toBeUndefined();
    expect(tagProblem(fields("Sport", "7"), tags)).toBeUndefined();
    for (const key of APP_KEYS) expect(tagProblem(fields("Sport", key), tags)).toContain("The app uses");
  });
});

describe("the drafts", () => {
  it("make a tag with only the fields that it has", () => {
    expect(keyOf(" Q ")).toBe("q");
    expect(keyOf("")).toBeUndefined();
    expect(createDraft("t1", fields(" Sport "))).toEqual({ type: "tag.created", tag: "t1", name: "Sport" });
    expect(createDraft("t1", fields("Sport", "S", TAG_COLORS[0]!.value))).toEqual({ type: "tag.created", tag: "t1", name: "Sport", key: "s", color: "#3d6fb6" });
  });

  it("change only the fields that change, and remove a field with null", () => {
    const news = tag("n", "News", "n", "#3d6fb6");
    expect(editDraft(news, fields("News ", "N", "#3d6fb6"))).toBeUndefined();
    expect(editDraft(news, fields("Daily news", "n", "#3d6fb6"))).toEqual({ type: "tag.edited", tag: "n", name: "Daily news" });
    expect(editDraft(news, fields("News", "", undefined))).toEqual({ type: "tag.edited", tag: "n", color: null, key: null });
  });

  it("put a tag on a site, or remove it", () => {
    expect(toggleDraft({ id: "s", tags: [] }, "n")).toEqual({ type: "site.tagged", site: "s", tag: "n" });
    expect(toggleDraft({ id: "s", tags: ["n"] }, "n")).toEqual({ type: "site.untagged", site: "s", tag: "n" });
  });

  it("agree with the rules of the state", () => {
    let n = 0;
    const events = (drafts: readonly Draft[]): Event[] => drafts.map((draft) => stamp(draft, `e${++n}`, "2026-11-08T12:00:00Z"));
    const news = tag("n", "News");
    const { state, problems } = replay(
      events([
        { type: "site.added", site: "s", url: "https://a.example/" },
        createDraft("n", fields("News", "n", "#188a7e")),
        toggleDraft({ id: "s", tags: [] }, "n"),
        editDraft({ ...news, key: "n", color: "#188a7e" }, fields("Daily news", "", undefined))!,
        toggleDraft({ id: "s", tags: ["n"] }, "n"),
      ]),
    );
    expect(problems).toEqual([]);
    expect(state.tags.get("n")).toMatchObject({ name: "Daily news", key: undefined, color: undefined });
    expect([...state.sites.get("s")!.tags]).toEqual([]);
  });
});

describe("findTags and impactOf", () => {
  it("find the tags by each word of the name, in the order of the names", () => {
    const all = [tag("1", "World news"), tag("2", "Art"), tag("3", "News")];
    expect(findTags(all, "").map((entry) => entry.name)).toEqual(["Art", "News", "World news"]);
    expect(findTags(all, "NEWS").map((entry) => entry.name)).toEqual(["News", "World news"]);
    expect(findTags(all, "news world").map((entry) => entry.name)).toEqual(["World news"]);
  });

  it("count the sites and the picks of a tag", () => {
    const view: StateView = { sites: [], tags: [{ ...tag("n", "News"), sites: 4 }], picks: { "tag:n": 9, overall: 2 }, problems: 0 };
    expect(impactOf(view, "n")).toEqual({ sites: 4, picks: 9 });
    expect(impactOf(view, "x")).toEqual({ sites: 0, picks: 0 });
  });
});

import { describe, expect, it } from "vitest";
import type { Event, Outcome, Scope } from "./events.ts";
import { apply, createState, picksIn, replay, type State } from "./state.ts";

type Draft = Event extends infer E ? (E extends Event ? Omit<E, "id" | "at"> : never) : never;

/** This function gives each draft an id and a time, in order. */
function log(...drafts: Draft[]): Event[] {
  return drafts.map((draft, index) => ({ ...draft, id: `e${index + 1}`, at: `2026-11-08T10:00:${String(index).padStart(2, "0")}Z` }) as Event);
}

const overall: Scope = { kind: "overall" };
const site = (id: string, url = `https://${id}.example/`): Draft => ({ type: "site.added", site: id, url });
const tag = (id: string, name = id, key?: string): Draft => ({ type: "tag.created", tag: id, name, ...(key ? { key } : {}) });
const put = (siteId: string, tagId: string): Draft => ({ type: "site.tagged", site: siteId, tag: tagId });
const pick = (a: string, b: string, outcome: Outcome, scope: Scope = overall): Draft => ({ type: "pick", a, b, outcome, scope });

/** This function gives a plain copy of a state, for a comparison. */
function snapshot(state: State): unknown {
  return JSON.parse(JSON.stringify(state, (_key, value: unknown) => (value instanceof Map ? [...value] : value instanceof Set ? [...value] : value)));
}

const base = [site("a"), site("b"), site("c"), tag("t", "Design", "1"), tag("u", "Tools", "2"), put("a", "t"), put("b", "t"), put("c", "u")];

describe("replay", () => {
  it("builds the sites, the tags and the picks", () => {
    const { state, problems } = replay(log(...base, pick("a", "b", "a"), pick("a", "b", "tie", { kind: "tag", tag: "t" })));
    expect(problems).toEqual([]);
    expect([...state.sites.keys()]).toEqual(["a", "b", "c"]);
    expect(state.sites.get("a")?.tags).toEqual(new Set(["t"]));
    expect(state.tags.get("t")?.name).toBe("Design");
    expect(state.picks.size).toBe(2);
  });

  it("gives the same state for the same log", () => {
    const events = log(...base, pick("a", "b", "b"), { type: "tag.merged", tag: "u", into: "t" });
    expect(snapshot(replay(events).state)).toEqual(snapshot(replay(events).state));
  });

  it("lists each problem and applies the other events", () => {
    const { state, problems } = replay(log(site("a"), site("a"), site("b"), pick("a", "zzz", "a")));
    expect(problems.map((problem) => problem.code)).toEqual(["duplicate-site", "unknown-site"]);
    expect(state.sites.size).toBe(2);
    expect(state.picks.size).toBe(0);
  });
});

describe("the rules", () => {
  const cases: [string, Draft, string][] = [
    ["a second site with one URL", site("d", "https://a.example/"), "duplicate-url"],
    ["a tag with an id that exists", tag("t"), "duplicate-tag"],
    ["a tag with a name that exists, in other case", tag("v", " design "), "duplicate-name"],
    ["a tag with a key that exists", tag("v", "Other", "1"), "duplicate-key"],
    ["a tag with an empty name", tag("v", "  "), "empty-name"],
    ["a tag on an unknown site", put("zzz", "t"), "unknown-site"],
    ["an unknown tag on a site", put("a", "zzz"), "unknown-tag"],
    ["a pick of one site with itself", pick("a", "a", "a"), "same-site"],
    ["a pick under a tag that one site does not have", pick("a", "c", "a", { kind: "tag", tag: "t" }), "missing-tag"],
    ["a removal of a tag that the site does not have", { type: "site.untagged", site: "c", tag: "t" }, "missing-tag"],
    ["a merge of a tag into itself", { type: "tag.merged", tag: "t", into: "t" }, "same-tag"],
    ["an undo of an unknown pick", { type: "pick.undone", pick: "zzz" }, "unknown-pick"],
    ["a restore of a site that is not hidden", { type: "site.restored", site: "a" }, "not-hidden"],
    ["an edit of a URL to the URL of another site", { type: "site.edited", site: "a", url: "https://b.example/" }, "duplicate-url"],
    ["an edit of a tag to a key that exists", { type: "tag.edited", tag: "u", key: "1" }, "duplicate-key"],
  ];

  for (const [name, draft, code] of cases) {
    it(`refuses ${name}, and the state does not change`, () => {
      const { state } = replay(log(...base));
      const before = snapshot(state);
      const problem = apply(state, { ...draft, id: "x", at: "2026-11-08T11:00:00Z" } as Event);
      expect(problem?.code).toBe(code);
      expect(snapshot(state)).toEqual(before);
    });
  }

  it("refuses an event id that is in the log", () => {
    const state = createState();
    const [first] = log(site("a"));
    expect(apply(state, first as Event)).toBeUndefined();
    expect(apply(state, { ...(first as Event), type: "site.added", site: "b", url: "https://b.example/" } as Event)?.code).toBe("duplicate-event");
  });
});

describe("tags", () => {
  it("keeps the picks after a rename, and frees the old name", () => {
    const { state, problems } = replay(
      log(...base, pick("a", "b", "a", { kind: "tag", tag: "t" }), { type: "tag.edited", tag: "t", name: "Looks", key: null }, tag("v", "Design", "1")),
    );
    expect(problems).toEqual([]);
    expect(state.tags.get("t")).toMatchObject({ name: "Looks", key: undefined });
    expect(picksIn(state, { kind: "tag", tag: "t" })).toHaveLength(1);
  });

  it("moves the sites of a merged tag, and refuses the merged tag after", () => {
    const { state, problems } = replay(log(...base, { type: "tag.merged", tag: "u", into: "t" }, put("a", "u"), tag("u")));
    expect(problems.map((problem) => problem.code)).toEqual(["retired-tag", "duplicate-tag"]);
    expect(state.tags.has("u")).toBe(false);
    expect(state.sites.get("c")?.tags).toEqual(new Set(["t"]));
  });

  it("moves a pick under the merged tag to the tag that stays", () => {
    const { state, problems } = replay(
      log(...base, put("a", "u"), pick("a", "c", "b", { kind: "tag", tag: "u" }), { type: "tag.merged", tag: "u", into: "t" }),
    );
    expect(problems).toEqual([]);
    expect(picksIn(state, { kind: "tag", tag: "t" }).map((each) => each.outcome)).toEqual(["b"]);
    expect(picksIn(state, { kind: "tag", tag: "u" })).toEqual([]);
    expect(state.sites.get("a")?.tags).toEqual(new Set(["t"]));
  });

  it("removes the picks of a deleted tag from the ladders, and refuses the tag after", () => {
    const { state, problems } = replay(log(...base, pick("a", "b", "a", { kind: "tag", tag: "t" }), pick("a", "b", "a"), { type: "tag.deleted", tag: "t" }, put("a", "t"), tag("t")));
    expect(problems.map((problem) => problem.code)).toEqual(["retired-tag", "duplicate-tag"]);
    expect(state.picks.size).toBe(1);
    expect(state.sites.get("a")?.tags.size).toBe(0);
  });

  it("keeps the picks of a site after the tag is removed from it", () => {
    const { state } = replay(log(...base, pick("a", "b", "a", { kind: "tag", tag: "t" }), { type: "site.untagged", site: "a", tag: "t" }));
    expect(picksIn(state, { kind: "tag", tag: "t" })).toHaveLength(1);
  });
});

describe("hidden sites and picks", () => {
  it("keeps the picks of a hidden site, and refuses a new pick of it until a restore", () => {
    const { state, problems } = replay(
      log(...base, pick("a", "b", "a"), { type: "site.hidden", site: "a", reason: "gone" }, pick("a", "c", "a"), { type: "site.restored", site: "a" }, pick("a", "c", "b")),
    );
    expect(problems.map((problem) => problem.code)).toEqual(["hidden-site"]);
    expect(picksIn(state, overall).map((each) => each.outcome)).toEqual(["a", "b"]);
    expect(state.sites.get("a")?.hidden).toBe(false);
  });

  it("removes an undone pick, and leaves out skips", () => {
    const { state } = replay(log(...base, pick("a", "b", "a"), pick("a", "c", "skip"), pick("b", "c", "tie"), { type: "pick.undone", pick: "e9" }));
    expect(state.picks.size).toBe(2);
    expect(picksIn(state, overall).map((each) => each.outcome)).toEqual(["tie"]);
  });
});

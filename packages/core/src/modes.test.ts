import { describe, expect, it } from "vitest";
import { type Ask, type Event, MAX_ASKS, parseDraft } from "./events.ts";
import { asksOf } from "./modes.ts";
import { QUERY_LIMITS, type TagQuery, isTagQuery, replaceTag } from "./query.ts";
import { replay } from "./state.ts";

type Draft = Event extends infer E ? (E extends Event ? Omit<E, "id" | "at"> : never) : never;

/** This function gives each draft an id and a time, in order. */
function log(...drafts: Draft[]): Event[] {
  return drafts.map((draft, index) => ({ ...draft, id: `e${index + 1}`, at: `2026-11-08T10:00:${String(index).padStart(2, "0")}Z` }) as Event);
}

const site = (id: string): Draft => ({ type: "site.added", site: id, url: `https://${id}.example/` });
const tag = (id: string, name = id): Draft => ({ type: "tag.created", tag: id, name });
const put = (siteId: string, tagId: string): Draft => ({ type: "site.tagged", site: siteId, tag: tagId });
const has = (tagId: string): TagQuery => ({ kind: "tag", tag: tagId });
const save = (mode: string, name: string, pool: TagQuery, asks: readonly Ask[]): Draft => ({ type: "mode.saved", mode, name, pool, asks });

const base = [site("a"), site("b"), site("c"), tag("t", "News"), tag("u", "Fun"), tag("w", "Work"), put("a", "t"), put("b", "t"), put("a", "u"), put("b", "u"), put("c", "u")];

describe("the duel modes", () => {
  it("saves a mode, replaces it with a save of the same id, and deletes it", () => {
    const { state, problems } = replay(
      log(...base, save("m", " Morning ", { kind: "all" }, [{ kind: "overall" }, { kind: "overall" }, { kind: "shared" }]), save("m", "Evening", has("t"), [{ kind: "tag", tag: "t" }])),
    );
    expect(problems).toEqual([]);
    expect([...state.modes.values()]).toEqual([{ id: "m", name: "Evening", pool: has("t"), asks: [{ kind: "tag", tag: "t" }], saved: "2026-11-08T10:00:12Z" }]);
    expect(replay(log(...base, save("m", "Morning", has("t"), [{ kind: "overall" }]), { type: "mode.deleted", mode: "m" })).state.modes.size).toBe(0);
    // A save keeps one ask of each scope
    expect(replay(log(...base, save("m", "M", { kind: "all" }, [{ kind: "overall" }, { kind: "overall" }]))).state.modes.get("m")?.asks).toEqual([{ kind: "overall" }]);
  });

  it("refuses a mode with the name of another mode, an empty name, an unknown tag or an unknown mode", () => {
    const { problems } = replay(
      log(
        ...base,
        save("m", "Morning", { kind: "all" }, [{ kind: "overall" }]),
        save("n", "morning", { kind: "all" }, [{ kind: "overall" }]),
        save("n", "  ", { kind: "all" }, [{ kind: "overall" }]),
        save("n", "Night", has("x"), [{ kind: "overall" }]),
        save("n", "Night", { kind: "all" }, [{ kind: "tag", tag: "x" }]),
        { type: "mode.deleted", mode: "n" },
      ),
    );
    expect(problems.map((problem) => problem.code)).toEqual(["duplicate-name", "empty-name", "unknown-tag", "unknown-tag", "unknown-mode"]);
  });

  it("follows a merge of tags, and drops the asks of a deleted tag", () => {
    const pool: TagQuery = { kind: "and", queries: [has("t"), { kind: "not", query: has("w") }] };
    const asks: Ask[] = [{ kind: "tag", tag: "t" }, { kind: "tag", tag: "u" }, { kind: "shared" }];
    const merged = replay(log(...base, save("m", "M", pool, asks), { type: "tag.merged", tag: "t", into: "u" })).state.modes.get("m");
    expect(merged?.pool).toEqual({ kind: "and", queries: [has("u"), { kind: "not", query: has("w") }] });
    expect(merged?.asks).toEqual([{ kind: "tag", tag: "u" }, { kind: "shared" }]);

    const deleted = replay(log(...base, save("m", "M", pool, asks), { type: "tag.deleted", tag: "t" })).state.modes.get("m");
    expect(deleted?.pool).toEqual(pool);
    expect(deleted?.asks).toEqual([{ kind: "tag", tag: "u" }, { kind: "shared" }]);
  });

  it("gives the scopes that the asks ask of a pair", () => {
    const { state } = replay(log(...base));
    const [a, b, c] = ["a", "b", "c"].map((id) => state.sites.get(id)!);
    const shared: Ask[] = [{ kind: "overall" }, { kind: "shared" }];
    expect(asksOf(state, shared, a!, b!)).toEqual([{ kind: "overall" }, { kind: "tag", tag: "t" }, { kind: "tag", tag: "u" }]);
    expect(asksOf(state, shared, a!, c!)).toEqual([{ kind: "overall" }, { kind: "tag", tag: "u" }]);
    expect(asksOf(state, [{ kind: "tag", tag: "t" }], a!, c!)).toEqual([]);
    expect(asksOf(state, [{ kind: "tag", tag: "u" }, { kind: "shared" }], a!, b!)).toEqual([{ kind: "tag", tag: "u" }, { kind: "tag", tag: "t" }]);
  });
});

describe("the fields of a mode", () => {
  const draft = (fields: Record<string, unknown>) => () => parseDraft({ type: "mode.saved", mode: "m", name: "M", pool: { kind: "all" }, asks: [{ kind: "overall" }], ...fields });

  it("takes a valid pool and valid asks", () => {
    expect(draft({ pool: { kind: "or", queries: [has("t"), { kind: "not", query: has("u") }] }, asks: [{ kind: "shared" }, { kind: "tag", tag: "t" }] })).not.toThrow();
  });

  it("refuses a pool or asks that are not valid", () => {
    for (const pool of [{ kind: "and", queries: [has("t")] }, { kind: "tag", tag: "" }, { kind: "all", more: 1 }, { kind: "some" }, [], null]) {
      expect(draft({ pool })).toThrow(/field pool/);
    }
    for (const asks of [[], [{ kind: "shared", tag: "t" }], [{ kind: "tag" }], Array.from({ length: MAX_ASKS + 1 }, () => ({ kind: "overall" }))]) {
      expect(draft({ asks })).toThrow(/field asks/);
    }
  });

  it("refuses a pool past the limits", () => {
    let deep: TagQuery = has("t");
    for (let depth = 0; depth <= QUERY_LIMITS.depth; depth++) deep = { kind: "not", query: deep };
    expect(isTagQuery(deep)).toBe(false);
    const wide: TagQuery = { kind: "or", queries: Array.from({ length: QUERY_LIMITS.parts }, () => has("t")) };
    expect(isTagQuery(wide)).toBe(false);
  });

  it("changes each tag of a query in a merge", () => {
    expect(replaceTag({ kind: "or", queries: [has("t"), { kind: "not", query: has("t") }, { kind: "all" }] }, "t", "u")).toEqual({
      kind: "or",
      queries: [has("u"), { kind: "not", query: has("u") }, { kind: "all" }],
    });
  });
});

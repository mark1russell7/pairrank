import type { ModeView, TagView } from "@pairrank/host/views";
import { describe, expect, it } from "vitest";
import { NEW_MODE, OVERALL, asksText, checkForm, formOf, sourceOf, sourceValue, toggleAsk } from "./mode.ts";

const tag = (id: string, name: string): TagView => ({ id, name, color: undefined, key: undefined, sites: 0 });
const TAGS = [tag("n", "News"), tag("r", "Read later")];
const byId = new Map(TAGS.map((each) => [each.id, each]));
const morning: ModeView = { id: "m", name: "Morning", pool: { kind: "and", queries: [{ kind: "tag", tag: "n" }, { kind: "not", query: { kind: "tag", tag: "r" } }] }, asks: [{ kind: "overall" }, { kind: "shared" }] };

describe("the source of a duel", () => {
  it("gives a value for each source, and the source of each value", () => {
    for (const source of [OVERALL, { kind: "scope", scope: { kind: "tag", tag: "n" } }, { kind: "mode", mode: "m" }] as const) expect(sourceOf(sourceValue(source))).toEqual(source);
    expect(sourceOf("something")).toEqual(OVERALL);
  });
});

describe("the mode editor", () => {
  it("gives the fields of a saved mode, with the names of the tags", () => {
    expect(formOf(morning, byId)).toEqual({ name: "Morning", pool: 'News and not "Read later"', asks: morning.asks });
    expect(formOf({ ...morning, pool: { kind: "all" } }, byId).pool).toBe("");
    // A deleted tag keeps its id, so the text has a problem
    expect(formOf({ ...morning, pool: { kind: "tag", tag: "gone" } }, byId).pool).toBe("gone");
  });

  it("adds an ask, and removes it on the second toggle", () => {
    const asks = toggleAsk(NEW_MODE.asks, { kind: "tag", tag: "n" });
    expect(asks).toEqual([{ kind: "overall" }, { kind: "tag", tag: "n" }]);
    expect(toggleAsk(asks, { kind: "overall" })).toEqual([{ kind: "tag", tag: "n" }]);
    expect(toggleAsk(asks, { kind: "tag", tag: "r" })).toHaveLength(3);
  });

  it("gives the draft of a valid form", () => {
    const check = checkForm({ name: " Evening ", pool: "news or -news", asks: [{ kind: "shared" }] }, "e", TAGS, [morning]);
    expect(check).toEqual({
      ok: true,
      pool: { kind: "or", queries: [{ kind: "tag", tag: "n" }, { kind: "not", query: { kind: "tag", tag: "n" } }] },
      draft: { type: "mode.saved", mode: "e", name: "Evening", pool: { kind: "or", queries: [{ kind: "tag", tag: "n" }, { kind: "not", query: { kind: "tag", tag: "n" } }] }, asks: [{ kind: "shared" }] },
    });
    // A mode keeps its own name
    expect(checkForm(formOf(morning, byId), "m", TAGS, [morning]).ok).toBe(true);
  });

  it("gives the problem of each field", () => {
    const empty = checkForm({ name: "  ", pool: "", asks: [] }, "e", TAGS, [morning]);
    expect(empty.ok ? {} : empty.problems).toEqual({ name: "Give the mode a name.", asks: "Choose one pick or more for each pair." });
    const taken = checkForm({ name: "MORNING", pool: "sport", asks: [{ kind: "overall" }] }, "e", TAGS, [morning]);
    expect(taken.ok ? {} : taken.problems).toEqual({ name: "Another mode has this name.", pool: { message: 'No tag has the name "sport".', start: 0, end: 5 } });
  });

  it("tells the asks of a mode in words", () => {
    expect(asksText(morning.asks, byId)).toBe("Overall, then each shared tag");
    expect(asksText([{ kind: "shared" }, { kind: "tag", tag: "r" }], byId)).toBe("Each shared tag, then Read later");
  });
});

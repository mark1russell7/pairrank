import type { SiteView, StateView } from "@pairrank/host/views";
import { describe, expect, it } from "vitest";
import { RUN_HIDE_REASON, firstScope, inScope, isDone, runActionOf, runOf, runStepDraft, runUndoDraft, scopeName, scopeOf, scopeValue, tagStep } from "./run.ts";

const site = (id: string, tags: string[] = [], hidden = false): SiteView => ({
  id,
  url: `https://${id}.example/`,
  title: undefined,
  source: undefined,
  added: "",
  dated: undefined,
  hidden,
  hiddenReason: undefined,
  tags,
});
const tag = { id: "t", name: "Fun", key: "f", color: undefined, sites: 1 };
const view = (sites: SiteView[]) => ({ sites, tags: [tag], picks: 0 }) as unknown as StateView;

describe("the scope of a run", () => {
  const sites = [site("a", ["t"]), site("b"), site("c", ["x"]), site("d", [], true)];

  it("has the sites of the scope in the order of the state, and no hidden site", () => {
    expect(runOf(view(sites), { kind: "all" })).toEqual(["a", "b", "c"]);
    expect(runOf(view(sites), { kind: "untagged" })).toEqual(["b"]);
    expect(runOf(view(sites), { kind: "without", tag: "t" })).toEqual(["b", "c"]);
    expect(inScope(site("d", [], true), { kind: "all" })).toBe(false);
  });

  it("keeps the order of a list of the viewer, with no hidden site and no done site", () => {
    const list = { kind: "list", ids: ["c", "d", "a"], name: "Sites of the viewer" } as const;
    expect(runOf(view(sites), list)).toEqual(["c", "a"]);
    expect([inScope(site("a"), list), inScope(site("b"), list)]).toEqual([true, false]);
    expect(isDone(site("a", ["t"]), list)).toBe(false);
    expect(scopeName(list, [tag])).toBe("Sites of the viewer");
  });

  it("tells when a site of a run is done", () => {
    expect(isDone(site("a", ["x"]), { kind: "untagged" })).toBe(true);
    expect(isDone(site("a", ["x"]), { kind: "without", tag: "t" })).toBe(false);
    expect(isDone(site("a", ["t"]), { kind: "without", tag: "t" })).toBe(true);
    expect(isDone(site("a", ["t"]), { kind: "all" })).toBe(false);
  });

  it("starts with the sites with no tags when there are some", () => {
    expect(firstScope(view(sites))).toEqual({ kind: "untagged" });
    expect(firstScope(view([site("a", ["t"])]))).toEqual({ kind: "all" });
  });

  it("reads the value of each scope again, and names it", () => {
    for (const scope of [{ kind: "all" }, { kind: "untagged" }, { kind: "without", tag: "t:1" }] as const) expect(scopeOf(scopeValue(scope))).toEqual(scope);
    expect(scopeOf("without:")).toEqual({ kind: "all" });
    expect(scopeOf("other")).toEqual({ kind: "all" });
    expect(scopeName({ kind: "without", tag: "t" }, [tag])).toBe("Sites without Fun");
    expect(scopeName({ kind: "without", tag: "gone" }, [tag])).toBe("Sites without a deleted tag");
  });
});

describe("the keys and the steps of a run", () => {
  it("gives the action of each key, in each case of a letter", () => {
    const keys = ["ArrowRight", "J", "Enter", " ", "ArrowLeft", "k", "H", "u", "Backspace", "Escape", "f"];
    expect(keys.map(runActionOf)).toEqual(["next", "next", "next", "next", "previous", "previous", "hide", "undo", "undo", "leave", undefined]);
  });

  it("gives the draft of each step, and the draft that removes it", () => {
    const add = tagStep(site("a"), "t");
    expect(runStepDraft(add)).toEqual({ type: "site.tagged", site: "a", tag: "t" });
    expect(runUndoDraft(add)).toEqual({ type: "site.untagged", site: "a", tag: "t" });
    const remove = tagStep(site("a", ["t"]), "t");
    expect(runStepDraft(remove)).toEqual({ type: "site.untagged", site: "a", tag: "t" });
    expect(runUndoDraft(remove)).toEqual({ type: "site.tagged", site: "a", tag: "t" });
    expect(runStepDraft({ kind: "hide", site: "a" })).toEqual({ type: "site.hidden", site: "a", reason: RUN_HIDE_REASON });
    expect(runUndoDraft({ kind: "hide", site: "a" })).toEqual({ type: "site.restored", site: "a" });
  });
});

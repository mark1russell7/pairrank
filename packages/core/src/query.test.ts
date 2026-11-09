import { type Random, random } from "@mark1russell7/rigor-generators";
import { describe, expect, it } from "vitest";
import { type TagQuery, parseQuery, queryText, tagsOfQuery } from "./query.ts";

const NAMES: Readonly<Record<string, string>> = { news: "News", fun: "Fun", later: "Read later", and: "and", minus: "-x", tools: "tools/dev" };
const tagOf = (name: string): string | undefined => Object.entries(NAMES).find(([, tag]) => tag.toLowerCase() === name.toLowerCase())?.[0];
const nameOf = (tag: string): string => NAMES[tag] ?? tag;
const parse = (text: string) => parseQuery(text, tagOf);
const tag = (id: string): TagQuery => ({ kind: "tag", tag: id });
const not = (query: TagQuery): TagQuery => ({ kind: "not", query });

describe("parseQuery", () => {
  it("reads names, the three words, the minus and brackets, with not before and before or", () => {
    expect(parse("")).toEqual({ ok: true, query: { kind: "all" } });
    expect(parse("  news ")).toEqual({ ok: true, query: tag("news") });
    expect(parse("NEWS fun")).toEqual({ ok: true, query: { kind: "and", queries: [tag("news"), tag("fun")] } });
    expect(parse("news and fun or not tools/dev")).toEqual({
      ok: true,
      query: { kind: "or", queries: [{ kind: "and", queries: [tag("news"), tag("fun")] }, not(tag("tools"))] },
    });
    expect(parse('-(news OR "read later") "and" "-x"')).toEqual({
      ok: true,
      query: { kind: "and", queries: [not({ kind: "or", queries: [tag("news"), tag("later")] }), tag("and"), tag("minus")] },
    });
    expect(parse("not not news")).toEqual({ ok: true, query: tag("news") });
    expect(parse("(news and fun) and (tools/dev)")).toEqual({ ok: true, query: { kind: "and", queries: [tag("news"), tag("fun"), tag("tools")] } });
  });

  it("gives the first problem and its place in the text", () => {
    const problem = (text: string) => {
      const result = parse(text);
      if (result.ok) throw new Error(`"${text}" has no problem.`);
      return [result.problem.message, text.slice(result.problem.start, result.problem.end)];
    };
    expect(problem("news and sports")).toEqual(['No tag has the name "sports".', "sports"]);
    expect(problem("news or")).toEqual(["The query ends before a tag name.", ""]);
    expect(problem("(news fun")).toEqual(["A bracket has no closing bracket.", "(news fun"]);
    expect(problem("news)")).toEqual(["This closing bracket has no opening bracket.", ")"]);
    expect(problem("and news")).toEqual(['A tag name must come before "and". Put a tag with this name in quotes.', "and"]);
    expect(problem('"read later')).toEqual(["A quoted name has no closing quote.", '"read later']);
    expect(problem("news - ")).toEqual(["The query ends before a tag name.", ""]);
  });
});

/** This function gives a random query of a depth of `depth` or less. */
function randomQuery(draw: Random, depth: number): TagQuery {
  const kind = depth === 0 ? "tag" : draw.pick(["tag", "not", "and", "or"] as const);
  if (kind === "tag") return tag(draw.pick(Object.keys(NAMES)));
  if (kind === "not") return not(randomQuery(draw, depth - 1));
  return { kind, queries: Array.from({ length: draw.int(2, 3) }, () => randomQuery(draw, depth - 1)) };
}

/** This function gives the normal form of `parseQuery`: no double `not`, and no join inside a join of the same kind. */
function normal(query: TagQuery): TagQuery {
  if (query.kind === "not") {
    const inner = normal(query.query);
    return inner.kind === "not" ? inner.query : not(inner);
  }
  if (query.kind === "and" || query.kind === "or") {
    const kind = query.kind;
    return { kind, queries: query.queries.map(normal).flatMap((part) => (part.kind === kind ? part.queries : [part])) };
  }
  return query;
}

describe("queryText", () => {
  it("gives a text that parseQuery reads as the same query, for 500 random queries", () => {
    for (let seed = 1; seed <= 500; seed++) {
      const query = normal(randomQuery(random(seed), 4));
      const text = queryText(query, nameOf);
      expect(parse(text), `seed ${seed}: ${text}`).toEqual({ ok: true, query });
    }
  });

  it("puts brackets only where the order of the operators needs them", () => {
    const query = { kind: "and", queries: [{ kind: "or", queries: [tag("news"), tag("fun")] }, not(tag("later"))] } as const;
    expect(queryText(query, nameOf)).toBe('(News or Fun) and not "Read later"');
    expect(queryText({ kind: "all" }, nameOf)).toBe("");
  });
});

describe("tagsOfQuery", () => {
  it("gives each tag of a query one time", () => {
    const query = parse("news and (fun or not news) -tools/dev");
    expect(query.ok && tagsOfQuery(query.query)).toEqual(["news", "fun", "tools"]);
  });
});

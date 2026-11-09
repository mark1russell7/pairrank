/**
 * The tag queries of the viewer. A query is a filter of the sites by their tags, as data. The text form has tag names,
 * the words `and`, `or` and `not`, a `-` before a name for `not`, and brackets. Two parts with nothing between them are
 * an `and`. A name with a space or a bracket goes in double quotes. The host evaluates a query with Vex.
 */
import type { TagId } from "./events.ts";

/** A filter of the sites by their tags. The query `all` agrees with each site. */
export type TagQuery =
  | { readonly kind: "all" }
  | { readonly kind: "tag"; readonly tag: TagId }
  | { readonly kind: "not"; readonly query: TagQuery }
  | { readonly kind: "and" | "or"; readonly queries: readonly TagQuery[] };

/** A problem of the text of a query: a message, and the start and the end of the part with the problem. */
export interface QueryProblem {
  readonly message: string;
  readonly start: number;
  readonly end: number;
}

/** The result of `parseQuery`: the query, or the first problem of the text. */
export type QueryParse = { readonly ok: true; readonly query: TagQuery } | { readonly ok: false; readonly problem: QueryProblem };

interface Token {
  readonly kind: "open" | "close" | "minus" | "word" | "quoted";
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

class Refusal extends Error {
  readonly problem: QueryProblem;
  constructor(problem: QueryProblem) {
    super(problem.message);
    this.problem = problem;
  }
}

const refuse = (message: string, start: number, end: number): never => {
  throw new Refusal({ message, start, end });
};

function tokensOf(text: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < text.length) {
    const char = text[i] as string;
    if (/\s/.test(char)) {
      i++;
    } else if (char === "(" || char === ")") {
      tokens.push({ kind: char === "(" ? "open" : "close", text: char, start: i, end: i + 1 });
      i++;
    } else if (char === "-") {
      tokens.push({ kind: "minus", text: char, start: i, end: i + 1 });
      i++;
    } else if (char === '"') {
      const close = text.indexOf('"', i + 1);
      if (close === -1) refuse("A quoted name has no closing quote.", i, text.length);
      tokens.push({ kind: "quoted", text: text.slice(i + 1, close), start: i, end: close + 1 });
      i = close + 1;
    } else {
      const start = i;
      while (i < text.length && !/[\s()"]/.test(text[i] as string)) i++;
      tokens.push({ kind: "word", text: text.slice(start, i), start, end: i });
    }
  }
  return tokens;
}

const keyword = (token: Token | undefined, word: "and" | "or" | "not"): boolean => token?.kind === "word" && token.text.toLowerCase() === word;

/** This function joins parts with `and` or `or`, and puts the parts of an inner join of the same kind in the outer join. */
function join(kind: "and" | "or", parts: readonly TagQuery[]): TagQuery {
  const queries = parts.flatMap((part) => (part.kind === kind ? part.queries : [part]));
  return queries.length === 1 ? (queries[0] as TagQuery) : { kind, queries };
}

/**
 * This function reads the text of a query. The function `tagOf` gives the id of the tag with a name, or `undefined` when
 * no tag has the name. An empty text gives the query `all`. The order of the operators is `not`, then `and`, then `or`.
 */
export function parseQuery(text: string, tagOf: (name: string) => TagId | undefined): QueryParse {
  try {
    const tokens = tokensOf(text);
    if (tokens.length === 0) return { ok: true, query: { kind: "all" } };
    let at = 0;
    const peek = (): Token | undefined => tokens[at];
    const end = (): number => tokens[at - 1]?.end ?? 0;

    const or = (): TagQuery => {
      const parts = [and()];
      while (keyword(peek(), "or")) {
        at++;
        parts.push(and());
      }
      return join("or", parts);
    };
    const and = (): TagQuery => {
      const parts = [unary()];
      for (;;) {
        const next = peek();
        if (next === undefined || next.kind === "close" || keyword(next, "or")) break;
        if (keyword(next, "and")) at++;
        parts.push(unary());
      }
      return join("and", parts);
    };
    const unary = (): TagQuery => {
      const next = peek();
      if (next?.kind === "minus" || keyword(next, "not")) {
        at++;
        const query = unary();
        return query.kind === "not" ? query.query : { kind: "not", query };
      }
      return atom();
    };
    const atom = (): TagQuery => {
      const token = peek();
      if (token === undefined) return refuse("The query ends before a tag name.", end(), end());
      at++;
      if (token.kind === "open") {
        const query = or();
        if (peek()?.kind !== "close") refuse("A bracket has no closing bracket.", token.start, end());
        at++;
        return query;
      }
      if (token.kind === "close") return refuse("This closing bracket has no opening bracket.", token.start, token.end);
      if (token.kind === "word" && (keyword(token, "and") || keyword(token, "or"))) {
        return refuse(`A tag name must come before "${token.text}". Put a tag with this name in quotes.`, token.start, token.end);
      }
      if (token.kind === "minus") return refuse("A tag name must come after the minus.", token.start, token.end);
      const tag = tagOf(token.text);
      if (tag === undefined) return refuse(`No tag has the name "${token.text}".`, token.start, token.end);
      return { kind: "tag", tag };
    };

    const query = or();
    const rest = peek();
    if (rest !== undefined) refuse("This closing bracket has no opening bracket.", rest.start, rest.end);
    return { ok: true, query };
  } catch (error) {
    if (error instanceof Refusal) return { ok: false, problem: error.problem };
    throw error;
  }
}

const PLAIN = /^[^\s()"-][^\s()"]*$/;

/** This function gives the text of a query. `parseQuery` reads it again and gives the same query. */
export function queryText(query: TagQuery, nameOf: (tag: TagId) => string): string {
  const text = (part: TagQuery, outer: "and" | "or" | "not" | "top"): string => {
    switch (part.kind) {
      case "all":
        return "";
      case "tag": {
        const name = nameOf(part.tag);
        return PLAIN.test(name) && !["and", "or", "not"].includes(name.toLowerCase()) ? name : `"${name}"`;
      }
      case "not":
        return `not ${text(part.query, "not")}`;
      default: {
        const inner = part.queries.map((each) => text(each, part.kind)).join(` ${part.kind} `);
        const bracket = outer === "not" || (outer === "and" && part.kind === "or");
        return bracket ? `(${inner})` : inner;
      }
    }
  };
  return text(query, "top");
}

/** This function gives the tags that a query names, each one time, in the order of the text. */
export function tagsOfQuery(query: TagQuery): TagId[] {
  const tags = new Set<TagId>();
  const visit = (part: TagQuery): void => {
    if (part.kind === "tag") tags.add(part.tag);
    else if (part.kind === "not") visit(part.query);
    else if (part.kind !== "all") part.queries.forEach(visit);
  };
  visit(query);
  return [...tags];
}

/** The most parts (tags, `not`, `and` and `or`) of a query in an event, and its deepest nesting. */
export const QUERY_LIMITS = { parts: 200, depth: 32 } as const;

/**
 * This function tells if a stored value is a valid query. A join has two or more parts, and each tag is a text that is
 * not empty. The parts and the depth stay inside `QUERY_LIMITS`.
 */
export function isTagQuery(value: unknown): value is TagQuery {
  let parts = 0;
  const valid = (part: unknown, depth: number): boolean => {
    if (++parts > QUERY_LIMITS.parts || depth > QUERY_LIMITS.depth) return false;
    if (typeof part !== "object" || part === null || Array.isArray(part)) return false;
    const record = part as Readonly<Record<string, unknown>>;
    const keys = Object.keys(record).length;
    switch (record["kind"]) {
      case "all":
        return keys === 1;
      case "tag":
        return keys === 2 && typeof record["tag"] === "string" && record["tag"] !== "";
      case "not":
        return keys === 2 && valid(record["query"], depth + 1);
      case "and":
      case "or": {
        const queries = record["queries"];
        return keys === 2 && Array.isArray(queries) && queries.length >= 2 && queries.every((each) => valid(each, depth + 1));
      }
      default:
        return false;
    }
  };
  return valid(value, 0);
}

/** This function gives the query with the tag `from` changed to the tag `into`, for a merge of tags. */
export function replaceTag(query: TagQuery, from: TagId, into: TagId): TagQuery {
  switch (query.kind) {
    case "all":
      return query;
    case "tag":
      return query.tag === from ? { kind: "tag", tag: into } : query;
    case "not":
      return { kind: "not", query: replaceTag(query.query, from, into) };
    default:
      return { kind: query.kind, queries: query.queries.map((each) => replaceTag(each, from, into)) };
  }
}

/**
 * The rules of the duel modes on the screen, with no React code. A duel picks under one scope or under a saved mode.
 * This module gives the value of each choice, and the checks and the draft of the mode editor.
 */
import { type Ask, type Draft, type ModeId, type QueryProblem, type Scope, type TagQuery, parseQuery, queryText } from "@pairrank/core";
import type { ModeView, TagView } from "@pairrank/host/views";

/** The source of the pairs of a duel: one scope, or a saved mode. */
export type DuelSource = { readonly kind: "scope"; readonly scope: Scope } | { readonly kind: "mode"; readonly mode: ModeId };

/** The first source of a duel. */
export const OVERALL: DuelSource = { kind: "scope", scope: { kind: "overall" } };

/** This function gives the value of a source in the select of the duel. */
export function sourceValue(source: DuelSource): string {
  if (source.kind === "mode") return `mode:${source.mode}`;
  return source.scope.kind === "overall" ? "overall" : `tag:${source.scope.tag}`;
}

/** This function gives the source of a value of the select of the duel. */
export function sourceOf(value: string): DuelSource {
  if (value.startsWith("mode:")) return { kind: "mode", mode: value.slice("mode:".length) };
  if (value.startsWith("tag:")) return { kind: "scope", scope: { kind: "tag", tag: value.slice("tag:".length) } };
  return OVERALL;
}

/** This function gives the name of the scope of a pick: "Overall", or the name of the tag. */
export function askName(scope: Scope, tags: ReadonlyMap<string, TagView>): string {
  return scope.kind === "overall" ? "Overall" : (tags.get(scope.tag)?.name ?? scope.tag);
}

/** The fields of the mode editor, as the user types them. */
export interface ModeForm {
  readonly name: string;
  /** The text of the pool, as in the tag query of the Sites screen. An empty text takes each site. */
  readonly pool: string;
  readonly asks: readonly Ask[];
}

/** The fields of a new mode. A new mode asks one pick overall. */
export const NEW_MODE: ModeForm = { name: "", pool: "", asks: [{ kind: "overall" }] };

/**
 * This function gives the fields of a saved mode. A tag of the pool that is not in the view keeps its id, so the text
 * of the pool shows a problem.
 */
export function formOf(mode: ModeView, tags: ReadonlyMap<string, TagView>): ModeForm {
  const nameOf = (tag: string): string => tags.get(tag)?.name ?? tag;
  return { name: mode.name, pool: mode.pool.kind === "all" ? "" : queryText(mode.pool, nameOf), asks: mode.asks };
}

/** This function tells if two asks are the same. */
export function sameAsk(a: Ask, b: Ask): boolean {
  return a.kind === b.kind && (a.kind !== "tag" || (b.kind === "tag" && a.tag === b.tag));
}

/** This function adds an ask to the list, or removes it when the list has it. */
export function toggleAsk(asks: readonly Ask[], ask: Ask): Ask[] {
  return asks.some((each) => sameAsk(each, ask)) ? asks.filter((each) => !sameAsk(each, ask)) : [...asks, ask];
}

/** The problems of the fields of the editor. A field with no problem has no entry. */
export interface FormProblems {
  readonly name?: string;
  readonly pool?: QueryProblem;
  readonly asks?: string;
}

/** The result of `checkForm`: the draft of the save, or the problems of the fields. */
export type FormCheck = { readonly ok: true; readonly pool: TagQuery; readonly draft: Draft } | { readonly ok: false; readonly problems: FormProblems; readonly pool?: TagQuery };

/**
 * This function examines the fields of the editor. It reads the pool with the names of the tags. A name must not be
 * empty, and no other mode can have the name in any case. A mode needs one ask or more.
 */
export function checkForm(form: ModeForm, id: ModeId, tags: readonly TagView[], modes: readonly ModeView[]): FormCheck {
  const names = new Map(tags.map((tag) => [tag.name.toLowerCase(), tag.id]));
  const parsed = parseQuery(form.pool, (name) => names.get(name.toLowerCase()));
  const name = form.name.trim();
  const problems: { name?: string; pool?: QueryProblem; asks?: string } = {};
  if (name === "") problems.name = "Give the mode a name.";
  else if (modes.some((mode) => mode.id !== id && mode.name.trim().toLowerCase() === name.toLowerCase())) problems.name = "Another mode has this name.";
  if (!parsed.ok) problems.pool = parsed.problem;
  if (form.asks.length === 0) problems.asks = "Choose one pick or more for each pair.";
  if (!parsed.ok || problems.name !== undefined || problems.asks !== undefined) return parsed.ok ? { ok: false, problems, pool: parsed.query } : { ok: false, problems };
  return { ok: true, pool: parsed.query, draft: { type: "mode.saved", mode: id, name, pool: parsed.query, asks: form.asks } };
}

/** This function gives the text of the asks of a mode, for example "Overall, then each shared tag". */
export function asksText(asks: readonly Ask[], tags: ReadonlyMap<string, TagView>): string {
  const parts = asks.map((ask) => (ask.kind === "shared" ? "each shared tag" : askName(ask, tags)));
  return parts.map((part, index) => (index === 0 ? part[0]!.toUpperCase() + part.slice(1) : part)).join(", then ");
}

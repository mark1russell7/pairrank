/**
 * The rules of the tag run, with no React. A run shows the sites of a scope one at a time. The list of a run is fixed
 * at its start, so a site stays in the run after a tag. This module gives the keys and the drafts of the undo.
 */
import type { Draft } from "@pairrank/core";
import type { SiteView, StateView, TagView } from "@pairrank/host/views";

/**
 * The scope of a run: each site, the sites with no tags, or the sites that do not have one tag. A scope can also be a
 * fixed list of sites in its order. The viewer gives a list, with a name for the user.
 */
export type RunScope =
  | { readonly kind: "all" }
  | { readonly kind: "untagged" }
  | { readonly kind: "without"; readonly tag: string }
  | { readonly kind: "list"; readonly ids: readonly string[]; readonly name: string };

/** This function tells if a site is in a scope. A hidden site is in no scope. */
export function inScope(site: SiteView, scope: RunScope): boolean {
  if (site.hidden) return false;
  if (scope.kind === "untagged") return site.tags.length === 0;
  if (scope.kind === "list") return scope.ids.includes(site.id);
  return scope.kind === "without" ? !site.tags.includes(scope.tag) : true;
}

/** This function gives the ids of the sites of a scope, in the order of the state. A list keeps its own order. */
export function runOf(view: StateView, scope: RunScope): string[] {
  if (scope.kind === "list") {
    const shown = new Set(view.sites.flatMap((site) => (site.hidden ? [] : [site.id])));
    return scope.ids.filter((id) => shown.has(id));
  }
  return view.sites.filter((site) => inScope(site, scope)).map((site) => site.id);
}

/**
 * This function tells if a site of a run is done. In a run over the sites with no tags, a done site has a tag. In a
 * run over the sites without a tag, a done site has that tag. A run over each site has no done sites.
 */
export function isDone(site: SiteView, scope: RunScope): boolean {
  if (scope.kind === "untagged") return site.tags.length > 0;
  return scope.kind === "without" ? site.tags.includes(scope.tag) : false;
}

/** This function gives the text of the value of a scope in a list of choices. `scopeOf` reads it, except for a list. */
export function scopeValue(scope: RunScope): string {
  return scope.kind === "without" ? `without:${scope.tag}` : scope.kind;
}

/** This function reads the text of `scopeValue`. A text that it does not know gives the scope of each site. */
export function scopeOf(value: string): RunScope {
  if (value === "untagged") return { kind: "untagged" };
  if (value.startsWith("without:") && value.length > "without:".length) return { kind: "without", tag: value.slice("without:".length) };
  return { kind: "all" };
}

/** This function gives the name of a scope for the user. */
export function scopeName(scope: RunScope, tags: readonly TagView[]): string {
  if (scope.kind === "untagged") return "Sites with no tags";
  if (scope.kind === "all") return "All sites";
  if (scope.kind === "list") return scope.name;
  return `Sites without ${tags.find((tag) => tag.id === scope.tag)?.name ?? "a deleted tag"}`;
}

/** This function gives the scope at the start of a run: the sites with no tags when there are some, or else each site. */
export function firstScope(view: StateView): RunScope {
  return view.sites.some((site) => inScope(site, { kind: "untagged" })) ? { kind: "untagged" } : { kind: "all" };
}

/** An action of a run. A tag key is not an action. It puts a tag on the site, or removes the tag. */
export type RunAction = "next" | "previous" | "hide" | "undo" | "leave";

/** The keys of a run. `j`, `k`, `h` and `u` are in `APP_KEYS`, so no tag takes them. */
export const RUN_KEYS: Readonly<Record<RunAction, readonly string[]>> = {
  next: ["ArrowRight", "j", "Enter", " "],
  previous: ["ArrowLeft", "k"],
  hide: ["h"],
  undo: ["u", "Backspace"],
  leave: ["Escape"],
};

/** This function gives the action of a key, or `undefined`. The letters agree in each case. */
export function runActionOf(key: string): RunAction | undefined {
  const folded = key.length === 1 ? key.toLowerCase() : key;
  for (const [action, keys] of Object.entries(RUN_KEYS) as [RunAction, readonly string[]][]) if (keys.includes(folded)) return action;
  return undefined;
}

/** One step of a run that an undo can remove. */
export type RunStep = { readonly kind: "tag"; readonly site: string; readonly tag: string; readonly added: boolean } | { readonly kind: "hide"; readonly site: string };

/** The reason of a hide in a run. The list of the hidden sites shows it. */
export const RUN_HIDE_REASON = "Hidden in a tag run.";

/** This function gives the draft of a step. */
export function runStepDraft(step: RunStep): Draft {
  if (step.kind === "hide") return { type: "site.hidden", site: step.site, reason: RUN_HIDE_REASON };
  return step.added ? { type: "site.tagged", site: step.site, tag: step.tag } : { type: "site.untagged", site: step.site, tag: step.tag };
}

/** This function gives the draft that removes a step. */
export function runUndoDraft(step: RunStep): Draft {
  if (step.kind === "hide") return { type: "site.restored", site: step.site };
  return runStepDraft({ ...step, added: !step.added });
}

/** This function gives the step of a tag key on a site: it adds the tag, or removes it when the site has it. */
export function tagStep(site: SiteView, tag: string): RunStep {
  return { kind: "tag", site: site.id, tag, added: !site.tags.includes(tag) };
}

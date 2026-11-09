/**
 * The duel modes. A mode has a pool of sites and the asks of each pair. This module gives the scopes that a mode asks
 * of one pair.
 */
import { type Ask, type Scope, scopeKey } from "./events.ts";
import type { Site, State } from "./state.ts";

/**
 * This function gives the scopes of the picks that the asks ask of the sites `a` and `b`, each one time. An ask
 * `overall` gives the overall scope. A tag ask gives the scope of its tag when the two sites have the tag. The ask
 * `shared` gives the scope of each tag of the two sites, in the order of the tags of the state.
 */
export function asksOf(state: State, asks: readonly Ask[], a: Site, b: Site): Scope[] {
  const scopes = new Map<string, Scope>();
  const add = (scope: Scope): void => void (scopes.has(scopeKey(scope)) || scopes.set(scopeKey(scope), scope));
  for (const ask of asks) {
    if (ask.kind === "overall") add(ask);
    else if (ask.kind === "tag") {
      if (a.tags.has(ask.tag) && b.tags.has(ask.tag)) add(ask);
    } else for (const tag of state.tags.keys()) if (a.tags.has(tag) && b.tags.has(tag)) add({ kind: "tag", tag });
  }
  return [...scopes.values()];
}

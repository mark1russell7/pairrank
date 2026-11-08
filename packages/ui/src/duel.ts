/**
 * The rules of the duel, with no React code. This module gives the keys and the drafts of each action. It also gives
 * the pairs that the choice of the next pair must avoid.
 */
import type { Draft, Outcome, Scope } from "@pairrank/core";

/** An action of the duel. */
export type DuelAction = "left" | "right" | "tie" | "skip" | "hide" | "undo";

/**
 * The keys of the duel. The left and the right arrows pick a side. `t`, `s`, `h` and `u` are in `APP_KEYS`, so no tag
 * takes them.
 */
export const DUEL_KEYS: Readonly<Record<DuelAction, readonly string[]>> = {
  left: ["ArrowLeft", "1"],
  right: ["ArrowRight", "2"],
  tie: ["t", "ArrowDown"],
  skip: ["s", " "],
  hide: ["h"],
  undo: ["u", "Backspace"],
};

/** This function gives the action of a key, or `undefined`. The letters agree in each case. */
export function actionOf(key: string): DuelAction | undefined {
  const folded = key.length === 1 ? key.toLowerCase() : key;
  for (const [action, keys] of Object.entries(DUEL_KEYS) as [DuelAction, readonly string[]][]) if (keys.includes(folded)) return action;
  return undefined;
}

/** A pair on the screen. `a` is the left site, and `b` is the right site. */
export interface Pair {
  readonly a: string;
  readonly b: string;
}

/** One step of a duel that an undo can remove. */
export type DuelStep =
  | { readonly kind: "pick"; readonly pair: Pair; readonly outcome: Outcome; readonly event: string }
  | { readonly kind: "hide"; readonly pair: Pair; readonly site: string };

/** This function gives the outcome of a pick action. The left site is `a` of the pick. */
export function outcomeOf(action: "left" | "right" | "tie" | "skip"): Outcome {
  return action === "left" ? "a" : action === "right" ? "b" : action;
}

/** This function gives the draft of a pick between the two sites of a pair. */
export function pickDraft(pair: Pair, scope: Scope, outcome: Outcome, duel: string): Draft {
  return { type: "pick", a: pair.a, b: pair.b, scope, outcome, duel };
}

/** This function gives the draft that removes the last step of a duel. */
export function undoDraft(step: DuelStep): Draft {
  return step.kind === "pick" ? { type: "pick.undone", pick: step.event } : { type: "site.restored", site: step.site };
}

/** The count of the last pairs that the choice of the next pair avoids. */
export const RECENT_PAIRS = 20;

/** This function gives the last pairs of a duel, with the pair on the screen, for `pairrank.pair`. */
export function recentOf(steps: readonly DuelStep[], current?: Pair): (readonly [string, string])[] {
  const pairs = steps.map((step) => [step.pair.a, step.pair.b] as const);
  if (current !== undefined) pairs.push([current.a, current.b]);
  return pairs.slice(-RECENT_PAIRS);
}

/** This function gives the seed of a round of a duel, so a duel gives the same pairs again for the same picks. */
export function seedOf(duel: string, round: number): string {
  return `${duel}:${round}`;
}

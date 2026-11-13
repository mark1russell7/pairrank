/**
 * The cache of the ladders and of the model tests of the host. A fit reads each pick of its scope, so the host keeps
 * each result until the state accepts a new event. The LRU cache is `lruCache` of `@mark1russell7/collections`.
 *
 * The version of a state is the state object and the count of its accepted events. The state changes only when it
 * accepts an event, and each accepted event adds its id. After a failed write, the store replays its file into a new
 * state object. Thus a new version clears the cache, and a result in the cache is always the result of a new fit.
 */
import { lruCache } from "@mark1russell7/collections";
import type { RatingFitOptions } from "@mark1russell7/rigor-statistics";
import { type Scope, type State, scopeKey } from "@pairrank/core";
import { type Ladder, type LadderOptions, type ModelChoice, ladderOf, selectModel } from "@pairrank/ratings";

/**
 * The count of the results that the cache keeps. A mean of tags has 100 scopes or fewer, so the ladders of one order
 * stay in the cache with each model.
 */
export const LADDER_CACHE_SIZE = 256;

/** A source of the ladders: `ladderOf` of `@pairrank/ratings`, or the function `ladder` of a cache. */
export type LadderSource = (state: State, scope: Scope, options?: LadderOptions) => Ladder;

/** A cache of the ladders and of the model tests of one state. The results do not change: they are frozen. */
export interface LadderCache {
  /** This function gives the ladder of a scope, as `ladderOf` gives it. The setting `best` uses the cached model test. */
  readonly ladder: LadderSource;
  /** This function gives the model test of a scope, as `selectModel` gives it. */
  readonly model: (state: State, scope: Scope) => ModelChoice;
  /** The count of the fits and of the tests that the cache did. A test reads it. */
  readonly fits: () => number;
}

/** This function freezes a ladder or a model test, and the items of its list. */
function frozen<T extends object>(value: T, list: readonly object[]): T {
  for (const item of list) Object.freeze(item);
  Object.freeze(list);
  return Object.freeze(value);
}

/** This function makes a cache of the ladders. `capacity` is the count of the results that it keeps. */
export function ladderCache(capacity: number = LADDER_CACHE_SIZE): LadderCache {
  const results = lruCache<string, Ladder | ModelChoice>(capacity);
  let version: { state: State; events: number } | undefined;
  let fits = 0;
  /** This function gives the cached result of `key`, or makes it. A new version of the state clears the cache first. */
  const cached = <T extends Ladder | ModelChoice>(state: State, key: string, make: () => T): T => {
    if (version?.state !== state || version.events !== state.events.size) {
      results.clear();
      version = { state, events: state.events.size };
    }
    const hit = results.get(key);
    if (hit !== undefined) return hit as T;
    fits++;
    const result = make();
    results.set(key, result);
    return result;
  };
  const test = (state: State, scope: Scope, fit: RatingFitOptions): ModelChoice =>
    cached(state, `model ${scopeKey(scope)} ${JSON.stringify(fit)}`, () => {
      const choice = selectModel(state, scope, fit);
      return frozen(choice, choice.scores);
    });
  const ladder = (state: State, scope: Scope, options: LadderOptions = {}): Ladder => {
    const { model: setting, ...fit } = options;
    // The setting best is the ladder of the model that the test chooses. The test is in the cache too.
    const name = setting === "best" ? test(state, scope, fit).model : (setting ?? "bradley-terry");
    return cached(state, `ladder ${scopeKey(scope)} ${name} ${JSON.stringify(fit)}`, () => {
      const result = ladderOf(state, scope, { ...fit, model: name });
      return frozen(result, result.ratings);
    });
  };
  return { ladder, model: (state, scope) => test(state, scope, {}), fits: () => fits };
}

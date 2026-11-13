/**
 * The choice of the model of a scope by the log-loss on held-out picks. The math is `selectRatingModel` of
 * `@mark1russell7/rigor-statistics`. This file only gives it the sites and the picks of a scope.
 */
import { type RatingModelChoice, type RatingModelOptions, selectRatingModel } from "@mark1russell7/rigor-statistics";
import type { Scope, State } from "@pairrank/core";
import { logOf } from "./ladder.ts";

/** The result of a choice: the best model, the log-loss of each model, and the counts of the trained and the tested picks. */
export type ModelChoice = RatingModelChoice;

/**
 * This function chooses the model of a scope. Each model learns from the first picks of the scope and forecasts the
 * last picks. With too few picks, the choice is `bradley-terry` with no scores. `selectRatingModel` tells the steps.
 */
export function selectModel(state: State, scope: Scope, options: RatingModelOptions = {}): ModelChoice {
  const { sites, comparisons } = logOf(state, scope);
  return selectRatingModel(sites.length, comparisons, options);
}

/**
 * The choice of the model of a scope by the log-loss on held-out picks. The math is `selectRatingModel` of
 * `@mark1russell7/rigor-statistics`. This file only gives it the sites and the picks of a scope.
 */
import { type RatingModelChoice, type RatingModelOptions, selectRatingModel } from "@mark1russell7/rigor-statistics";
import type { Scope, State } from "@pairrank/core";
import { type Ladder, logOf, startFrom } from "./ladder.ts";

/** The result of a choice: the best model, the log-loss of each model, and the counts of the trained and the tested picks. */
export type ModelChoice = RatingModelChoice;

/** The options of `selectModel`: the options of `selectRatingModel`, and a ladder for the start of the fits. */
export interface ModelOptions extends RatingModelOptions {
  /** A ladder of the same scope in an earlier state. The Bradley-Terry fits of the test start from its ratings. */
  readonly from?: Ladder;
}

/**
 * This function chooses the model of a scope. Each model learns from the first picks of the scope and forecasts the
 * last picks. With too few picks, the choice is `bradley-terry` with no scores. `selectRatingModel` tells the steps.
 */
export function selectModel(state: State, scope: Scope, options: ModelOptions = {}): ModelChoice {
  const { sites, comparisons } = logOf(state, scope);
  const { from, ...rest } = options;
  return selectRatingModel(sites.length, comparisons, startFrom(rest, sites, from));
}

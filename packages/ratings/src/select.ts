/**
 * The choice of a model by the log-loss on held-out picks. Each model learns from the earlier picks of a scope and
 * forecasts the later picks. The model with the lowest log-loss is the best.
 */
import { logLoss, pairProbabilities } from "@mark1russell7/rigor-statistics";
import { type Scope, type State, picksIn } from "@pairrank/core";
import { type LadderOptions, type ModelName, comparisonsOf, fit, sitesOf } from "./ladder.ts";

/** The log-loss of one model. */
export interface ModelScore {
  readonly model: ModelName;
  /** The mean of `-ln(p)` over the held-out picks, with `p` the forecast of the outcome that happened. Lower is better. */
  readonly logLoss: number;
}

/** The result of a choice. */
export interface ModelChoice {
  /** The best model, or `bradley-terry` when the scope has too few picks for a test. */
  readonly model: ModelName;
  /** The score of each model, from the best to the worst. It is empty when the scope has too few picks. */
  readonly scores: readonly ModelScore[];
  readonly trained: number;
  readonly tested: number;
}

/** The options of a choice. */
export interface SelectOptions extends LadderOptions {
  /** The part of the picks, at the end of the log, that the test uses. The default is 0.2. */
  readonly holdout?: number;
  /** The fewest picks that a test needs. With fewer, the choice is `bradley-terry`. The default is 30. */
  readonly minimum?: number;
  /** The models to compare. The default is all three. */
  readonly models?: readonly ModelName[];
}

/** The lowest probability of a forecast. An outcome with a probability of 0 would give a log-loss of Infinity. */
const FLOOR = 1e-9;

/**
 * This function chooses the model of a scope. Each model learns from the first picks and forecasts the last picks. All
 * models use the tie parameter of the Bradley-Terry fit of the first picks. Thus the strengths are the only difference.
 */
export function selectModel(state: State, scope: Scope, options: SelectOptions = {}): ModelChoice {
  const holdout = options.holdout ?? 0.2;
  const minimum = options.minimum ?? 30;
  const models = options.models ?? ["bradley-terry", "elo", "glicko2"];
  const picks = picksIn(state, scope);
  const sites = sitesOf(state, scope, picks);
  const index = new Map(sites.map((site, i) => [site, i]));
  const comparisons = comparisonsOf(picks, index);
  const tested = Math.floor(comparisons.length * holdout);
  if (comparisons.length < minimum || tested < 1) return { model: "bradley-terry", scores: [], trained: comparisons.length, tested: 0 };

  const train = comparisons.slice(0, comparisons.length - tested);
  const test = comparisons.slice(comparisons.length - tested);
  const tie = fit("bradley-terry", sites.length, train, options).tie;
  const scores = models.map((model): ModelScore => {
    const { strengths } = fit(model, sites.length, train, options);
    const forecasts = test.map(({ a, b, outcome }) => {
      const p = pairProbabilities(strengths[a] as number, strengths[b] as number, tie)[outcome];
      return { p: Math.max(p, FLOOR), hit: true };
    });
    return { model, logLoss: logLoss(forecasts) };
  });
  scores.sort((x, y) => x.logLoss - y.logLoss);
  return { model: (scores[0] as ModelScore).model, scores, trained: train.length, tested };
}

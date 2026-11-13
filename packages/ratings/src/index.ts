/**
 * The ratings of pairrank: one ladder for each scope, and the choice of a model by the log-loss on held-out picks. The
 * package also chooses the next pair of a duel. The math is in `@mark1russell7/rigor-statistics`. This package only
 * gives it the sites and the picks of each scope.
 *
 * @packageDocumentation
 */
export * from "./ladder.ts";
export * from "./pairs.ts";
export * from "./select.ts";

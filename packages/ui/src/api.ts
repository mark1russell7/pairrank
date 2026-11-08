/**
 * The procedures of the host, as typed functions. The interface uses them through one function `call`. In the app, a
 * `Client` on a `PortTransport` gives it. In a test, `callerOf` of the host module gives it.
 */
import type { Draft, Scope } from "@pairrank/core";
import type { ApplyResult, ImportPreview, ImportResult, StateView } from "@pairrank/host/views";
import type { Ladder, ModelChoice, ModelName, PairChoice } from "@pairrank/ratings";

/** A function that calls the procedure at a path with an input, and gives its value. */
export type Call = <T>(path: string[], input: unknown) => Promise<T>;

/** The procedures of the host that the interface uses. */
export interface PairrankApi {
  /** This function gives the view of the state: the sites, the tags and the count of picks. */
  view(): Promise<StateView>;
  /** This function writes drafts as events, in one transaction. */
  apply(drafts: readonly Draft[]): Promise<ApplyResult>;
  /** This function gives the report of an import, and changes nothing. */
  planImport(list: unknown): Promise<ImportPreview>;
  /** This function imports a site list. */
  importList(list: unknown): Promise<ImportResult>;
  /** This function gives the ladder of a scope. */
  ladder(scope: Scope, model?: ModelName): Promise<Ladder>;
  /** This function compares the models of a scope by the log-loss on its last picks. */
  model(scope: Scope): Promise<ModelChoice>;
  /** This function chooses the next pair of a duel in a scope, or gives `null` when the scope has fewer than two sites. */
  pair(scope: Scope, seed: number | string, recent?: readonly (readonly [string, string])[]): Promise<PairChoice | null>;
}

/** This function gives the procedures of the host over one function `call`. */
export function apiOf(call: Call): PairrankApi {
  return {
    view: () => call<StateView>(["pairrank", "view"], {}),
    apply: (drafts) => call<ApplyResult>(["pairrank", "apply"], { drafts }),
    planImport: (list) => call<ImportPreview>(["pairrank", "import", "plan"], { list }),
    importList: (list) => call<ImportResult>(["pairrank", "import", "apply"], { list }),
    ladder: (scope, model) => call<Ladder>(["pairrank", "ladder"], model === undefined ? { scope } : { scope, model }),
    model: (scope) => call<ModelChoice>(["pairrank", "model"], { scope }),
    pair: (scope, seed, recent = []) => call<PairChoice | null>(["pairrank", "pair"], { scope, seed, recent }),
  };
}

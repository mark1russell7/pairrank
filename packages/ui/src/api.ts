/**
 * The procedures of the host, as typed functions. The interface uses them through one function `call`. In the app, a
 * `Client` on a `PortTransport` gives it. In a test, `callerOf` of the host module gives it.
 */
import type { Draft, ModeId, Scope } from "@pairrank/core";
import type { BookmarkSource, ChromeBookmarks } from "@pairrank/input";
import type { ApplyResult, DuelPair, ImportPreview, ImportResult, StateView, ViewerAnswer, ViewerOrder } from "@pairrank/host/views";
import type { Ladder, ModelChoice, ModelSetting } from "@pairrank/ratings";
import type { Capture, CaptureResult } from "@pairrank/surfaces";

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
  /** This function gives the ladder of a scope with a model, or with the best model of its test. The default is Bradley-Terry. */
  ladder(scope: Scope, model?: ModelSetting): Promise<Ladder>;
  /** This function compares the models of a scope by the log-loss on its last picks. */
  model(scope: Scope): Promise<ModelChoice>;
  /**
   * This function chooses the next pair of a duel in a scope, or in the saved mode with the id. It gives `null` when
   * there is no pair.
   */
  pair(source: Scope | ModeId, seed: number | string, recent?: readonly (readonly [string, string])[]): Promise<DuelPair | null>;
  /**
   * This function gives the sites that agree with the text of a tag query, in an order, or the problem of the text. An
   * order by rating uses the model. The default is Bradley-Terry.
   */
  viewer(query: string, order: ViewerOrder, model?: ModelSetting): Promise<ViewerAnswer>;
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
    pair: (source, seed, recent = []) => call<DuelPair | null>(["pairrank", "pair"], { ...(typeof source === "string" ? { mode: source } : { scope: source }), seed, recent }),
    viewer: (query, order, model) => call<ViewerAnswer>(["pairrank", "viewer"], model === undefined ? { query, order } : { query, order, model }),
  };
}

/**
 * The procedures of the bookmarks files of the host. Only the desktop host has them. In another host, the interface
 * reads only a file that the user chooses.
 */
export interface BookmarksApi {
  /** This function finds the bookmarks files of the Chrome profiles of the computer. */
  sources(): Promise<BookmarkSource[]>;
  /** This function reads the folders and the sites of a file that `sources` found. */
  read(source: string): Promise<ChromeBookmarks>;
}

/** This function gives the procedures of the bookmarks files over one function `call`. */
export function bookmarksApiOf(call: Call): BookmarksApi {
  return {
    sources: () => call<BookmarkSource[]>(["bookmarks", "sources"], {}),
    read: (source) => call<ChromeBookmarks>(["bookmarks", "read"], { source }),
  };
}

/**
 * This function gives the capture of a site by the host, over one function `call`. A host has the procedure only when
 * it has a capture. A surface of still pictures uses the capture.
 */
export function captureApiOf(call: Call): Capture {
  return (url, size) => call<CaptureResult>(["pictures", "capture"], { url, size });
}

/**
 * The procedures of pairrank, over one open store. A host serves them in its process, for example the main process of
 * the desktop app, and the interface uses them through a port (`PortTransport` of `@procedures/client`).
 *
 * @packageDocumentation
 */
import { type Draft, type Scope, type TagId, parseDraft, parseQuery, queryText, stamp } from "@pairrank/core";
import { parseSiteList, planImport } from "@pairrank/input";
import { type Ladder, type ModelChoice, type ModelName, type PairChoice, choosePair, ladderOf, pairableOf, selectModel } from "@pairrank/ratings";
import type { Store } from "@pairrank/store";
import { viewerOf } from "./viewer.ts";
import { type ApplyResult, type ImportPreview, type ImportResult, type StateView, type ViewerAnswer, type ViewerOrder, viewOf } from "./views.ts";
import { type AnyProcedure, type ProcedureModule, createProcedure, defineModule, zodAdapter } from "@procedures/client";

/** The options of the module. */
export interface ModuleOptions {
  /** This function gives the key of a URL for the import. The app gives `canonicalUrl` of `polite-crawler`. */
  readonly key: (url: string) => string;
  /** This function gives a new id. The default is `crypto.randomUUID`. */
  readonly id?: () => string;
  /** This function gives the current ISO 8601 time. The default is the clock of the process. */
  readonly now?: () => string;
}

/** A schema that gives the value as it is. The output of a procedure of this module needs no check. */
const as = <T>() => zodAdapter<T>({ parse: (value: unknown) => value as T });

function objectOf(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("The input must be an object.");
  return value as Readonly<Record<string, unknown>>;
}

const DraftsInput = zodAdapter<{ drafts: Draft[] }>({
  parse: (value) => {
    const drafts = objectOf(value)["drafts"];
    if (!Array.isArray(drafts)) throw new Error("The input must have a list drafts.");
    return { drafts: drafts.map((draft, index) => {
      try {
        return parseDraft(draft);
      } catch (error) {
        throw new Error(`The draft at the position ${index} is not valid. ${(error as Error).message}`);
      }
    }) };
  },
});

const ListInput = zodAdapter<{ list: unknown }>({ parse: (value) => ({ list: objectOf(value)["list"] }) });

const MODELS = new Set<unknown>(["bradley-terry", "elo", "glicko2"]);

function scopeOf(value: unknown): Scope {
  const scope = objectOf(value);
  if (scope["kind"] === "overall") return { kind: "overall" };
  if (scope["kind"] === "tag" && typeof scope["tag"] === "string" && scope["tag"] !== "") return { kind: "tag", tag: scope["tag"] };
  throw new Error("The scope must be { kind: overall } or { kind: tag, tag }.");
}

const LadderInput = zodAdapter<{ scope: Scope; model?: ModelName }>({
  parse: (value) => {
    const input = objectOf(value);
    const model = input["model"];
    if (model !== undefined && !MODELS.has(model)) throw new Error("The model must be bradley-terry, elo or glicko2.");
    return { scope: scopeOf(input["scope"]), ...(model === undefined ? {} : { model: model as ModelName }) };
  },
});

/** The most recent pairs that one call of `pairrank.pair` takes. */
const MAX_RECENT = 200;

const PairInput = zodAdapter<{ scope: Scope; seed: number | string; recent: [string, string][]; model?: ModelName }>({
  parse: (value) => {
    const input = objectOf(value);
    const { scope, model } = LadderInput.parse({ scope: input["scope"], model: input["model"] });
    const seed = input["seed"];
    if (!(typeof seed === "string" && seed !== "") && !(typeof seed === "number" && Number.isFinite(seed))) throw new Error("The seed must be a text or a finite number.");
    const recent = input["recent"] ?? [];
    if (!Array.isArray(recent) || recent.length > MAX_RECENT) throw new Error(`The recent pairs must be a list of ${MAX_RECENT} pairs or fewer.`);
    const pairs = recent.map((pair): [string, string] => {
      if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== "string" || typeof pair[1] !== "string") throw new Error("Each recent pair must be a list of two site ids.");
      return [pair[0], pair[1]];
    });
    return { scope, seed, recent: pairs, ...(model === undefined ? {} : { model }) };
  },
});

/** The most scopes that one order of the viewer takes. */
const MAX_SCOPES = 100;

const ViewerInputSchema = zodAdapter<{ query: string; order: ViewerOrder; model?: ModelName }>({
  parse: (value) => {
    const input = objectOf(value);
    const query = input["query"] ?? "";
    if (typeof query !== "string") throw new Error("The query must be a text.");
    const model = input["model"];
    if (model !== undefined && !MODELS.has(model)) throw new Error("The model must be bradley-terry, elo or glicko2.");
    const order = objectOf(input["order"] ?? { kind: "title" });
    const kind = order["kind"];
    let parsed: ViewerOrder;
    if (kind === "title" || kind === "added") parsed = { kind };
    else if (kind === "rating") {
      const scopes = order["scopes"];
      if (!Array.isArray(scopes) || scopes.length === 0 || scopes.length > MAX_SCOPES) throw new Error(`An order by rating must have from 1 to ${MAX_SCOPES} scopes.`);
      parsed = { kind, scopes: scopes.map(scopeOf) };
    } else throw new Error("The order must be { kind: rating, scopes }, { kind: title } or { kind: added }.");
    return { query, order: parsed, ...(model === undefined ? {} : { model: model as ModelName }) };
  },
});

const reads = { reads: ["pairrank.log"], writes: [] as string[], idempotent: true, destructive: false };
const appends = { reads: ["pairrank.log"], writes: ["pairrank.log"], idempotent: false, destructive: false };

/**
 * This function gives the module of the procedures over a store:
 *
 * - `pairrank.view` gives the view of the state.
 * - `pairrank.apply` writes drafts as events, in one transaction.
 * - `pairrank.import.plan` gives the report of an import, and changes nothing.
 * - `pairrank.import.apply` imports a site list.
 * - `pairrank.ladder` gives the ladder of a scope.
 * - `pairrank.model` compares the models of a scope by the log-loss on its last picks.
 * - `pairrank.pair` chooses the next pair of a duel in a scope, with a seed.
 * - `pairrank.viewer` gives the sites that agree with a tag query, in an order.
 *
 * The log is append-only, so no procedure removes data: a delete or an undo is a new event.
 */
export function pairrankModule(store: Store, options: ModuleOptions): ProcedureModule {
  const id = options.id ?? (() => crypto.randomUUID());
  const now = options.now ?? (() => new Date().toISOString());

  const plan = (value: unknown) => {
    const parsed = parseSiteList(value);
    const at = now();
    return { parsed, plan: planImport(store.state, parsed.list, { key: options.key, id, at }) };
  };

  const procedures: AnyProcedure[] = [
    createProcedure()
      .path(["pairrank", "view"])
      .input(as<Record<string, never>>())
      .output(as<StateView>())
      .meta({ description: "Give the sites, the tags and the count of picks", effects: reads })
      .handler(async (): Promise<StateView> => viewOf(store.state, store.problems.length))
      .build(),
    createProcedure()
      .path(["pairrank", "apply"])
      .input(DraftsInput)
      .output(as<ApplyResult>())
      .meta({ description: "Write drafts as events in one transaction", effects: appends })
      .handler(async ({ drafts }): Promise<ApplyResult> => {
        const at = now();
        const events = drafts.map((draft) => stamp(draft, id(), at));
        return { events: events.map((event) => event.id), problems: store.appendAll(events) };
      })
      .build(),
    createProcedure()
      .path(["pairrank", "import", "plan"])
      .input(ListInput)
      .output(as<ImportPreview>())
      .meta({ description: "Give the report of the import of a site list, and change nothing", effects: reads })
      .handler(async ({ list }): Promise<ImportPreview> => {
        const { parsed, plan: result } = plan(list);
        return { report: result.report, entries: parsed.problems };
      })
      .build(),
    createProcedure()
      .path(["pairrank", "import", "apply"])
      .input(ListInput)
      .output(as<ImportResult>())
      .meta({ description: "Import a site list in one transaction", effects: appends })
      .handler(async ({ list }): Promise<ImportResult> => {
        const { parsed, plan: result } = plan(list);
        return { report: result.report, entries: parsed.problems, problems: store.appendAll(result.events) };
      })
      .build(),
    createProcedure()
      .path(["pairrank", "ladder"])
      .input(LadderInput)
      .output(as<Ladder>())
      .meta({ description: "Give the ladder of a scope", effects: reads })
      .handler(async ({ scope, model }): Promise<Ladder> => ladderOf(store.state, scope, model === undefined ? {} : { model }))
      .build(),
    createProcedure()
      .path(["pairrank", "model"])
      .input(LadderInput)
      .output(as<ModelChoice>())
      .meta({ description: "Compare the models of a scope by the log-loss on its last picks", effects: reads })
      .handler(async ({ scope }): Promise<ModelChoice> => selectModel(store.state, scope))
      .build(),
    createProcedure()
      .path(["pairrank", "pair"])
      .input(PairInput)
      .output(as<PairChoice | null>())
      .meta({ description: "Choose the next pair of a duel in a scope, with a seed", effects: reads })
      .handler(async ({ scope, seed, recent, model }): Promise<PairChoice | null> => {
        const ladder = ladderOf(store.state, scope, model === undefined ? {} : { model });
        return choosePair(ladder, pairableOf(store.state, scope), { seed, recent }) ?? null;
      })
      .build(),
    createProcedure()
      .path(["pairrank", "viewer"])
      .input(ViewerInputSchema)
      .output(as<ViewerAnswer>())
      .meta({ description: "Give the sites that agree with a tag query, in the order of a rating, a title or a date", effects: reads })
      .handler(async ({ query, order, model }): Promise<ViewerAnswer> => {
        const names = new Map<string, TagId>([...store.state.tags.values()].map((tag) => [tag.name.toLowerCase(), tag.id]));
        const parsed = parseQuery(query, (name) => names.get(name.toLowerCase()));
        if (!parsed.ok) return parsed;
        const result = viewerOf(store.state, { query: parsed.query, order }, model === undefined ? {} : { model });
        const text = queryText(parsed.query, (tag) => store.state.tags.get(tag)?.name ?? tag);
        return { ok: true, query: text, ...result };
      })
      .build(),
  ];
  return defineModule("@pairrank/host", procedures);
}

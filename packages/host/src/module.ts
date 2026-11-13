/**
 * The procedures of pairrank, over one open store. A host serves them in its process, for example the main process of
 * the desktop app, and the interface uses them through a port (`PortTransport` of `@procedures/client`).
 *
 * @packageDocumentation
 */
import { type Draft, type ModeId, type Scope, type TagId, parseDraft, parseQuery, queryText, stamp } from "@pairrank/core";
import { parseSiteList, planImport } from "@pairrank/input";
import { type Ladder, type ModelChoice, type ModelSetting, choosePair, pairableOf } from "@pairrank/ratings";
import type { Store } from "@pairrank/store";
import { ladderCache } from "./ladders.ts";
import { modePair } from "./modes.ts";
import { MAX_TEMPERATURE, viewerOf } from "./viewer.ts";
import { type ApplyResult, type DuelPair, type ImportPreview, type ImportResult, type StateView, type ViewerAnswer, type ViewerMix, type ViewerOrder, viewOf } from "./views.ts";
import { type AnyProcedure, type ProcedureModule, createProcedure, defineModule, typed } from "@procedures/client";
import { z } from "zod";

/** The options of the module. */
export interface ModuleOptions {
  /** This function gives the key of a URL for the import. The app gives `canonicalUrl` of `polite-crawler`. */
  readonly key: (url: string) => string;
  /** This function gives a new id. The default is `crypto.randomUUID`. */
  readonly id?: () => string;
  /** This function gives the current ISO 8601 time. The default is the clock of the process. */
  readonly now?: () => string;
}

const MODEL_ERROR = "The model must be best, bradley-terry, elo or glicko2.";

/** The model setting: the name of a rating model, or `best` for the model that the test of the scope chooses. */
const ModelSchema: z.ZodType<ModelSetting> = z.enum(["best", "bradley-terry", "elo", "glicko2"], { error: MODEL_ERROR });

const SCOPE_ERROR = "The scope must be { kind: overall } or { kind: tag, tag }, with the id of a tag.";

/** The scope of a ladder: the overall ladder, or the ladder of one tag. A scope has no other field. */
const ScopeSchema: z.ZodType<Scope> = z.union(
  [z.strictObject({ kind: z.literal("overall") }), z.strictObject({ kind: z.literal("tag"), tag: z.string({ error: SCOPE_ERROR }).min(1, { error: SCOPE_ERROR }) })],
  { error: SCOPE_ERROR },
);

/** A draft from a caller. `parseDraft` of `@pairrank/core` owns the format of a draft, so the schema uses it. */
const DraftSchema = z.unknown().transform((value, context): Draft => {
  try {
    return parseDraft(value);
  } catch (error) {
    context.addIssue({ code: "custom", message: `The draft is not valid. ${(error as Error).message}` });
    return z.NEVER;
  }
});

const DraftsInput = z.strictObject({ drafts: z.array(DraftSchema, { error: "The input must have a list drafts." }) });

/** A site list. `parseSiteList` of `@pairrank/input` reads it, and gives a problem for each entry that is not valid. */
const ListInput = z.strictObject({ list: z.looseObject({}, { error: "The list must be an object." }) });

const LadderInput = z.strictObject({ scope: ScopeSchema, model: ModelSchema.exactOptional() });

/** The most recent pairs that one call of `pairrank.pair` takes. */
const MAX_RECENT = 200;

/** The input of `pairrank.pair`: a scope, or the id of a saved mode. */
type PairInputValue = ({ scope: Scope; mode?: undefined } | { mode: ModeId; scope?: undefined }) & { seed: number | string; recent: [string, string][]; model?: ModelSetting };

const PairInput = z
  .strictObject({
    scope: ScopeSchema.exactOptional(),
    mode: z.string({ error: "The mode must be the id of a saved mode." }).min(1, { error: "The mode must be the id of a saved mode." }).exactOptional(),
    seed: z.union([z.string().min(1), z.number()], { error: "The seed must be a text or a finite number." }),
    recent: z
      .array(z.tuple([z.string(), z.string()], { error: "Each recent pair must be a list of two site ids." }), { error: `The recent pairs must be a list of ${MAX_RECENT} pairs or fewer.` })
      .max(MAX_RECENT, { error: `The recent pairs must be a list of ${MAX_RECENT} pairs or fewer.` })
      .default([]),
    model: ModelSchema.exactOptional(),
  })
  .transform(({ scope, mode, ...rest }, context): PairInputValue => {
    if (mode !== undefined && scope === undefined) return { mode, ...rest };
    if (scope !== undefined && mode === undefined) return { scope, ...rest };
    context.addIssue({ code: "custom", message: "The input must have a scope or a mode, and not the two." });
    return z.NEVER;
  });

/** The most scopes that one order of the viewer takes. */
const MAX_SCOPES = 100;

const TEMPERATURE_ERROR = `The temperature of a mix must be a number from 0 to ${MAX_TEMPERATURE}.`;

/** The mix of an order by rating. */
const MixSchema: z.ZodType<ViewerMix> = z.strictObject({
  temperature: z.number({ error: TEMPERATURE_ERROR }).min(0, { error: TEMPERATURE_ERROR }).max(MAX_TEMPERATURE, { error: TEMPERATURE_ERROR }),
  seed: z.int({ error: "The seed of a mix must be an integer." }),
});

const SCOPES_ERROR = `An order by rating must have from 1 to ${MAX_SCOPES} scopes.`;

/** The order of the viewer. */
const OrderSchema: z.ZodType<ViewerOrder> = z.discriminatedUnion(
  "kind",
  [
    z.strictObject({
      kind: z.literal("rating"),
      scopes: z.array(ScopeSchema, { error: SCOPES_ERROR }).min(1, { error: SCOPES_ERROR }).max(MAX_SCOPES, { error: SCOPES_ERROR }),
      mix: MixSchema.exactOptional(),
    }),
    z.strictObject({ kind: z.literal("title") }),
    z.strictObject({ kind: z.literal("added") }),
  ],
  { error: "The order must be { kind: rating, scopes }, { kind: title } or { kind: added }." },
);

const ViewerInput = z.strictObject({
  query: z.string({ error: "The query must be a text." }).default(""),
  order: OrderSchema.default({ kind: "title" }),
  model: ModelSchema.exactOptional(),
});

/** The input of a procedure with no input: an empty object. */
const NoInput = z.strictObject({});

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
 * - `pairrank.pair` chooses the next pair of a duel in a scope or in a saved mode, with a seed.
 * - `pairrank.viewer` gives the sites that agree with a tag query, in an order.
 *
 * The log is append-only, so no procedure removes data: a delete or an undo is a new event.
 *
 * The page and a local HTTP client give the inputs, so a zod schema examines each input before its handler. The host
 * makes each output, so `typed` of `@procedures/client` gives its type and examines nothing.
 */
export function pairrankModule(store: Store, options: ModuleOptions): ProcedureModule {
  const id = options.id ?? (() => crypto.randomUUID());
  const now = options.now ?? (() => new Date().toISOString());
  // Each ladder and each model test stays in the cache until the store accepts a new event
  const ladders = ladderCache();

  const plan = (value: unknown) => {
    const parsed = parseSiteList(value);
    const at = now();
    return { parsed, plan: planImport(store.state, parsed.list, { key: options.key, id, at }) };
  };

  const procedures: AnyProcedure[] = [
    createProcedure()
      .path(["pairrank", "view"])
      .input(NoInput)
      .output(typed<StateView>())
      .meta({ description: "Give the sites, the tags and the count of picks", effects: reads })
      .handler(async (): Promise<StateView> => viewOf(store.state, store.problems.length))
      .build(),
    createProcedure()
      .path(["pairrank", "apply"])
      .input(DraftsInput)
      .output(typed<ApplyResult>())
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
      .output(typed<ImportPreview>())
      .meta({ description: "Give the report of the import of a site list, and change nothing", effects: reads })
      .handler(async ({ list }): Promise<ImportPreview> => {
        const { parsed, plan: result } = plan(list);
        return { report: result.report, entries: parsed.problems };
      })
      .build(),
    createProcedure()
      .path(["pairrank", "import", "apply"])
      .input(ListInput)
      .output(typed<ImportResult>())
      .meta({ description: "Import a site list in one transaction", effects: appends })
      .handler(async ({ list }): Promise<ImportResult> => {
        const { parsed, plan: result } = plan(list);
        return { report: result.report, entries: parsed.problems, problems: store.appendAll(result.events) };
      })
      .build(),
    createProcedure()
      .path(["pairrank", "ladder"])
      .input(LadderInput)
      .output(typed<Ladder>())
      .meta({ description: "Give the ladder of a scope", effects: reads })
      .handler(async ({ scope, model }): Promise<Ladder> => ladders.ladder(store.state, scope, model === undefined ? {} : { model }))
      .build(),
    createProcedure()
      .path(["pairrank", "model"])
      .input(LadderInput)
      .output(typed<ModelChoice>())
      .meta({ description: "Compare the models of a scope by the log-loss on its last picks", effects: reads })
      .handler(async ({ scope }): Promise<ModelChoice> => ladders.model(store.state, scope))
      .build(),
    createProcedure()
      .path(["pairrank", "pair"])
      .input(PairInput)
      .output(typed<DuelPair | null>())
      .meta({ description: "Choose the next pair of a duel in a scope or in a saved mode, with a seed", effects: reads })
      .handler(async ({ scope, mode, seed, recent, model }): Promise<DuelPair | null> => {
        const options = model === undefined ? {} : { model };
        if (mode !== undefined) {
          const saved = store.state.modes.get(mode);
          if (saved === undefined) throw new Error(`No mode has the id "${mode}".`);
          return modePair(store.state, saved, { seed, recent }, options, ladders.ladder) ?? null;
        }
        const choice = choosePair(ladders.ladder(store.state, scope, options), pairableOf(store.state, scope), { seed, recent });
        return choice === undefined ? null : { ...choice, asks: [scope] };
      })
      .build(),
    createProcedure()
      .path(["pairrank", "viewer"])
      .input(ViewerInput)
      .output(typed<ViewerAnswer>())
      .meta({ description: "Give the sites that agree with a tag query, in the order of a rating, a title or a date", effects: reads })
      .handler(async ({ query, order, model }): Promise<ViewerAnswer> => {
        const names = new Map<string, TagId>([...store.state.tags.values()].map((tag) => [tag.name.toLowerCase(), tag.id]));
        const parsed = parseQuery(query, (name) => names.get(name.toLowerCase()));
        if (!parsed.ok) return parsed;
        const result = viewerOf(store.state, { query: parsed.query, order }, model === undefined ? {} : { model }, ladders.ladder);
        const text = queryText(parsed.query, (tag) => store.state.tags.get(tag)?.name ?? tag);
        return { ok: true, query: text, ...result };
      })
      .build(),
  ];
  return defineModule("@pairrank/host", procedures);
}

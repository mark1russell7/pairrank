/**
 * The duel screen: two sites side by side, under one scope. A pick writes one event, and then the host chooses the next
 * pair (`pairrank.pair`). An undo removes the last pick or the last hide of the duel.
 */
import type { Draft, Scope } from "@pairrank/core";
import type { SiteView, StateView, TagView } from "@pairrank/host/views";
import type { SlotTracker, Surface } from "@pairrank/surfaces";
import { type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PairrankApi } from "./api.ts";
import { type DuelAction, type DuelStep, type Pair, actionOf, outcomeOf, pickDraft, recentOf, seedOf, undoDraft } from "./duel.ts";
import { Slot } from "./slot.tsx";
import { Swatch } from "./tags.tsx";

/** The properties of the duel screen. */
export interface DuelProps {
  readonly api: PairrankApi;
  readonly view: StateView;
  readonly surface: Surface;
  readonly tracker: SlotTracker;
  /** This function reads the view again after a change. */
  readonly reload: () => Promise<void>;
  /** This function gives the id of a new duel. */
  readonly newId: () => string;
  /** This function goes back to the list of the sites. */
  readonly leave: () => void;
}

const scopeValue = (scope: Scope): string => (scope.kind === "overall" ? "overall" : `tag:${scope.tag}`);
const scopeOf = (value: string): Scope => (value === "overall" ? { kind: "overall" } : { kind: "tag", tag: value.slice("tag:".length) });

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function Side(props: { readonly site: SiteView | undefined; readonly tags: ReadonlyMap<string, TagView>; readonly hide: () => void; readonly label: string }): ReactElement {
  const { site } = props;
  return (
    <footer className="strip caption duel-caption">
      <span className="site-name">{site === undefined ? "" : site.title?.trim() || site.url.replace(/^https?:\/\//i, "")}</span>
      <span className="site-tags">
        {site?.tags.map((id) => (
          <span className="tag" key={id}>
            <Swatch color={props.tags.get(id)?.color} />
            {props.tags.get(id)?.name ?? id}
          </span>
        ))}
      </span>
      <button type="button" className="quiet-danger" disabled={site === undefined} onClick={props.hide}>
        Hide the {props.label} site
      </button>
    </footer>
  );
}

/** The duel screen. */
export function DuelScreen({ api, view, surface, tracker, reload, newId, leave }: DuelProps): ReactElement {
  const [scope, setScope] = useState<Scope>({ kind: "overall" });
  const [duel, setDuel] = useState(newId);
  const [round, setRound] = useState(0);
  // The pair of a round, with the key of its round. The old pair stays on the screen while the next pair loads, and
  // the actions wait. The state of the load comes from the key, so no render shows the old pair as ready
  const [loaded, setLoaded] = useState<{ readonly key: string; readonly pair: Pair | null | undefined }>({ key: "", pair: undefined });
  const roundKey = `${scopeValue(scope)} ${seedOf(duel, round)}`;
  const pair = loaded.pair;
  const loading = loaded.key !== roundKey;
  const [steps, setSteps] = useState<readonly DuelStep[]>([]);
  const [hiding, setHiding] = useState(false);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const busy = useRef(false);
  // A write is under way: the actions wait, so a key does not pick the old pair again
  const [pending, setPending] = useState(false);
  const sites = useMemo(() => new Map(view.sites.map((site) => [site.id, site])), [view.sites]);
  const tags = useMemo(() => new Map(view.tags.map((tag) => [tag.id, tag])), [view.tags]);
  const named = useMemo(() => [...view.tags].sort((a, b) => a.name.localeCompare(b.name)), [view.tags]);

  // The choice of the next pair. The pairs of this duel wait, so the same pair does not come again at once
  const stepsRef = useRef(steps);
  stepsRef.current = steps;
  const lastPair = useRef<Pair | undefined>(undefined);
  useEffect(() => {
    let live = true;
    api.pair(scope, seedOf(duel, round), recentOf(stepsRef.current, lastPair.current)).then(
      (choice) => {
        if (!live) return;
        const next = choice === null ? null : { a: choice.a, b: choice.b };
        lastPair.current = next ?? undefined;
        setLoaded({ key: roundKey, pair: next });
      },
      (failure: unknown) => {
        if (!live) return;
        setProblem(messageOf(failure));
        setLoaded({ key: roundKey, pair: undefined });
      },
    );
    return () => {
      live = false;
    };
  }, [api, scope, duel, round, roundKey]);

  const run = useCallback(
    async (drafts: readonly Draft[], step: (events: readonly string[]) => DuelStep | undefined, undo = false): Promise<boolean> => {
      if (busy.current) return false;
      busy.current = true;
      setPending(true);
      try {
        const result = await api.apply(drafts);
        const refused = result.problems[0];
        if (refused !== undefined) {
          setProblem(refused.message);
          return false;
        }
        setProblem(undefined);
        const done = step(result.events);
        setSteps((current) => (undo ? current.slice(0, -1) : done === undefined ? current : [...current, done]));
        await reload();
        if (!undo) setRound((current) => current + 1);
        return true;
      } catch (failure) {
        setProblem(messageOf(failure));
        return false;
      } finally {
        busy.current = false;
        setPending(false);
      }
    },
    [api, reload],
  );

  const act = useCallback(
    (action: DuelAction): void => {
      if (action === "undo") {
        const last = steps.at(-1);
        if (last === undefined || loading) return;
        void run([undoDraft(last)], () => undefined, true).then((done) => {
          if (!done) return;
          lastPair.current = last.pair;
          setLoaded({ key: roundKey, pair: last.pair });
        });
        return;
      }
      if (pair === null || pair === undefined || loading) return;
      if (action === "hide") {
        setHiding(true);
        return;
      }
      const outcome = outcomeOf(action);
      void run([pickDraft(pair, scope, outcome, duel)], (events) => ({ kind: "pick", pair, outcome, event: events[0]! }));
    },
    [steps, pair, scope, duel, run, loading, roundKey],
  );

  const hide = useCallback(
    (site: string): void => {
      setHiding(false);
      if (pair === null || pair === undefined || loading) return;
      void run([{ type: "site.hidden", site, reason: "Hidden in a duel." }], () => ({ kind: "hide", pair, site }));
    },
    [pair, run, loading],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const action = actionOf(event.key);
      if (hiding) {
        if (action === "left" && pair) hide(pair.a);
        else if (action === "right" && pair) hide(pair.b);
        else if (event.key === "Escape") setHiding(false);
        else return;
      } else if (action !== undefined) act(action);
      else if (event.key === "Escape") leave();
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [act, hide, hiding, pair, leave]);

  const choose = (value: string): void => {
    setScope(scopeOf(value));
    setDuel(newId());
    setRound(0);
    setSteps([]);
    setHiding(false);
    setProblem(undefined);
    lastPair.current = undefined;
  };

  const ready = Boolean(pair) && !loading && !pending;
  const left = pair ? sites.get(pair.a) : undefined;
  const right = pair ? sites.get(pair.b) : undefined;
  const picks = steps.filter((step) => step.kind === "pick" && step.outcome !== "skip").length;

  return (
    <main className="duel" data-hiding={hiding} aria-busy={loading || pending}>
      <div className="strip duel-bar">
        <label className="scope">
          <span>Pick under</span>
          <select value={scopeValue(scope)} onChange={(event) => choose(event.target.value)}>
            <option value="overall">Overall</option>
            {named.map((tag) => (
              <option key={tag.id} value={`tag:${tag.id}`}>
                {tag.name}
              </option>
            ))}
          </select>
        </label>
        <span className="count">Picks in this duel: {picks}</span>
        <button type="button" disabled={steps.length === 0 || pending} onClick={() => act("undo")}>
          Undo <kbd>u</kbd>
        </button>
      </div>

      {pair === null ? (
        <section className="duel-none">
          <h1>Not enough sites for a duel</h1>
          <p>A duel needs two sites that are not hidden{scope.kind === "tag" ? " and have this tag" : ""}. Put the tag on more sites on the Look screen, or pick under a different tag.</p>
        </section>
      ) : (
        <div className="duel-sides">
          <div className="side">
            <Slot surface={surface} tracker={tracker} slot="left" url={left?.url} />
            <Side site={left} tags={tags} label="left" hide={() => hide(pair!.a)} />
          </div>
          <div className="side">
            <Slot surface={surface} tracker={tracker} slot="right" url={right?.url} />
            <Side site={right} tags={tags} label="right" hide={() => hide(pair!.b)} />
          </div>
        </div>
      )}

      <div className="strip duel-actions" role="group" aria-label="Pick">
        {hiding ? (
          <p className="hide-ask" role="status">
            Which site do you hide? Press <kbd>←</kbd> or <kbd>→</kbd>, or <kbd>Esc</kbd> to keep the two sites.
          </p>
        ) : (
          <>
            <button type="button" className="pick" disabled={!ready} onClick={() => act("left")}>
              <kbd>←</kbd> Left is better
            </button>
            <button type="button" disabled={!ready} onClick={() => act("tie")}>
              Tie <kbd>t</kbd>
            </button>
            <button type="button" disabled={!ready} onClick={() => act("skip")}>
              Skip <kbd>s</kbd>
            </button>
            <button type="button" disabled={!ready} onClick={() => act("hide")}>
              Hide a site <kbd>h</kbd>
            </button>
            <button type="button" className="pick" disabled={!ready} onClick={() => act("right")}>
              Right is better <kbd>→</kbd>
            </button>
          </>
        )}
        {problem !== undefined && (
          <span className="problem" role="alert">
            {problem}
          </span>
        )}
      </div>
    </main>
  );
}

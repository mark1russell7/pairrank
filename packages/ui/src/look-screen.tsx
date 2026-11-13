/**
 * The Look screen: the tag run. It shows the sites of a scope one at a time. The key of a tag puts the tag on the site
 * or removes it. The list of the run is fixed at its start, so a site stays in the run after a tag.
 */
import type { SiteView, StateView, TagView } from "@pairrank/host/views";
import type { Surface, SlotTracker } from "@pairrank/surfaces";
import { type FormEvent, type ReactElement, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { countOf } from "./importing.ts";
import {
  type RunScope,
  type RunStep,
  firstScope,
  isDone,
  runActionOf,
  runOf,
  runStepDraft,
  runUndoDraft,
  scopeName,
  scopeOf,
  scopeValue,
  tagOn,
  tagStep,
} from "./run.ts";
import type { PageList } from "./page-list.ts";
import { Slot } from "./slot.tsx";
import { createDraft, tagProblem } from "./tagging.ts";
import { Swatch, type Write } from "./tags.tsx";

/** The properties of the Look screen. */
export interface LookProps {
  readonly view: StateView;
  readonly surface: Surface;
  readonly tracker: SlotTracker;
  readonly write: Write;
  readonly newId: () => string;
  /** The site at the start. With a site, the run has each site. With none, the run starts with `firstScope`. */
  readonly start: string | undefined;
  /** The sites of the viewer, in its order, and a name for them. With a list, the run has the list. */
  readonly list?: { readonly ids: readonly string[]; readonly name: string } | undefined;
  readonly leave: () => void;
  /** The list of the sites, for the button "Add this page" of the slot. */
  readonly pages?: PageList | undefined;
}

/** This function gives the name of a site: its title, or its address with no scheme. */
export function nameOf(site: { readonly title?: string | undefined; readonly url: string }): string {
  return site.title !== undefined && site.title.trim() !== "" ? site.title : site.url.replace(/^https?:\/\//i, "");
}

const editable = (target: EventTarget | null): boolean => target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement;

/** The strip of the tags of the site, with a field that makes a tag and puts it on the site. */
function TagStrip(props: {
  readonly tags: readonly TagView[];
  readonly has: (tag: string) => boolean;
  readonly toggle: (tag: string) => Promise<string | undefined>;
  readonly create: (name: string) => Promise<string | undefined>;
}): ReactElement {
  const [name, setName] = useState("");
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const make = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (name.trim() === "") return;
    const found = await props.create(name);
    setProblem(found);
    if (found === undefined) setName("");
  };
  return (
    <div className="strip tag-strip" role="group" aria-label="Tags of the site">
      {props.tags.map((tag) => (
        <button type="button" key={tag.id} className="tag-toggle" aria-pressed={props.has(tag.id)} onClick={() => void props.toggle(tag.id).then(setProblem)}>
          <Swatch color={tag.color} />
          {tag.name}
          {tag.key !== undefined && <kbd>{tag.key}</kbd>}
        </button>
      ))}
      <form className="quick-tag" onSubmit={(event) => void make(event)}>
        <input
          value={name}
          placeholder="New tag"
          aria-label="New tag for this site"
          maxLength={80}
          onChange={(event) => {
            setName(event.target.value);
            setProblem(undefined);
          }}
        />
      </form>
      {problem !== undefined && (
        <span className="problem" role="alert">
          {problem}
        </span>
      )}
    </div>
  );
}

interface Run {
  readonly scope: RunScope;
  /** The ids of the sites of the run, fixed at its start. */
  readonly ids: readonly string[];
  /** The id of the site on the screen, or `null` after the last site. */
  readonly at: string | null;
}

function startRun(view: StateView, scope: RunScope, at?: string): Run {
  const ids = runOf(view, scope);
  return { scope, ids, at: at !== undefined && ids.includes(at) ? at : (ids[0] ?? null) };
}

/** The Look screen. */
export function LookScreen({ view, surface, tracker, write, newId, start, list, leave, pages }: LookProps): ReactElement {
  const listScope = useMemo((): RunScope | undefined => (list === undefined ? undefined : { kind: "list", ids: list.ids, name: list.name }), [list]);
  const [run, setRun] = useState<Run>(() => {
    if (listScope !== undefined) return startRun(view, listScope, start);
    return start === undefined ? startRun(view, firstScope(view)) : startRun(view, { kind: "all" }, start);
  });
  const [steps, setSteps] = useState<readonly RunStep[]>([]);
  const [onward, setOnward] = useState(false);
  const [problem, setProblem] = useState<string | undefined>(undefined);

  const byId = useMemo(() => new Map(view.sites.map((site) => [site.id, site])), [view]);
  const named = useMemo(() => [...view.tags].sort((a, b) => a.name.localeCompare(b.name)), [view]);
  // A site that the run hides leaves the run. A site that gets a tag stays.
  const live = useMemo(() => run.ids.flatMap((id) => (byId.get(id)?.hidden === false ? [id] : [])), [run.ids, byId]);
  const current = run.at !== null && live.includes(run.at) ? byId.get(run.at) : undefined;
  const position = run.at === null ? live.length : live.indexOf(run.at);
  const done = live.filter((id) => {
    const site = byId.get(id);
    return site !== undefined && isDone(site, run.scope);
  }).length;

  const go = useCallback(
    (by: 1 | -1, from = run.at) =>
      setRun((now) => {
        const at = from === null ? live.length : live.indexOf(from);
        const next = Math.max(0, Math.min(live.length, at + by));
        return { ...now, at: live[next] ?? null };
      }),
    [run.at, live],
  );

  // The state of a tag on a site while its write is in flight. A second press of a tag key before the view changes
  // reads this state, so it removes the tag that the first press added.
  const expected = useRef(new Map<string, boolean>());
  const hold = (site: string, tag: string, has: boolean): (() => void) => {
    const key = tagOn(site, tag);
    expected.current.set(key, has);
    // After a failure the view tells the state again. A newer press keeps its own value.
    return () => {
      if (expected.current.get(key) === has) expected.current.delete(key);
    };
  };
  useLayoutEffect(() => {
    for (const [key, has] of expected.current) {
      const [site, tag] = key.split("\u0000") as [string, string];
      if (byId.get(site)?.tags.includes(tag) === has) expected.current.delete(key);
    }
  }, [byId]);
  const tagStepOf = (site: SiteView, tag: string): RunStep => tagStep(site, tag, expected.current.get(tagOn(site.id, tag)));

  const act = useCallback(
    async (step: RunStep): Promise<string | undefined> => {
      // The step goes on the list before the write, so a quick undo finds it
      setSteps((now) => [...now, step]);
      const forget = step.kind === "tag" ? hold(step.site, step.tag, step.added) : undefined;
      // A hide moves the run on before the write, because the hidden site leaves the list
      if (step.kind === "hide") setRun((now) => ({ ...now, at: live[live.indexOf(step.site) + 1] ?? null }));
      const found = await write([runStepDraft(step)]);
      if (found === undefined) {
        if (onward && step.kind === "tag" && step.added) go(1, step.site);
      } else {
        forget?.();
        setSteps((now) => now.filter((each) => each !== step));
        if (step.kind === "hide") setRun((now) => ({ ...now, at: step.site }));
      }
      setProblem(found);
      return found;
    },
    [write, live, onward, go],
  );

  const undo = useCallback(async (): Promise<void> => {
    const last = steps.at(-1);
    if (last === undefined) return;
    // The step leaves the list before the write, so a second quick undo takes the step before it
    setSteps((now) => now.slice(0, -1));
    const forget = last.kind === "tag" ? hold(last.site, last.tag, !last.added) : undefined;
    const found = await write([runUndoDraft(last)]);
    setProblem(found);
    if (found !== undefined) {
      forget?.();
      setSteps((now) => [...now, last]);
      return;
    }
    setRun((now) => ({ ...now, at: last.site }));
  }, [steps, write]);

  const create = async (name: string): Promise<string | undefined> => {
    if (current === undefined) return undefined;
    const fields = { name, key: "", color: undefined };
    const id = newId();
    const found = tagProblem(fields, view.tags) ?? (await write([createDraft(id, fields)]));
    return found ?? act({ kind: "tag", site: current.id, tag: id, added: true });
  };

  // The key handler reads the values of the last render. A layout effect sets them in the commit, so a key press just
  // after a change of the view does not see the values of the render before it.
  const latest = useRef({ named, current, act, go, undo, leave, tagStepOf });
  useLayoutEffect(() => {
    latest.current = { named, current, act, go, undo, leave, tagStepOf };
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const { named, current, act, go, undo, leave, tagStepOf } = latest.current;
      if (editable(event.target) || event.ctrlKey || event.metaKey || event.altKey) return;
      // Enter and the space bar also press a button, so a button keeps them
      if ((event.key === "Enter" || event.key === " ") && event.target instanceof HTMLButtonElement) return;
      const keyed = named.find((tag) => tag.key !== undefined && tag.key === event.key.toLowerCase());
      const action = runActionOf(event.key);
      if (keyed !== undefined) {
        if (current !== undefined) void act(tagStepOf(current, keyed.id));
      } else if (action === "next") go(1);
      else if (action === "previous") go(-1);
      else if (action === "hide") {
        if (current !== undefined) void act({ kind: "hide", site: current.id });
      } else if (action === "undo") void undo();
      else if (action === "leave") leave();
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const choices: RunScope[] = [
    ...(listScope === undefined ? [] : [listScope]),
    { kind: "untagged" },
    { kind: "all" },
    ...named.map((tag): RunScope => ({ kind: "without", tag: tag.id })),
  ];
  const counted = run.scope.kind !== "all";

  return (
    <main className="look">
      <div className="strip run-bar">
        <select
          value={scopeValue(run.scope)}
          aria-label="Sites of the run"
          onChange={(event) => {
            const value = event.target.value;
            setRun(startRun(view, value === "list" && listScope !== undefined ? listScope : scopeOf(value)));
            setSteps([]);
            event.target.blur();
          }}
        >
          {choices.map((scope) => (
            <option key={scopeValue(scope)} value={scopeValue(scope)}>
              {scopeName(scope, view.tags)} ({runOf(view, scope).length})
            </option>
          ))}
        </select>
        {counted && live.length > 0 && (
          <span className="run-done">
            <span className="run-meter" aria-hidden="true">
              <span style={{ width: `${(100 * done) / live.length}%` }} />
            </span>
            {done} of {countOf(live.length, "site")} done
          </span>
        )}
        <span className="grow" />
        <label className="onward">
          <input type="checkbox" checked={onward} onChange={(event) => setOnward(event.target.checked)} />
          Next site after a tag
        </label>
        <button type="button" disabled={steps.length === 0} onClick={() => void undo()}>
          Undo <kbd>u</kbd>
        </button>
      </div>

      {current !== undefined ? (
        <>
          <Slot surface={surface} tracker={tracker} slot="main" url={current.url} pages={pages} />
          <TagStrip
            tags={named}
            has={(tag) => current.tags.includes(tag)}
            toggle={(tag) => act(tagStepOf(current, tag))}
            create={create}
          />
          <footer className="strip caption">
            <button type="button" aria-label="Previous site" disabled={position <= 0} onClick={() => go(-1)}>
              ‹
            </button>
            <span className="site-name">{nameOf(current)}</span>
            <span className="site-url">{current.url}</span>
            {problem !== undefined && (
              <span className="problem" role="alert">
                {problem}
              </span>
            )}
            <button type="button" className="quiet-danger" onClick={() => void act({ kind: "hide", site: current.id })}>
              Hide <kbd>h</kbd>
            </button>
            <span className="count">
              {position + 1} of {live.length}
            </span>
            <button type="button" aria-label="Next site" onClick={() => go(1)}>
              ›
            </button>
          </footer>
        </>
      ) : (
        <section className="run-end" aria-label="The end of the run">
          <h1>{live.length === 0 ? "No sites in this run" : "The end of the run"}</h1>
          <p>
            {live.length === 0
              ? `${scopeName(run.scope, view.tags)}: there are none. Choose other sites at the top.`
              : counted
                ? `Done: ${done} of ${countOf(live.length, "site")}.`
                : `You saw the ${countOf(live.length, "site")} of this run.`}
          </p>
          <div className="run-actions">
            {live.length > 0 && (
              <button type="button" onClick={() => go(-1)}>
                Back to the last site
              </button>
            )}
            <button
              type="button"
              className="primary"
              onClick={() => {
                setRun(startRun(view, run.scope));
                setSteps([]);
              }}
            >
              Start the run again
            </button>
            <button type="button" onClick={leave}>
              Back to the sites
            </button>
          </div>
        </section>
      )}
    </main>
  );
}

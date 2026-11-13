/**
 * The mode editor of the duel screen. A mode has a name, a pool of sites (a tag query) and the picks that each pair
 * asks. The editor takes the place of the two sites, because the views of the sites cover each panel above them.
 */
import { errorMessage } from "@mark1russell7/text";
import type { Ask, ModeId } from "@pairrank/core";
import type { ModeView, StateView, TagView } from "@pairrank/host/views";
import { type ReactElement, useEffect, useId, useMemo, useState } from "react";
import type { PairrankApi } from "./api.ts";
import { type ModeForm, NEW_MODE, asksText, checkForm, formOf, sameAsk, toggleAsk } from "./mode.ts";
import { Swatch } from "./tags.tsx";

/** The properties of the mode editor. */
export interface ModeEditorProps {
  readonly api: PairrankApi;
  readonly view: StateView;
  /** The mode to change, or `undefined` for a new mode. */
  readonly mode: ModeView | undefined;
  /** This function gives the id of a new mode. */
  readonly newId: () => string;
  /** This function closes the editor. It gets the id of the saved mode, `null` after a delete, or `undefined` after a cancel. */
  readonly close: (saved: ModeId | null | undefined) => void;
  /** This function reads the view again after a change. */
  readonly reload: () => Promise<void>;
}

/** The time that the editor waits after a change of the pool before it counts the sites, in milliseconds. */
const SETTLE_MS = 120;

/** The mode editor. */
export function ModeEditor({ api, view, mode, newId, close, reload }: ModeEditorProps): ReactElement {
  const tags = useMemo(() => new Map<string, TagView>(view.tags.map((tag) => [tag.id, tag])), [view]);
  const named = useMemo(() => [...view.tags].sort((a, b) => a.name.localeCompare(b.name)), [view]);
  const [id] = useState(() => mode?.id ?? newId());
  const [form, setForm] = useState<ModeForm>(() => (mode === undefined ? NEW_MODE : formOf(mode, tags)));
  const [tried, setTried] = useState(false);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [count, setCount] = useState<number | undefined>(undefined);
  const check = useMemo(() => checkForm(form, id, view.tags, view.modes), [form, id, view]);
  const ids = useId();

  // The count of the shown sites of the pool, from the filter of the host
  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      api.viewer(form.pool, { kind: "title" }).then(
        (answer) => live && setCount(answer.ok ? answer.rows.length : undefined),
        () => live && setCount(undefined),
      );
    }, SETTLE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [api, form.pool, view]);

  const problems = check.ok ? {} : check.problems;
  // The problem of the name and of the asks shows after the first try to save. The problem of the pool shows at once
  const nameProblem = tried ? problems.name : undefined;
  const asksProblem = tried ? problems.asks : undefined;

  const write = async (drafts: Parameters<PairrankApi["apply"]>[0], after: ModeId | null): Promise<void> => {
    setBusy(true);
    try {
      const result = await api.apply(drafts);
      const refused = result.problems[0];
      if (refused !== undefined) {
        setFailure(refused.message);
        return;
      }
      await reload();
      close(after);
    } catch (error) {
      setFailure(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const save = (): void => {
    setTried(true);
    if (check.ok) void write([check.draft], id);
  };

  const has = (ask: Ask): boolean => form.asks.some((each) => sameAsk(each, ask));
  const toggle = (ask: Ask): void => setForm((current) => ({ ...current, asks: toggleAsk(current.asks, ask) }));

  return (
    <form
      className="mode-editor"
      aria-label={mode === undefined ? "New mode" : `Mode ${mode.name}`}
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        close(undefined);
      }}
    >
      <h1>{mode === undefined ? "New mode" : "Change the mode"}</h1>

      <label className="field">
        <span>Name</span>
        <input
          value={form.name}
          aria-invalid={nameProblem !== undefined}
          aria-describedby={nameProblem === undefined ? undefined : `${ids}-name`}
          onChange={(event) => setForm({ ...form, name: event.target.value })}
        />
      </label>
      {nameProblem !== undefined && (
        <p className="problem" id={`${ids}-name`}>
          {nameProblem}
        </p>
      )}

      <label className="field">
        <span>Sites</span>
        <input
          value={form.pool}
          placeholder="Each site"
          spellCheck={false}
          aria-invalid={problems.pool !== undefined}
          aria-describedby={`${ids}-pool`}
          onChange={(event) => setForm({ ...form, pool: event.target.value })}
        />
      </label>
      {problems.pool === undefined ? (
        <p className="hint" id={`${ids}-pool`}>
          {count === undefined ? "A tag query, as on the Sites screen. An empty text takes each site." : `${count} ${count === 1 ? "site" : "sites"} that are not hidden.`}
        </p>
      ) : (
        <p className="problem" id={`${ids}-pool`}>
          {problems.pool.message}
        </p>
      )}

      <fieldset className="asks" aria-describedby={`${ids}-asks`}>
        <legend>The picks of each pair</legend>
        <div className="ask-row">
          <button type="button" className="tag-toggle" aria-pressed={has({ kind: "overall" })} onClick={() => toggle({ kind: "overall" })}>
            Overall
          </button>
          <button type="button" className="tag-toggle" aria-pressed={has({ kind: "shared" })} onClick={() => toggle({ kind: "shared" })}>
            Each shared tag
          </button>
        </div>
        {named.length > 0 && (
          <div className="ask-row" role="group" aria-label="One tag">
            {named.map((tag) => (
              <button key={tag.id} type="button" className="tag-toggle" aria-pressed={has({ kind: "tag", tag: tag.id })} onClick={() => toggle({ kind: "tag", tag: tag.id })}>
                <Swatch color={tag.color} />
                {tag.name}
              </button>
            ))}
          </div>
        )}
        <p className={asksProblem === undefined ? "hint" : "problem"} id={`${ids}-asks`}>
          {asksProblem ??
            (form.asks.length === 0
              ? "Choose one pick or more."
              : `Each pair asks: ${asksText(form.asks, tags)}. A pair has two sites with one of these in common, and a tag pick needs the tag on the two sites.`)}
        </p>
      </fieldset>

      <div className="editor-actions">
        <button type="submit" className="pick" disabled={busy}>
          Save the mode
        </button>
        <button type="button" disabled={busy} onClick={() => close(undefined)}>
          Cancel
        </button>
        {mode !== undefined && (
          <button type="button" className="quiet-danger" disabled={busy} onClick={() => void write([{ type: "mode.deleted", mode: mode.id }], null)}>
            Delete the mode
          </button>
        )}
      </div>
      {failure !== undefined && (
        <p className="problem" role="alert">
          {failure}
        </p>
      )}
    </form>
  );
}

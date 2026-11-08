/**
 * The tag screen: make, find, rename, color, key, merge and delete tags. A rename or a merge keeps the picks of a tag,
 * because the picks name the id of the tag and not its name.
 */
import type { Draft } from "@pairrank/core";
import type { StateView, TagView } from "@pairrank/host/views";
import { type FormEvent, type ReactElement, useId, useMemo, useState } from "react";
import { TAG_COLORS, type TagFields, createDraft, editDraft, findTags, impactOf, tagProblem } from "./tagging.ts";

/** A function that writes drafts, and gives the text of the first problem, or `undefined`. */
export type Write = (drafts: readonly Draft[]) => Promise<string | undefined>;

/** The properties of the tag screen. */
export interface TagsProps {
  readonly view: StateView;
  readonly write: Write;
  /** This function gives the id of a new tag. */
  readonly newId: () => string;
}

const EMPTY: TagFields = { name: "", key: "", color: undefined };

/** The mark of the color of a tag. A tag with no color has an empty mark. */
export function Swatch({ color }: { readonly color: string | undefined }): ReactElement {
  return <span className="swatch" aria-hidden="true" style={color === undefined ? undefined : { background: color, borderColor: color }} />;
}

function ColorChoice({ value, onChange }: { readonly value: string | undefined; readonly onChange: (color: string | undefined) => void }): ReactElement {
  const name = useId();
  const options: readonly { readonly name: string; readonly value: string | undefined }[] = [{ name: "No color", value: undefined }, ...TAG_COLORS];
  return (
    <fieldset className="colors">
      <legend>Color</legend>
      {options.map((option) => (
        <label key={option.name} className="color" title={option.name}>
          <input type="radio" name={name} aria-label={option.name} checked={value === option.value} onChange={() => onChange(option.value)} />
          <Swatch color={option.value} />
        </label>
      ))}
    </fieldset>
  );
}

function TagForm(props: {
  readonly initial: TagFields;
  readonly label: string;
  readonly submit: (fields: TagFields) => Promise<string | undefined>;
  readonly cancel?: () => void;
}): ReactElement {
  const [fields, setFields] = useState(props.initial);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const problemId = useId();
  const change = (next: Partial<TagFields>): void => {
    setFields((current) => ({ ...current, ...next }));
    setProblem(undefined);
  };
  const onSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    const found = await props.submit(fields);
    setBusy(false);
    setProblem(found);
    if (found !== undefined) return;
    if (props.cancel === undefined) setFields(EMPTY);
    else props.cancel();
  };
  return (
    <form className="tag-form" onSubmit={(event) => void onSubmit(event)} aria-describedby={problem === undefined ? undefined : problemId}>
      <label className="field">
        <span>Name</span>
        <input value={fields.name} onChange={(event) => change({ name: event.target.value })} maxLength={80} />
      </label>
      <label className="field key-field">
        <span>Key</span>
        <input value={fields.key} onChange={(event) => change({ key: event.target.value })} maxLength={1} aria-describedby={`${problemId}-key`} />
      </label>
      <ColorChoice value={fields.color} onChange={(color) => change({ color })} />
      <div className="form-actions">
        <button type="submit" className="primary" disabled={busy}>
          {props.label}
        </button>
        {props.cancel !== undefined && (
          <button type="button" onClick={props.cancel}>
            Cancel
          </button>
        )}
      </div>
      <p id={`${problemId}-key`} className="hint">
        Press the key on the Look screen to put the tag on a site, or to remove it.
      </p>
      {problem !== undefined && (
        <p id={problemId} className="problem" role="alert">
          {problem}
        </p>
      )}
    </form>
  );
}

type Step = { readonly kind: "edit" } | { readonly kind: "merge"; readonly into: string } | { readonly kind: "delete" };

function TagRow(props: { readonly tag: TagView; readonly view: StateView; readonly write: Write; readonly open: boolean; readonly toggle: () => void }): ReactElement {
  const { tag, view, write } = props;
  const [step, setStep] = useState<Step>({ kind: "edit" });
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const impact = impactOf(view, tag.id);
  const others = view.tags.filter((other) => other.id !== tag.id).sort((a, b) => a.name.localeCompare(b.name));
  const run = async (drafts: readonly Draft[]): Promise<void> => {
    const found = await write(drafts);
    setProblem(found);
    if (found === undefined) setStep({ kind: "edit" });
  };
  const target = step.kind === "merge" ? view.tags.find((other) => other.id === step.into) : undefined;
  return (
    <li className="tag-row" data-open={props.open}>
      <button type="button" className="tag-head" aria-expanded={props.open} onClick={props.toggle}>
        <Swatch color={tag.color} />
        <span className="tag-name">{tag.name}</span>
        <span className="key">{tag.key === undefined ? "" : tag.key}</span>
        <span className="figures">
          Sites {tag.sites}, picks {impact.picks}
        </span>
      </button>
      {props.open && (
        <div className="tag-panel">
          <TagForm
            initial={{ name: tag.name, key: tag.key ?? "", color: tag.color }}
            label="Save"
            cancel={props.toggle}
            submit={async (fields) => {
              const found = tagProblem(fields, view.tags, tag.id);
              if (found !== undefined) return found;
              const draft = editDraft(tag, fields);
              return draft === undefined ? undefined : write([draft]);
            }}
          />
          <div className="tag-ends">
            {step.kind !== "delete" && others.length > 0 && (
              <div className="merge">
                <label className="field">
                  <span>Merge into</span>
                  <select value={step.kind === "merge" ? step.into : ""} onChange={(event) => setStep(event.target.value === "" ? { kind: "edit" } : { kind: "merge", into: event.target.value })}>
                    <option value="">Select a tag</option>
                    {others.map((other) => (
                      <option key={other.id} value={other.id}>
                        {other.name}
                      </option>
                    ))}
                  </select>
                </label>
                {target !== undefined && (
                  <div className="confirm">
                    <p>
                      The sites ({impact.sites}) and the picks ({impact.picks}) of {tag.name} go to {target.name}. Then the tag {tag.name} goes away.
                    </p>
                    <button type="button" className="primary" onClick={() => void run([{ type: "tag.merged", tag: tag.id, into: target.id }])}>
                      Merge {tag.name} into {target.name}
                    </button>
                  </div>
                )}
              </div>
            )}
            {step.kind === "delete" ? (
              <div className="confirm">
                <p>
                  The tag {tag.name} goes away from its sites ({impact.sites}). Its picks ({impact.picks}) leave each ladder, and the log keeps them.
                </p>
                <button type="button" className="danger" onClick={() => void run([{ type: "tag.deleted", tag: tag.id }])}>
                  Delete {tag.name}
                </button>
                <button type="button" onClick={() => setStep({ kind: "edit" })}>
                  Keep the tag
                </button>
              </div>
            ) : (
              <button type="button" className="quiet-danger" onClick={() => setStep({ kind: "delete" })}>
                Delete the tag
              </button>
            )}
          </div>
          {problem !== undefined && (
            <p className="problem" role="alert">
              {problem}
            </p>
          )}
        </div>
      )}
    </li>
  );
}

/** The tag screen. */
export function TagsScreen({ view, write, newId }: TagsProps): ReactElement {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | undefined>(undefined);
  const found = useMemo(() => findTags(view.tags, query), [view.tags, query]);
  return (
    <main className="tags">
      <section className="new-tag" aria-label="New tag">
        <h2>New tag</h2>
        <TagForm
          initial={EMPTY}
          label="Make the tag"
          submit={async (fields) => tagProblem(fields, view.tags) ?? write([createDraft(newId(), fields)])}
        />
      </section>
      <section aria-label="Tags">
        {view.tags.length === 0 ? (
          <p className="none">No tags yet. Make a tag here, and then put it on sites on the Look screen.</p>
        ) : (
          <>
            <input className="search" type="search" placeholder="Find a tag by name" aria-label="Find a tag" value={query} onChange={(event) => setQuery(event.target.value)} />
            <ul className="tag-list">
              {found.map((tag) => (
                <TagRow key={tag.id} tag={tag} view={view} write={write} open={open === tag.id} toggle={() => setOpen((current) => (current === tag.id ? undefined : tag.id))} />
              ))}
            </ul>
            {found.length === 0 && <p className="none">No tag has this name.</p>}
          </>
        )}
      </section>
    </main>
  );
}

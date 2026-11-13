/**
 * The import of the Chrome bookmarks, in three steps. First the user chooses the files. Then the user includes or
 * excludes folders. Then the user reviews the import. The folders choose the sites, and they do not become tags.
 */
import { countOf, errorMessage } from "@mark1russell7/text";
import type { ImportPreview, ImportResult } from "@pairrank/host/views";
import { type BookmarkSource, type FolderChoice, type FolderSelection, ALL_FOLDERS, choicesOf, choose, chromeSiteList, includedCounts } from "@pairrank/input";
import type { BookmarkFolder } from "@procedures/browser/bookmarks";
import { type ChangeEvent, type ReactElement, useEffect, useMemo, useRef, useState } from "react";
import type { BookmarksApi, PairrankApi } from "./api.ts";
import { type Book, type BoxState, boxState, clickChoice, everyFolder, kindText, readChosenFile, rootsOf } from "./importing.ts";

/** The properties of the import screen. */
export interface ImportProps {
  readonly api: PairrankApi;
  /** The procedures of the bookmarks files. A host with no access to the files gives none. */
  readonly bookmarks: BookmarksApi | undefined;
  /** This function reads the state again after the import. */
  readonly reload: () => Promise<void>;
  /** This function goes to the Sites screen, or to the Look screen to tag the new sites. */
  readonly leave: (to: "sites" | "look") => void;
}

type Step = "files" | "folders" | "review" | "done";

const STEPS: readonly { readonly step: Step; readonly name: string }[] = [
  { step: "files", name: "Choose the files" },
  { step: "folders", name: "Choose the folders" },
  { step: "review", name: "Review and import" },
];

/** The list of the steps, with the current step. */
function Steps({ step }: { readonly step: Step }): ReactElement {
  const at = step === "done" ? STEPS.length : STEPS.findIndex((each) => each.step === step);
  return (
    <ol className="steps" aria-label="Steps of the import">
      {STEPS.map((each, index) => (
        <li key={each.step} data-state={index < at ? "done" : index === at ? "now" : "later"} aria-current={index === at ? "step" : undefined}>
          {each.name}
        </li>
      ))}
    </ol>
  );
}

/** The box of a folder. A box with some included sites shows a dash. */
function FolderBox(props: { readonly state: BoxState; readonly label: string; readonly onChange: () => void }): ReactElement {
  const box = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (box.current !== null) box.current.indeterminate = props.state === "mixed";
  }, [props.state]);
  return <input ref={box} type="checkbox" aria-label={props.label} checked={props.state === "on"} onChange={props.onChange} />;
}

interface TreeProps {
  readonly counts: ReadonlyMap<string, number>;
  readonly choices: ReadonlyMap<string, FolderChoice>;
  readonly open: ReadonlySet<string>;
  readonly toggle: (key: string) => void;
  readonly choose: (key: string, choice: FolderChoice) => void;
}

/** A folder of the tree, with its box, its counts and the folders in it when it is open. */
function FolderRow({ folder, ...tree }: TreeProps & { readonly folder: BookmarkFolder }): ReactElement {
  const included = tree.counts.get(folder.key) ?? 0;
  const state = boxState(folder, included, tree.choices.get(folder.key) ?? "include");
  const opened = tree.open.has(folder.key);
  return (
    <li data-state={state}>
      <div className="folder-row">
        {folder.folders.length > 0 ? (
          <button type="button" className="disclose" aria-expanded={opened} aria-label={`${opened ? "Close" : "Open"} ${folder.name}`} onClick={() => tree.toggle(folder.key)}>
            {opened ? "▾" : "▸"}
          </button>
        ) : (
          <span className="disclose" aria-hidden="true" />
        )}
        <label>
          <FolderBox state={state} label={folder.name} onChange={() => tree.choose(folder.key, clickChoice(state))} />
          <span className="folder-name">{folder.name}</span>
        </label>
        <span className="folder-count">{state === "mixed" ? `${included.toLocaleString("en")} of ${countOf(folder.total, "site")}` : countOf(folder.total, "site")}</span>
      </div>
      {opened && (
        <ul className="folders">
          {folder.folders.map((each) => (
            <FolderRow key={each.key} folder={each} {...tree} />
          ))}
        </ul>
      )}
    </li>
  );
}

/** The import screen. */
export function ImportScreen({ api, bookmarks, reload, leave }: ImportProps): ReactElement {
  const [step, setStep] = useState<Step>("files");
  const [sources, setSources] = useState<readonly BookmarkSource[] | undefined>(bookmarks === undefined ? [] : undefined);
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [picked, setPicked] = useState<readonly Book[]>([]);
  const [books, setBooks] = useState<readonly Book[]>([]);
  const [selection, setSelection] = useState<FolderSelection>(ALL_FOLDERS);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [preview, setPreview] = useState<ImportPreview | undefined>(undefined);
  const [result, setResult] = useState<ImportResult | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<readonly string[]>([]);
  const files = useRef(0);
  const body = useRef<HTMLElement>(null);
  // The button of a step goes away at the next step, so the focus goes to the new step
  const first = useRef(true);
  useEffect(() => {
    if (first.current) first.current = false;
    else body.current?.focus();
  }, [step]);

  useEffect(() => {
    if (bookmarks === undefined) return;
    let live = true;
    bookmarks.sources().then(
      (found) => {
        if (!live) return;
        setSources(found);
        setChosen(new Set(found.map((source) => source.id)));
      },
      (error: unknown) => {
        if (!live) return;
        setSources([]);
        setProblems([`The app could not look for the Chrome profiles. ${errorMessage(error)}`]);
      },
    );
    return () => {
      live = false;
    };
  }, [bookmarks]);

  const roots = useMemo(() => rootsOf(books), [books]);
  const counts = useMemo(() => includedCounts(roots, selection), [roots, selection]);
  const choices = useMemo(() => choicesOf(roots, selection), [roots, selection]);
  const included = roots.reduce((sum, root) => sum + (counts.get(root.key) ?? 0), 0);
  const all = [...(sources ?? []), ...picked.map((book) => book.source)];

  const flip = (id: string): void =>
    setChosen((now) => {
      const next = new Set(now);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const pick = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const list = [...(event.target.files ?? [])];
    event.target.value = "";
    const found: string[] = [];
    for (const file of list) {
      try {
        const book = await readChosenFile(file, ++files.current);
        setPicked((now) => [...now, book]);
        setChosen((now) => new Set([...now, book.source.id]));
      } catch (error) {
        found.push(errorMessage(error));
      }
    }
    setProblems(found);
  };

  const showFolders = async (): Promise<void> => {
    setBusy(true);
    const found: string[] = [];
    const read: Book[] = [];
    for (const source of all.filter((each) => chosen.has(each.id))) {
      const local = picked.find((book) => book.source.id === source.id);
      if (local !== undefined) {
        read.push(local);
        continue;
      }
      try {
        read.push({ source, read: await (bookmarks as BookmarksApi).read(source.id) });
      } catch (error) {
        found.push(`${source.name}: ${errorMessage(error)}`);
      }
    }
    setBusy(false);
    setProblems(found);
    if (read.length === 0) return;
    setBooks(read);
    // The keys of a file are the same at each read, so the choices of an earlier read stay
    setOpen((now) => new Set([...now, ...rootsOf(read).map((root) => root.key)]));
    setStep("folders");
  };

  const review = async (): Promise<void> => {
    setBusy(true);
    try {
      setPreview(await api.planImport(chromeSiteList(roots, selection)));
      setProblems([]);
      setStep("review");
    } catch (error) {
      setProblems([`The app could not prepare the import. ${errorMessage(error)}`]);
    }
    setBusy(false);
  };

  const apply = async (): Promise<void> => {
    setBusy(true);
    try {
      const done = await api.importList(chromeSiteList(roots, selection));
      setResult(done);
      setProblems(done.problems.map((problem) => problem.message));
      await reload();
      setStep("done");
    } catch (error) {
      setProblems([`The app did not import the sites. ${errorMessage(error)}`]);
    }
    setBusy(false);
  };

  const tree: TreeProps = {
    counts,
    choices,
    open,
    toggle: (key) =>
      setOpen((now) => {
        const next = new Set(now);
        if (!next.delete(key)) next.add(key);
        return next;
      }),
    choose: (key, choice) => setSelection((now) => choose(roots, now, key, choice)),
  };

  return (
    <main className="import">
      <header className="import-head">
        <h1>Import Chrome bookmarks</h1>
        <Steps step={step} />
      </header>

      {problems.length > 0 && (
        <ul className="problems" role="alert">
          {problems.map((problem, index) => (
            <li key={index}>{problem}</li>
          ))}
        </ul>
      )}

      {step === "files" && (
        <section ref={body} tabIndex={-1} className="import-body" aria-label="Choose the files">
          {sources === undefined && <p className="quiet">Looking for the Chrome profiles on this computer…</p>}
          {sources !== undefined && bookmarks !== undefined && sources.length === 0 && <p className="quiet">The app found no Chrome profile on this computer. Choose a bookmarks file.</p>}
          {all.length > 0 && (
            <ul className="sources">
              {all.map((source) => (
                <li key={source.id}>
                  <label>
                    <input type="checkbox" checked={chosen.has(source.id)} onChange={() => flip(source.id)} />
                    <span className="source-name">{source.name}</span>
                    <span className="source-kind">{kindText(source.kind)}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          <label className="choose-file">
            <input type="file" multiple onChange={(event) => void pick(event)} />
            Choose a bookmarks file
          </label>
          <div className="import-actions">
            <button type="button" className="primary" disabled={busy || !all.some((source) => chosen.has(source.id))} onClick={() => void showFolders()}>
              Show the folders
            </button>
          </div>
        </section>
      )}

      {step === "folders" && (
        <section ref={body} tabIndex={-1} className="import-body" aria-label="Choose the folders">
          <div className="import-bar">
            <span className="import-total" aria-live="polite">
              {countOf(included, "site")} in the import
            </span>
            <button type="button" onClick={() => setSelection(everyFolder("include"))}>
              Include all
            </button>
            <button type="button" onClick={() => setSelection(everyFolder("exclude"))}>
              Exclude all
            </button>
            <span className="grow" />
            <button type="button" onClick={() => setStep("files")}>
              Back
            </button>
            <button type="button" className="primary" disabled={busy || included === 0} onClick={() => void review()}>
              Review the import
            </button>
          </div>
          <p className="quiet">The folders choose the sites. They do not become tags.</p>
          {books.map((book) => (
            <section key={book.source.id} className="book" aria-label={book.source.name}>
              <h2>
                {book.source.name} <span className="source-kind">{kindText(book.source.kind)}</span>
              </h2>
              {(book.read.skipped > 0 || book.read.problems.length > 0) && (
                <p className="quiet">
                  {book.read.skipped > 0 && `${countOf(book.read.skipped, "bookmark")} of this file ${book.read.skipped === 1 ? "is" : "are"} not a web page, for example a chrome:// address. `}
                  {book.read.problems.length > 0 && `The app could not read ${countOf(book.read.problems.length, "part")} of this file. `}
                  The import leaves them out.
                </p>
              )}
              <ul className="folders" aria-label={`Folders of ${book.source.name}`}>
                {book.read.roots.map((root) => (
                  <FolderRow key={root.key} folder={root} {...tree} />
                ))}
              </ul>
            </section>
          ))}
        </section>
      )}

      {step === "review" && preview !== undefined && (
        <section ref={body} tabIndex={-1} className="import-body" aria-label="Review and import">
          <dl className="report">
            <div>
              <dt>New sites</dt>
              <dd>{preview.report.added.toLocaleString("en")}</dd>
            </div>
            <div>
              <dt>Already in the app</dt>
              <dd>{preview.report.existing.toLocaleString("en")}</dd>
            </div>
            <div>
              <dt>Copies of another bookmark</dt>
              <dd>{preview.report.merged.toLocaleString("en")}</dd>
            </div>
          </dl>
          <p className="quiet">
            The app keeps one site for each address. A site that is already in the app does not change.
            {preview.entries.length > 0 && ` ${countOf(preview.entries.length, "bookmark")} ${preview.entries.length === 1 ? "is" : "are"} not valid, so the import leaves them out.`}
          </p>
          <div className="import-actions">
            <button type="button" onClick={() => setStep("folders")}>
              Back to the folders
            </button>
            <button type="button" className="primary" disabled={busy || preview.report.added === 0} onClick={() => void apply()}>
              {preview.report.added === 0 ? "No new sites to import" : `Import ${countOf(preview.report.added, "site")}`}
            </button>
          </div>
        </section>
      )}

      {step === "done" && result !== undefined && (
        <section ref={body} tabIndex={-1} className="import-body" aria-label="The import is done">
          <p className="import-done">The import added {countOf(result.report.added, "site")}.</p>
          <div className="import-actions">
            <button type="button" onClick={() => leave("sites")}>
              Show the sites
            </button>
            <button type="button" className="primary" onClick={() => leave("look")}>
              Tag the sites one at a time
            </button>
          </div>
        </section>
      )}
    </main>
  );
}

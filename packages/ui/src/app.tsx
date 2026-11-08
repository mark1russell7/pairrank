/**
 * The interface of pairrank: a list of the sites, the tags, the import, the tag run and the duel. The tag run on the
 * Look screen shows one site at a time. The duel shows two sites side by side in the same frame.
 */
import type { Draft } from "@pairrank/core";
import type { SiteView, StateView, TagView } from "@pairrank/host/views";
import { type Surface, trackSlots } from "@pairrank/surfaces";
import { type ReactElement, useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import type { BookmarksApi, PairrankApi } from "./api.ts";
import { DuelScreen } from "./duel-screen.tsx";
import { HiddenSites } from "./hidden-sites.tsx";
import { ImportScreen } from "./import-screen.tsx";
import { countOf } from "./importing.ts";
import { LookScreen, nameOf } from "./look-screen.tsx";
import { TagsScreen, type Write } from "./tags.tsx";

/** The screens of the interface. */
export type Screen = "sites" | "tags" | "look" | "duel" | "import";

/** The properties of the interface. */
export interface AppProps {
  readonly api: PairrankApi;
  readonly surface: Surface;
  /** The procedures of the bookmarks files of the host. With none, the import reads only a file that the user chooses. */
  readonly bookmarks?: BookmarksApi;
  /** This function gives the id of a new tag. The default is `crypto.randomUUID`. */
  readonly newId?: () => string;
}

/** This function gives the sites that are not hidden, in the order of the state. */
export function visibleSites(view: StateView): readonly SiteView[] {
  return view.sites.filter((site) => !site.hidden);
}

/** This function tells if a site agrees with a search text. The search examines the title and the address. */
export function matches(site: SiteView, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter((word) => word !== "");
  const text = `${site.title ?? ""} ${site.url}`.toLowerCase();
  return words.every((word) => text.includes(word));
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The interface of pairrank. */
export function App({ api, surface, bookmarks, newId = () => crypto.randomUUID() }: AppProps): ReactElement {
  const tracker = useMemo(() => trackSlots(surface), [surface]);
  useEffect(() => () => tracker.stop(), [tracker]);
  const [view, setView] = useState<StateView | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [screen, setScreen] = useState<Screen>("sites");
  // Each start of a run gets a new key. A run from the list of the sites starts at the chosen site
  const [look, setLook] = useState<{ readonly n: number; readonly start: string | undefined }>({ n: 0, start: undefined });
  const startLook = (start?: string): void => {
    setLook((now) => ({ n: now.n + 1, start }));
    setScreen("look");
  };
  const [query, setQuery] = useState("");
  // The Sites screen lists the shown sites or the hidden sites
  const [which, setWhich] = useState<"shown" | "hidden">("shown");
  // Each start of an import gets a new key, so the import starts again at its first step
  const [run, setRun] = useState(0);
  const startImport = (): void => {
    setRun((n) => n + 1);
    setScreen("import");
  };

  const reload = useCallback(async (): Promise<void> => {
    try {
      setView(await api.view());
      setError(undefined);
    } catch (failure) {
      setError(messageOf(failure));
    }
  }, [api]);
  useEffect(() => void reload(), [reload]);

  const write = useCallback<Write>(
    async (drafts: readonly Draft[]) => {
      try {
        const result = await api.apply(drafts);
        await reload();
        return result.problems[0]?.message;
      } catch (failure) {
        return messageOf(failure);
      }
    },
    [api, reload],
  );

  const sites = useMemo(() => (view === undefined ? [] : visibleSites(view)), [view]);
  const tags = useMemo(() => new Map<string, TagView>(view?.tags.map((tag) => [tag.id, tag]) ?? []), [view]);
  const found = useMemo(() => sites.filter((site) => matches(site, query)), [sites, query]);
  const hidden = useMemo(() => view?.sites.filter((site) => site.hidden) ?? [], [view]);
  const foundHidden = useMemo(() => hidden.filter((site) => matches(site, query)), [hidden, query]);

  return (
    <div className="app" data-screen={screen}>
      <header className="strip">
        <span className="mark">pairrank</span>
        <nav aria-label="Screens">
          <button type="button" aria-pressed={screen === "sites"} onClick={() => setScreen("sites")}>
            Sites
          </button>
          <button type="button" aria-pressed={screen === "tags"} disabled={view === undefined} onClick={() => setScreen("tags")}>
            Tags
          </button>
          <button type="button" aria-pressed={screen === "look"} disabled={sites.length === 0} onClick={() => startLook()}>
            Look
          </button>
          <button type="button" aria-pressed={screen === "duel"} disabled={sites.length < 2} onClick={() => setScreen("duel")}>
            Duel
          </button>
          <button type="button" aria-pressed={screen === "import"} onClick={startImport}>
            Import
          </button>
        </nav>
        <span className="count">{view === undefined ? "" : `${countOf(sites.length, "site")}, ${countOf(view.tags.length, "tag")}`}</span>
      </header>

      {error !== undefined && (
        <p className="error" role="alert">
          The app could not read the data. {error}
        </p>
      )}

      {screen === "sites" && (
        <main className="sites">
          {view !== undefined && view.sites.length === 0 && (
            <section className="empty">
              <h1>No sites yet</h1>
              <p>Import your Chrome bookmarks to start. You choose the folders, and the folders do not become tags.</p>
              <button type="button" className="primary" onClick={startImport}>
                Import Chrome bookmarks
              </button>
            </section>
          )}
          {view !== undefined && view.sites.length > 0 && (
            <>
              <input className="search" type="search" placeholder="Find a site by title or address" aria-label="Find a site" value={query} onChange={(event) => setQuery(event.target.value)} />
              {(hidden.length > 0 || which === "hidden") && (
                <div className="which" role="group" aria-label="Which sites">
                  <button type="button" aria-pressed={which === "shown"} onClick={() => setWhich("shown")}>
                    Shown <span className="count-of">{sites.length}</span>
                  </button>
                  <button type="button" aria-pressed={which === "hidden"} onClick={() => setWhich("hidden")}>
                    Hidden <span className="count-of">{hidden.length}</span>
                  </button>
                </div>
              )}
              {which === "hidden" && <HiddenSites sites={foundHidden} total={hidden.length} write={write} />}
              {which === "shown" && (
                <>
                  <ol className="site-list">
                    {found.map((site) => (
                      <li key={site.id}>
                        <button type="button" onClick={() => startLook(site.id)}>
                          <span className="site-name">{nameOf(site)}</span>
                          <span className="site-url">{site.url}</span>
                          <span className="site-tags">
                            {site.tags.map((id) => (
                              <span className="tag" key={id} style={tags.get(id)?.color === undefined ? undefined : { borderColor: tags.get(id)?.color }}>
                                {tags.get(id)?.name ?? id}
                              </span>
                            ))}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ol>
                  {sites.length === 0 && <p className="none">Each site is hidden. Choose Hidden to restore a site.</p>}
                  {sites.length > 0 && found.length === 0 && <p className="none">No site agrees with this search.</p>}
                </>
              )}
            </>
          )}
        </main>
      )}

      {screen === "import" && (
        <ImportScreen
          key={run}
          api={api}
          bookmarks={bookmarks}
          reload={reload}
          leave={(to) => (to === "look" ? startLook() : setScreen(to))}
        />
      )}

      {screen === "tags" && view !== undefined && <TagsScreen view={view} write={write} newId={newId} />}

      {screen === "duel" && view !== undefined && (
        <DuelScreen api={api} view={view} surface={surface} tracker={tracker} reload={reload} newId={newId} leave={() => setScreen("sites")} />
      )}

      {screen === "look" && view !== undefined && (
        <LookScreen key={look.n} view={view} surface={surface} tracker={tracker} write={write} newId={newId} start={look.start} leave={() => setScreen("sites")} />
      )}
    </div>
  );
}

/** This function shows the interface in an element, and gives the function that removes it. */
export function mount(element: Element, props: AppProps): () => void {
  const root = createRoot(element);
  root.render(<App {...props} />);
  return () => root.unmount();
}

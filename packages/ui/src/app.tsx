/**
 * The interface of pairrank: a list of the sites, the tags, and a look at one site at a time. On the Look screen, the
 * key of a tag puts the tag on the site or removes it. The duel uses the same frame and the same slot.
 */
import type { Draft } from "@pairrank/core";
import type { SiteView, StateView, TagView } from "@pairrank/host/views";
import { type Surface, trackSlots } from "@pairrank/surfaces";
import { type FormEvent, type ReactElement, useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import type { PairrankApi } from "./api.ts";
import { Slot } from "./slot.tsx";
import { createDraft, tagProblem, toggleDraft } from "./tagging.ts";
import { Swatch, TagsScreen, type Write } from "./tags.tsx";

/** The screens of the interface. */
export type Screen = "sites" | "tags" | "look";

/** The properties of the interface. */
export interface AppProps {
  readonly api: PairrankApi;
  readonly surface: Surface;
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

/** This function gives the name of a site: its title, or its address with no scheme. */
export function nameOf(site: SiteView): string {
  return site.title !== undefined && site.title.trim() !== "" ? site.title : site.url.replace(/^https?:\/\//i, "");
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The interface of pairrank. */
/** The strip of the tags of the site on the Look screen, with a field that makes a tag and puts it on the site. */
function TagStrip(props: { readonly site: SiteView; readonly tags: readonly TagView[]; readonly write: Write; readonly newId: () => string }): ReactElement {
  const { site, tags, write } = props;
  const [name, setName] = useState("");
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const make = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (name.trim() === "") return;
    const fields = { name, key: "", color: undefined };
    const id = props.newId();
    const found = tagProblem(fields, tags) ?? (await write([createDraft(id, fields), { type: "site.tagged", site: site.id, tag: id }]));
    setProblem(found);
    if (found === undefined) setName("");
  };
  return (
    <div className="strip tag-strip" role="group" aria-label="Tags of the site">
      {tags.map((tag) => (
        <button type="button" key={tag.id} className="tag-toggle" aria-pressed={site.tags.includes(tag.id)} onClick={() => void write([toggleDraft(site, tag.id)]).then(setProblem)}>
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

const editable = (target: EventTarget | null): boolean => target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement;

export function App({ api, surface, newId = () => crypto.randomUUID() }: AppProps): ReactElement {
  const tracker = useMemo(() => trackSlots(surface), [surface]);
  useEffect(() => () => tracker.stop(), [tracker]);
  const [view, setView] = useState<StateView | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [screen, setScreen] = useState<Screen>("sites");
  const [index, setIndex] = useState(0);
  const [query, setQuery] = useState("");

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
  const named = useMemo(() => [...(view?.tags ?? [])].sort((a, b) => a.name.localeCompare(b.name)), [view]);
  const current = sites.length === 0 ? undefined : sites[Math.min(index, sites.length - 1)];
  const position = current === undefined ? 0 : sites.indexOf(current);

  const step = useCallback((by: number) => setIndex((at) => (sites.length === 0 ? 0 : (Math.min(at, sites.length - 1) + by + sites.length) % sites.length)), [sites.length]);

  useEffect(() => {
    if (screen !== "look") return;
    const onKey = (event: KeyboardEvent): void => {
      if (editable(event.target) || event.ctrlKey || event.metaKey || event.altKey) return;
      const keyed = named.find((tag) => tag.key !== undefined && tag.key === event.key.toLowerCase());
      if (event.key === "ArrowRight" || event.key === "j") step(1);
      else if (event.key === "ArrowLeft" || event.key === "k") step(-1);
      else if (event.key === "Escape") setScreen("sites");
      else if (keyed !== undefined && current !== undefined) void write([toggleDraft(current, keyed.id)]);
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [screen, step, named, current, write]);

  const found = useMemo(() => sites.filter((site) => matches(site, query)), [sites, query]);

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
          <button type="button" aria-pressed={screen === "look"} disabled={sites.length === 0} onClick={() => setScreen("look")}>
            Look
          </button>
        </nav>
        <span className="count">{view === undefined ? "" : `${sites.length} sites, ${view.tags.length} tags`}</span>
      </header>

      {error !== undefined && (
        <p className="error" role="alert">
          The app could not read the data. {error}
        </p>
      )}

      {screen === "sites" && (
        <main className="sites">
          {view !== undefined && sites.length === 0 && (
            <section className="empty">
              <h1>No sites yet</h1>
              <p>Import your Chrome bookmarks to start. The import is the next part of the app.</p>
            </section>
          )}
          {sites.length > 0 && (
            <>
              <input className="search" type="search" placeholder="Find a site by title or address" aria-label="Find a site" value={query} onChange={(event) => setQuery(event.target.value)} />
              <ol className="site-list">
                {found.map((site) => (
                  <li key={site.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setIndex(sites.indexOf(site));
                        setScreen("look");
                      }}
                    >
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
              {found.length === 0 && <p className="none">No site agrees with this search.</p>}
            </>
          )}
        </main>
      )}

      {screen === "tags" && view !== undefined && <TagsScreen view={view} write={write} newId={newId} />}

      {screen === "look" && current !== undefined && (
        <main className="look">
          <Slot surface={surface} tracker={tracker} slot="main" url={current.url} />
          <TagStrip site={current} tags={named} write={write} newId={newId} />
          <footer className="strip caption">
            <button type="button" aria-label="Previous site" onClick={() => step(-1)}>
              ‹
            </button>
            <span className="site-name">{nameOf(current)}</span>
            <span className="site-url">{current.url}</span>
            <span className="count">
              {position + 1} of {sites.length}
            </span>
            <button type="button" aria-label="Next site" onClick={() => step(1)}>
              ›
            </button>
          </footer>
        </main>
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

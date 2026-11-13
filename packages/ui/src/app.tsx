/**
 * The interface of pairrank: a list of the sites, the tags, the import, the tag run and the duel. The tag run on the
 * Look screen shows one site at a time. The duel shows two sites side by side in the same frame.
 */
import { countOf, errorMessage } from "@mark1russell7/text";
import type { Draft } from "@pairrank/core";
import type { SiteView, StateView } from "@pairrank/host/views";
import { type Surface, trackSlots } from "@pairrank/surfaces";
import { type ReactElement, useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import type { BookmarksApi, PairrankApi } from "./api.ts";
import { DuelScreen } from "./duel-screen.tsx";
import { ImportScreen } from "./import-screen.tsx";
import { pageListOf } from "./page-list.ts";
import { LookScreen } from "./look-screen.tsx";
import { type SiteList, SitesScreen } from "./sites-screen.tsx";
import { TagsScreen, type Write } from "./tags.tsx";
import { FIRST_SETTINGS, type ViewerSettings } from "./viewer.ts";

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
  /** The first seed of the mix of the viewer. The default comes from the time of the start, so each start gives a new mix. */
  readonly seed?: number;
}

/** This function gives the sites that are not hidden, in the order of the state. */
export function visibleSites(view: StateView): readonly SiteView[] {
  return view.sites.filter((site) => !site.hidden);
}

/** The interface of pairrank. */
export function App({ api, surface, bookmarks, newId = () => crypto.randomUUID(), seed }: AppProps): ReactElement {
  const tracker = useMemo(() => trackSlots(surface), [surface]);
  useEffect(() => () => tracker.stop(), [tracker]);
  const [view, setView] = useState<StateView | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [screen, setScreen] = useState<Screen>("sites");
  // Each start of a run gets a new key. A run from the viewer has its list, and starts at the chosen site
  const [look, setLook] = useState<{ readonly n: number; readonly start: string | undefined; readonly list: SiteList | undefined }>({
    n: 0,
    start: undefined,
    list: undefined,
  });
  const startLook = (list?: SiteList, start?: string): void => {
    setLook((now) => ({ n: now.n + 1, start, list }));
    setScreen("look");
  };
  // The settings of the viewer stay while the user is on another screen
  const [settings, setSettings] = useState<ViewerSettings>(() => ({ ...FIRST_SETTINGS, seed: seed ?? Date.now() % 2 ** 31 }));
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
      setError(errorMessage(failure));
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
        return errorMessage(failure);
      }
    },
    [api, reload],
  );

  const sites = useMemo(() => (view === undefined ? [] : visibleSites(view)), [view]);
  const pages = useMemo(() => pageListOf(api, reload), [api, reload]);

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

      {screen === "sites" && view !== undefined && (
        <SitesScreen api={api} view={view} write={write} settings={settings} setSettings={setSettings} look={startLook} startImport={startImport} />
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
        <DuelScreen api={api} view={view} surface={surface} tracker={tracker} reload={reload} newId={newId} leave={() => setScreen("sites")} pages={pages} />
      )}

      {screen === "look" && view !== undefined && (
        <LookScreen key={look.n} view={view} surface={surface} tracker={tracker} write={write} newId={newId} start={look.start} list={look.list} leave={() => setScreen("sites")} pages={pages} />
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

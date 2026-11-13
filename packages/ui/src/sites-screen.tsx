/**
 * The Sites screen: the viewer. It lists the sites that agree with a tag query, in the order of a rating, a title or a
 * date. A text search narrows the list. A click on a site shows the list one site at a time, from that site.
 */
import { countOf, errorMessage, wordSearch } from "@mark1russell7/text";
import type { SiteView, StateView, TagView, ViewerAnswer, ViewerRow } from "@pairrank/host/views";
import { type ReactElement, useEffect, useMemo, useState } from "react";
import type { PairrankApi } from "./api.ts";
import { HiddenSites } from "./hidden-sites.tsx";
import { nameOf } from "./look-screen.tsx";
import { Swatch, type Write } from "./tags.tsx";
import { MIX_LEVELS, type MixLevel, type ViewerSettings, mixLevelOf, orderChoices, orderOf, ratingText } from "./viewer.ts";

/** A list of sites for a run of the Look screen, in its order, with a name. */
export interface SiteList {
  readonly ids: readonly string[];
  readonly name: string;
}

/** The properties of the Sites screen. */
export interface SitesProps {
  readonly api: PairrankApi;
  readonly view: StateView;
  readonly write: Write;
  readonly settings: ViewerSettings;
  readonly setSettings: (settings: ViewerSettings) => void;
  /** This function shows the sites of a list one at a time, from the site `start`. */
  readonly look: (list: SiteList, start?: string) => void;
  readonly startImport: () => void;
}

/** This function tells if a site agrees with a search text. The search examines the title and the address. */
export function matches(site: SiteView, query: string): boolean {
  return wordSearch(query)(`${site.title ?? ""} ${site.url}`);
}

/** The time that the viewer waits after a change of the settings before it asks the host, in milliseconds. */
const SETTLE_MS = 120;

/** The Sites screen. */
export function SitesScreen({ api, view, write, settings, setSettings, look, startImport }: SitesProps): ReactElement {
  const [search, setSearch] = useState("");
  // The screen lists the shown sites or the hidden sites
  const [which, setWhich] = useState<"shown" | "hidden">("shown");
  // The last answer with rows stays on the screen while the text of the query has a problem
  const [rows, setRows] = useState<readonly ViewerRow[] | undefined>(undefined);
  const [answer, setAnswer] = useState<ViewerAnswer | undefined>(undefined);
  const [failure, setFailure] = useState<string | undefined>(undefined);

  const tags = useMemo(() => new Map<string, TagView>(view.tags.map((tag) => [tag.id, tag])), [view]);
  const byId = useMemo(() => new Map(view.sites.map((site) => [site.id, site])), [view]);
  // A deleted tag leaves the settings
  const mean = useMemo(() => settings.mean.filter((tag) => tags.has(tag)), [settings.mean, tags]);
  const order = settings.order.startsWith("tag:") && !tags.has(settings.order.slice("tag:".length)) ? "added" : settings.order;
  const ask = useMemo(() => orderOf({ ...settings, order, mean }) ?? { kind: "title" as const }, [settings, order, mean]);

  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      api.viewer(settings.query, ask).then(
        (got) => {
          if (!live) return;
          setAnswer(got);
          setFailure(undefined);
          if (got.ok) setRows(got.rows);
        },
        (error: unknown) => live && setFailure(errorMessage(error)),
      );
    }, SETTLE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // The view changes after each write, so the list follows the tags and the picks
  }, [api, settings.query, ask, view]);

  const shown = useMemo(() => view.sites.filter((site) => !site.hidden), [view]);
  const hidden = useMemo(() => view.sites.filter((site) => site.hidden), [view]);
  // Before the first answer, the list has the shown sites in the order of the state
  const listed = useMemo(
    () => (rows ?? shown.map((site): ViewerRow => ({ site: site.id, score: undefined, se: undefined, ladders: 0 }))).flatMap((row) => {
      const site = byId.get(row.site);
      return site === undefined || site.hidden || !matches(site, search) ? [] : [{ row, site }];
    }),
    [rows, shown, byId, search],
  );
  const foundHidden = useMemo(() => hidden.filter((site) => matches(site, search)), [hidden, search]);
  const rated = ask.kind === "rating";
  const level = mixLevelOf(settings.temperature);
  const mixLevel = MIX_LEVELS[level] as MixLevel;
  const problem = answer !== undefined && !answer.ok ? answer.problem : undefined;
  // The Look screen adds the count to the name
  const named = answer?.ok === true && answer.query !== "" ? `Sites of ${answer.query}` : "Sites of the viewer";
  const list: SiteList = { ids: listed.map((each) => each.site.id), name: search.trim() === "" ? named : `${named}, found by "${search.trim()}"` };

  if (view.sites.length === 0) {
    return (
      <main className="sites">
        <section className="empty">
          <h1>No sites yet</h1>
          <p>Import your Chrome bookmarks to start. You choose the folders, and the folders do not become tags.</p>
          <button type="button" className="primary" onClick={startImport}>
            Import Chrome bookmarks
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="sites">
      <div className="viewer-bar">
        <label className="field query">
          <span>Tags</span>
          <input
            type="text"
            placeholder="All sites. For example: news and not later"
            aria-label="Filter by tags"
            aria-invalid={problem !== undefined}
            aria-describedby="query-help"
            spellCheck={false}
            value={settings.query}
            onChange={(event) => setSettings({ ...settings, query: event.target.value })}
          />
        </label>
        <label className="field order">
          <span>Order</span>
          <select aria-label="Order of the sites" value={order} onChange={(event) => setSettings({ ...settings, order: event.target.value })}>
            {orderChoices(view.tags).map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.name}
              </option>
            ))}
          </select>
        </label>
        <input className="search" type="search" placeholder="Find by title or address" aria-label="Find a site" value={search} onChange={(event) => setSearch(event.target.value)} />
      </div>
      <p id="query-help" className={problem === undefined ? "help" : "problem"} role={problem === undefined ? undefined : "alert"}>
        {problem === undefined
          ? "Use tag names with and, or, not and brackets. Put a name with a space in quotes."
          : `${problem.message}${problem.end > problem.start ? ` (at "${settings.query.slice(problem.start, problem.end)}")` : ""}`}
      </p>
      {failure !== undefined && (
        <p className="problem" role="alert">
          The viewer could not get the sites. {failure}
        </p>
      )}
      {order === "mean" && (
        <div className="mean-tags" role="group" aria-label="Tags of the mean">
          {view.tags.length === 0 && <span className="help">There are no tags yet.</span>}
          {[...view.tags]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((tag) => (
              <button
                type="button"
                key={tag.id}
                className="tag-toggle"
                aria-pressed={mean.includes(tag.id)}
                onClick={() => setSettings({ ...settings, mean: mean.includes(tag.id) ? mean.filter((each) => each !== tag.id) : [...mean, tag.id] })}
              >
                <Swatch color={tag.color} />
                {tag.name}
              </button>
            ))}
          {mean.length === 0 && view.tags.length > 0 && <span className="help">Choose the tags of the mean. Until then, the order is by title.</span>}
        </div>
      )}

      {rated && (
        <div className="mix" role="group" aria-label="Mix of the order">
          <label className="mix-level">
            <span>Mix</span>
            <input
              type="range"
              min={0}
              max={MIX_LEVELS.length - 1}
              step={1}
              aria-label="Mix"
              aria-valuetext={mixLevel.name}
              aria-describedby="mix-help"
              value={level}
              onChange={(event) => setSettings({ ...settings, temperature: (MIX_LEVELS[Number(event.target.value)] as MixLevel).temperature })}
            />
            <output>{mixLevel.name}</output>
          </label>
          <span id="mix-help" className="help">
            {mixLevel.hint}
          </span>
          {settings.temperature > 0 && (
            <button type="button" onClick={() => setSettings({ ...settings, seed: settings.seed + 1 })}>
              Shuffle again
            </button>
          )}
        </div>
      )}

      <div className="list-bar">
        {(hidden.length > 0 || which === "hidden") && (
          <div className="which" role="group" aria-label="Which sites">
            <button type="button" aria-pressed={which === "shown"} onClick={() => setWhich("shown")}>
              Shown <span className="count-of">{shown.length}</span>
            </button>
            <button type="button" aria-pressed={which === "hidden"} onClick={() => setWhich("hidden")}>
              Hidden <span className="count-of">{hidden.length}</span>
            </button>
          </div>
        )}
        {which === "shown" && <span className="listed">{listed.length === shown.length ? countOf(listed.length, "site") : `${listed.length} of ${countOf(shown.length, "site")}`}</span>}
        <span className="grow" />
        {which === "shown" && listed.length > 0 && (
          <button type="button" className="primary" onClick={() => look(list)}>
            Look at these one at a time
          </button>
        )}
      </div>

      {which === "hidden" && <HiddenSites sites={foundHidden} total={hidden.length} write={write} />}
      {which === "shown" && (
        <>
          <ol className="site-list" data-rated={rated}>
            {listed.map(({ row, site }) => (
              <li key={site.id}>
                <button type="button" onClick={() => look(list, site.id)}>
                  <span className="site-name">{nameOf(site)}</span>
                  <span className="site-url">{site.url}</span>
                  <span className="site-tags">
                    {site.tags.map((id) => (
                      <span className="tag" key={id} style={tags.get(id)?.color === undefined ? undefined : { borderColor: tags.get(id)?.color }}>
                        {tags.get(id)?.name ?? id}
                      </span>
                    ))}
                  </span>
                  {rated && (
                    <span className="site-score" data-none={row.score === undefined} title={row.score === undefined ? "This site has no rating in the ladders of the order." : `The mean of ${countOf(row.ladders, "ladder")}`}>
                      {row.score === undefined ? "No rating" : ratingText(row.score, row.se)}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ol>
          {shown.length === 0 && <p className="none">Each site is hidden. Choose Hidden to restore a site.</p>}
          {shown.length > 0 && listed.length === 0 && <p className="none">{settings.query.trim() === "" ? "No site agrees with this search." : "No site agrees with these tags and this search."}</p>}
        </>
      )}
    </main>
  );
}

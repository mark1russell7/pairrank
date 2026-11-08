/**
 * The list of the hidden sites, with a restore for each site. A hidden site is not in a run, a duel or the viewer. Its
 * past picks stay in the ratings, so a restore does not change a ladder.
 */
import type { SiteView } from "@pairrank/host/views";
import { type ReactElement, useState } from "react";
import { nameOf } from "./look-screen.tsx";
import type { Write } from "./tags.tsx";

/** The properties of the list of the hidden sites. */
export interface HiddenSitesProps {
  /** The hidden sites that agree with the search, in the order of the state. */
  readonly sites: readonly SiteView[];
  /** The count of all the hidden sites, with no search. */
  readonly total: number;
  readonly write: Write;
}

/** The list of the hidden sites. */
export function HiddenSites({ sites, total, write }: HiddenSitesProps): ReactElement {
  const [said, setSaid] = useState<string | undefined>(undefined);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState<string | undefined>(undefined);

  const restore = async (site: SiteView): Promise<void> => {
    setBusy(site.id);
    const found = await write([{ type: "site.restored", site: site.id }]);
    setBusy(undefined);
    setProblem(found);
    setSaid(found === undefined ? `${nameOf(site)} is back in the sites.` : undefined);
  };

  return (
    <section className="hidden-sites" aria-label="Hidden sites">
      <p className="hint">A hidden site is not in a run or a duel. Its past picks stay in the ratings.</p>
      <p className="said" role="status">
        {said}
      </p>
      {problem !== undefined && (
        <p className="problem" role="alert">
          {problem}
        </p>
      )}
      {total === 0 ? (
        <p className="none">No sites are hidden. The Hide button of the Look screen and of the duel hides a site.</p>
      ) : sites.length === 0 ? (
        <p className="none">No hidden site agrees with this search.</p>
      ) : (
        <ol className="site-list hidden-list">
          {sites.map((site) => (
            <li key={site.id}>
              <span className="site-name">{nameOf(site)}</span>
              <span className="site-url">{site.url}</span>
              <span className="hidden-reason">{site.hiddenReason ?? "No reason"}</span>
              <button type="button" aria-label={`Restore ${nameOf(site)}`} disabled={busy === site.id} onClick={() => void restore(site)}>
                Restore
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

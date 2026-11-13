/**
 * A slot of the window that shows one site. The interface lays out the slot with CSS. The slot gives its box to the
 * surface, so the view of the site follows the layout of the interface. A surface with no view gives a still picture
 * of the site, and the slot draws the picture.
 *
 * A bar above the slot shows the lock, the history, the tabs, a notice of the lock, and the button "Add this page". The view of the site covers the box of the slot, so the bar stays out of that box.
 */
import type { Rect } from "@mark1russell7/layout-contract";
import { isWebUrl } from "@pairrank/input";
import type { Blocked, BrowseState, FailReason, SlotAction, SlotId, SlotStatus, SlotTracker, Surface, TabView } from "@pairrank/surfaces";
import { type ReactElement, useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Addition, PageList } from "./page-list.ts";

/** This function gives the box of an element in the window, in CSS pixels. */
export function boxOf(rect: { readonly left: number; readonly top: number; readonly width: number; readonly height: number }): Rect {
  return { x: rect.left, y: rect.top, w: rect.width, h: rect.height };
}

/** This function tells if the view of the site is on top of the slot. A slot with no page or a failure shows its text. */
export function showsView(status: SlotStatus): boolean {
  return status.state === "loading" || status.state === "shown";
}

/** This function gives the pages of a slot that loads or shows a live site, or `undefined`. A still picture has no pages. */
export function browseOf(status: SlotStatus): BrowseState | undefined {
  if (status.state === "loading" || (status.state === "shown" && status.picture === undefined)) return status.browse;
  return undefined;
}

/** This function gives the open tab of the pages of a slot. */
export function activeTab(browse: BrowseState): TabView | undefined {
  return browse.tabs.find((tab) => tab.id === browse.active);
}

/** This function gives an address with no scheme and no last slash, for a narrow place. */
export function shortUrl(url: string): string {
  return url.replace(/^https?:\/\//i, "").replace(/\/$/, "");
}

/** This function gives the name of a tab: its title, or its short address. */
export function tabName(tab: TabView): string {
  const title = tab.title?.trim();
  return title !== undefined && title !== "" ? title : shortUrl(tab.url) || "New tab";
}

/** The text of each failure, for the person that looks at the slot. */
export const FAILURE_TEXT: Readonly<Record<FailReason, string>> = {
  refused: "The site refused to show here.",
  network: "The site did not answer. Examine the address and the network.",
  timeout: "The site did not show a page in the time limit.",
  crashed: "The page of the site stopped.",
  "not-web": "This address is not a web address, so the app does not open it.",
};

/** The time that a notice of the lock stays, in milliseconds. A pointer or the focus on the notice keeps it. */
export const NOTICE_MS = 8000;

/** A notice of the lock: its text, and the action that it offers. */
export interface Notice {
  readonly text: string;
  /** The label of the button, and the actions of the button in their order. */
  readonly action?: { readonly label: string; readonly actions: readonly SlotAction[] };
}

/**
 * This function gives the notice of a stop. A locked slot offers an unlock, and the address of the stop when the
 * adapter knows it. An unlocked slot stops a window only at its limit of tabs.
 */
export function noticeOf(blocked: Blocked, browse: BrowseState): Notice {
  const unlock: SlotAction = { type: "lock", locked: false };
  if (!browse.locked) return { text: "The slot has too many tabs. Close a tab to open a new one." };
  const where = blocked.url === undefined ? "" : `: ${shortUrl(blocked.url)}`;
  if (blocked.kind === "window") {
    const text = `The lock stopped a new window${where}`;
    if (blocked.url === undefined || !browse.pages) return { text, action: { label: "Unlock", actions: [unlock] } };
    return { text, action: { label: "Unlock and open", actions: [unlock, { type: "open", url: blocked.url, where: "tab" }] } };
  }
  const text = `The lock kept the site on its page${where}`;
  if (blocked.url === undefined || !browse.pages) return { text, action: { label: "Unlock", actions: [unlock] } };
  return { text, action: { label: "Unlock and go", actions: [unlock, { type: "open", url: blocked.url, where: "here" }] } };
}

/** This hook gives the status of a slot, and changes when the status changes. */
export function useSlotStatus(tracker: SlotTracker, slot: SlotId): SlotStatus {
  const subscribe = useCallback(
    (changed: () => void) => tracker.subscribe((which) => {
      if (which === slot) changed();
    }),
    [tracker, slot],
  );
  return useSyncExternalStore(subscribe, () => tracker.status(slot));
}

/** The properties of a slot. */
export interface SlotProps {
  readonly surface: Surface;
  readonly tracker: SlotTracker;
  readonly slot: SlotId;
  /** The address of the site, or `undefined` for an empty slot. */
  readonly url: string | undefined;
  /** The text of the slot with no site. */
  readonly empty?: string;
  /** The list of the sites. With no list, the bar has no button "Add this page". */
  readonly pages?: PageList | undefined;
}

/** A slot of the window that shows one site, with the bar of its pages. */
export function Slot({ surface, tracker, slot, url, empty = "No site.", pages }: SlotProps): ReactElement {
  const element = useRef<HTMLDivElement>(null);
  const status = useSlotStatus(tracker, slot);
  const visible = showsView(status);

  useEffect(() => {
    if (url === undefined) surface.clear(slot);
    else surface.show(slot, url);
  }, [surface, slot, url]);

  useEffect(() => () => surface.clear(slot), [surface, slot]);

  useLayoutEffect(() => {
    const node = element.current;
    if (node === null) return;
    if (!visible) {
      surface.place(slot, undefined);
      return;
    }
    const place = (): void => surface.place(slot, boxOf(node.getBoundingClientRect()));
    place();
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(place);
    observer?.observe(node);
    window.addEventListener("resize", place);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", place);
      surface.place(slot, undefined);
    };
  }, [surface, slot, visible]);

  return (
    <div className="slot-frame">
      <SlotBar surface={surface} slot={slot} status={status} pages={pages} />
      <div className="slot" ref={element} data-state={status.state} aria-busy={status.state === "loading"}>
        {status.state === "empty" && <p className="slot-text">{empty}</p>}
        {status.state === "loading" && <p className="slot-text">The site loads.</p>}
        {status.state === "shown" && status.picture !== undefined && (
          <figure className="slot-picture">
            <img src={status.picture} alt={`A still picture of ${status.title ?? status.url}`} />
            <figcaption>A still picture. The live page did not show here.</figcaption>
          </figure>
        )}
        {status.state === "failed" && (
          <div className="slot-text" role="alert">
            <p>{FAILURE_TEXT[status.reason]}</p>
            <p className="slot-url">{status.url}</p>
          </div>
        )}
      </div>
    </div>
  );
}

/** The properties of the bar of a slot. */
interface BarProps {
  readonly surface: Surface;
  readonly slot: SlotId;
  readonly status: SlotStatus;
  readonly pages: PageList | undefined;
}

/**
 * The bar of a slot. It has a fixed height, so the box of the site does not move when its contents change. It is empty
 * until the adapter sends the pages of the load.
 */
function SlotBar({ surface, slot, status, pages }: BarProps): ReactElement {
  const browse = browseOf(status);
  const blocked = browse === undefined || status.state === "empty" || status.state === "failed" ? undefined : status.blocked;
  const [dismissed, setDismissed] = useState<Blocked | undefined>(undefined);
  const [held, setHeld] = useState<Blocked | undefined>(undefined);
  const shown = blocked !== undefined && blocked !== dismissed ? blocked : undefined;
  const holding = shown !== undefined && held === shown;

  useEffect(() => {
    if (shown === undefined || holding) return;
    const timer = setTimeout(() => setDismissed(shown), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [shown, holding]);

  if (browse === undefined) return <div className="slot-bar" />;
  const act = (action: SlotAction): void => surface.act(slot, action);
  const page = activeTab(browse);
  const notice = shown === undefined ? undefined : noticeOf(shown, browse);

  return (
    <div className="slot-bar" role="group" aria-label="The pages of the site" data-locked={browse.locked}>
      <button
        type="button"
        role="switch"
        className="lock"
        aria-checked={browse.locked}
        title={browse.locked ? "The site stays on its page. Unlock it to let it open other pages and tabs." : "The site can open other pages and tabs. Lock it to keep it on its page."}
        onClick={() => act({ type: "lock", locked: !browse.locked })}
      >
        <LockGlyph open={!browse.locked} />
        <span>{browse.locked ? "Locked" : "Unlocked"}</span>
      </button>
      {browse.pages && (
        <span className="slot-history">
          <button type="button" aria-label="Back" title="Back" disabled={!browse.back} onClick={() => act({ type: "back" })}>
            ‹
          </button>
          <button type="button" aria-label="Forward" title="Forward" disabled={!browse.forward} onClick={() => act({ type: "forward" })}>
            ›
          </button>
        </span>
      )}
      <div className="slot-pages">
        {notice !== undefined && shown !== undefined ? (
          <div
            className="slot-notice"
            role="status"
            onPointerEnter={() => setHeld(shown)}
            onPointerLeave={() => setHeld(undefined)}
            onFocus={() => setHeld(shown)}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setHeld(undefined);
            }}
          >
            <span className="slot-notice-text" title={shown.url}>
              {notice.text}
            </span>
            {notice.action !== undefined && (
              <button type="button" onClick={() => notice.action?.actions.forEach(act)}>
                {notice.action.label}
              </button>
            )}
            <button type="button" className="slot-close" aria-label="Close the notice" onClick={() => setDismissed(shown)}>
              ×
            </button>
          </div>
        ) : browse.tabs.length > 1 ? (
          <div className="slot-tabs" role="group" aria-label="Tabs">
            {browse.tabs.map((tab) => (
              <span key={tab.id} className="slot-tab" data-active={tab.id === browse.active} data-loading={tab.loading}>
                <button type="button" aria-pressed={tab.id === browse.active} title={tab.url} onClick={() => act({ type: "select", tab: tab.id })}>
                  {tabName(tab)}
                </button>
                {tab.id !== 0 && (
                  <button type="button" className="slot-close" aria-label={`Close the tab ${tabName(tab)}`} onClick={() => act({ type: "close", tab: tab.id })}>
                    ×
                  </button>
                )}
              </span>
            ))}
          </div>
        ) : (
          page !== undefined && (
            <span className="slot-address" title={page.url} data-loading={page.loading}>
              {shortUrl(page.url)}
            </span>
          )
        )}
      </div>
      <button type="button" className="slot-home" title="Show the site again, at its address in the list" onClick={() => act({ type: "home" })}>
        Return to the site
      </button>
      {browse.pages && pages !== undefined && page !== undefined && <AddPage pages={pages} page={page} />}
    </div>
  );
}

/** The state of the button "Add this page" for one address. */
type AddState =
  | { readonly url: string; readonly state: "checking" | "absent" | "present" | "adding" }
  | { readonly url: string; readonly state: "done"; readonly addition: Addition }
  | { readonly url: string; readonly state: "failed"; readonly problem: string };

/** The button "Add this page": it adds the page of the open tab to the list, with its title and no tags. */
function AddPage({ pages, page }: { readonly pages: PageList; readonly page: TabView }): ReactElement {
  const [add, setAdd] = useState<AddState | undefined>(undefined);
  const url = page.url;
  const web = isWebUrl(url);

  useEffect(() => {
    if (!web) return;
    let live = true;
    setAdd({ url, state: "checking" });
    pages.has(url).then(
      (has) => {
        if (live) setAdd((now) => (now?.url === url && now.state === "checking" ? { url, state: has ? "present" : "absent" } : now));
      },
      () => {
        if (live) setAdd((now) => (now?.url === url && now.state === "checking" ? { url, state: "absent" } : now));
      },
    );
    return () => {
      live = false;
    };
  }, [pages, url, web]);

  const now = add?.url === url ? add : undefined;
  const start = (): void => {
    setAdd({ url, state: "adding" });
    pages.add(url, page.title).then(
      (addition) => setAdd((was) => (was?.url === url ? { url, state: "done", addition } : was)),
      (failure: unknown) => setAdd((was) => (was?.url === url ? { url, state: "failed", problem: failure instanceof Error ? failure.message : String(failure) } : was)),
    );
  };

  if (now?.state === "present" || (now?.state === "done" && now.addition === "existing")) {
    return (
      <button type="button" className="slot-add" disabled title={url}>
        In the list
      </button>
    );
  }
  if (now?.state === "done") {
    return (
      <button type="button" className="slot-add" data-added="true" disabled title={url}>
        Added
      </button>
    );
  }
  return (
    <>
      {now?.state === "failed" && (
        <span className="slot-problem" role="alert" title={now.problem}>
          Not added
        </span>
      )}
      <button type="button" className="slot-add" disabled={!web || now?.state === "adding"} title={web ? `Add ${url} to the list` : "This page is not a web page"} onClick={start}>
        {now?.state === "adding" ? "Adding" : "Add this page"}
      </button>
    </>
  );
}

/** A lock, closed or open. */
function LockGlyph({ open }: { readonly open: boolean }): ReactElement {
  return (
    <svg className="lock-glyph" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
      <rect x="2.75" y="7.25" width="10.5" height="7" rx="1.25" />
      <path d={open ? "M5 7.25V5a3 3 0 0 1 5.85-.95" : "M5 7.25V5a3 3 0 0 1 6 0v2.25"} />
    </svg>
  );
}

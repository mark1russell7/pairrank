/**
 * A slot of the window that shows one site. The interface lays out the slot with CSS. The slot gives its box to the
 * surface, so the view of the site follows the layout of the interface. A surface with no view gives a still picture
 * of the site, and the slot draws the picture.
 */
import type { Rect } from "@mark1russell7/layout-contract";
import type { FailReason, SlotId, SlotStatus, SlotTracker, Surface } from "@pairrank/surfaces";
import { type ReactElement, useCallback, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";

/** This function gives the box of an element in the window, in CSS pixels. */
export function boxOf(rect: { readonly left: number; readonly top: number; readonly width: number; readonly height: number }): Rect {
  return { x: rect.left, y: rect.top, w: rect.width, h: rect.height };
}

/** This function tells if the view of the site is on top of the slot. A slot with no page or a failure shows its text. */
export function showsView(status: SlotStatus): boolean {
  return status.state === "loading" || status.state === "shown";
}

/** The text of each failure, for the person that looks at the slot. */
export const FAILURE_TEXT: Readonly<Record<FailReason, string>> = {
  refused: "The site refused to show here.",
  network: "The site did not answer. Examine the address and the network.",
  timeout: "The site did not show a page in the time limit.",
  crashed: "The page of the site stopped.",
  "not-web": "This address is not a web address, so the app does not open it.",
};

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
}

/** A slot of the window that shows one site. */
export function Slot({ surface, tracker, slot, url, empty = "No site." }: SlotProps): ReactElement {
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
  );
}

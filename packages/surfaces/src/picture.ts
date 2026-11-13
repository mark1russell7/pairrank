/**
 * A surface of still pictures. It shows a site as a picture from a capture function, for a host that cannot show a
 * live view of the site. The surface has no view of its own: its `shown` event has the picture, and the page draws it.
 */
import { type FailReason, type LoadId, type SlotId, type Surface, type SurfaceEvent, type SurfaceListener, refusalOf } from "./surface.ts";

/** The size of the window of a capture, in CSS pixels. */
export interface PictureSize {
  readonly w: number;
  readonly h: number;
}

/** The result of a capture: a picture, or the reason of a failure. */
export type CaptureResult =
  | {
      readonly ok: true;
      /** The picture, as a `data:` address of a PNG or JPEG image. */
      readonly picture: string;
      /** The address of the page after its redirects. */
      readonly url?: string;
      readonly title?: string;
    }
  | { readonly ok: false; readonly reason: FailReason; readonly detail?: string };

/** A function that loads a site in a window of the given size, and gives a picture of the window. */
export type Capture = (url: string, size: PictureSize) => Promise<CaptureResult>;

/** The size of the window of a capture: a common size of a desktop screen. The page scales the picture to the slot. */
export const PICTURE_SIZE: PictureSize = { w: 1280, h: 800 };

/** The start of each valid picture. The page shows only a PNG or JPEG image, and its content security policy permits `data:` images. */
const PICTURE_START = /^data:image\/(png|jpeg);base64,/;

/** This function tells if a text is a valid picture: a `data:` address of a PNG or JPEG image. */
export function isPicture(text: string): boolean {
  return PICTURE_START.test(text);
}

/** The options of `pictureSurface`. */
export interface PictureOptions {
  /** The size of the window of a capture. The default is `PICTURE_SIZE`. */
  readonly size?: PictureSize;
  readonly kind?: string;
}

/**
 * This function makes a surface of still pictures. `show` sends `loading`, starts a capture, and sends `shown` with the
 * picture or `failed`. The result of a capture of an earlier load, or after a clear, changes nothing. `place` does
 * nothing, because the page draws the picture in its slot.
 */
export function pictureSurface(capture: Capture, { size = PICTURE_SIZE, kind = "picture" }: PictureOptions = {}): Surface {
  const listeners = new Set<SurfaceListener>();
  const counts = new Map<SlotId, LoadId>();
  /** The open capture of each slot, by its load. */
  const open = new Map<SlotId, LoadId>();
  let gone = false;
  const emit = (event: SurfaceEvent): void => {
    if (gone) return;
    for (const listener of [...listeners]) listener(event);
  };
  const end = (slot: SlotId, load: LoadId, event: SurfaceEvent): void => {
    if (open.get(slot) !== load) return;
    open.delete(slot);
    emit(event);
  };
  return {
    kind,
    show(slot, url) {
      const load = (counts.get(slot) ?? 0) + 1;
      counts.set(slot, load);
      if (gone) return load;
      const reason = refusalOf(url);
      if (reason !== undefined) {
        open.delete(slot);
        emit({ type: "failed", slot, load, url, reason });
        return load;
      }
      open.set(slot, load);
      emit({ type: "loading", slot, load, url });
      capture(url, size).then(
        (result) => {
          if (!result.ok) end(slot, load, { type: "failed", slot, load, url, reason: result.reason, ...(result.detail === undefined ? {} : { detail: result.detail }) });
          else if (!isPicture(result.picture)) end(slot, load, { type: "failed", slot, load, url, reason: "network", detail: "The capture gave no PNG or JPEG picture." });
          else end(slot, load, { type: "shown", slot, load, url: result.url ?? url, picture: result.picture, ...(result.title === undefined ? {} : { title: result.title }) });
        },
        (error: unknown) => end(slot, load, { type: "failed", slot, load, url, reason: "network", detail: error instanceof Error ? error.message : String(error) }),
      );
      return load;
    },
    place() {},
    // A still picture has no pages, so an action changes nothing
    act() {},
    clear(slot) {
      open.delete(slot);
      emit({ type: "cleared", slot, load: counts.get(slot) ?? 0 });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      gone = true;
      listeners.clear();
      open.clear();
    },
  };
}

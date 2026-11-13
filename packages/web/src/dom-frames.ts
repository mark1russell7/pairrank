/**
 * The frames of the page of the browser host: `MakeFrame` of `iframeSurface` on DOM elements.
 */
/// <reference lib="dom" />
import type { MakeFrame } from "@pairrank/surfaces";

/**
 * The sandbox of each locked frame. A site can start its scripts and send its forms. It cannot open windows, and it
 * cannot change the address of the page of the app.
 */
export const FRAME_SANDBOX = ["allow-scripts", "allow-same-origin", "allow-forms"] as const;

/** The tokens that an unlock adds to the sandbox: the site can open windows, as tabs of the browser. */
export const UNLOCKED_SANDBOX = ["allow-popups", "allow-popups-to-escape-sandbox"] as const;

/**
 * This function makes the frames of a page, in a container element. Each frame has a fixed position, so its box is a
 * box of the window. A frame sends no referrer, and has no permissions. A site of the origin of the page gets no
 * `allow-same-origin`, because with it the site can remove the sandbox.
 */
export function domFrames(container: HTMLElement): MakeFrame {
  const document = container.ownerDocument;
  const pageOrigin = document.defaultView?.location.origin;
  return (url, loaded) => {
    const frame = document.createElement("iframe");
    const sameOrigin = pageOrigin !== undefined && new URL(url).origin === pageOrigin;
    const sandbox = (locked: boolean): string =>
      [...FRAME_SANDBOX, ...(locked ? [] : UNLOCKED_SANDBOX)].filter((token) => !(sameOrigin && token === "allow-same-origin")).join(" ");
    frame.setAttribute("sandbox", sandbox(true));
    frame.setAttribute("referrerpolicy", "no-referrer");
    frame.setAttribute("allow", "");
    frame.setAttribute("loading", "eager");
    frame.setAttribute("title", "The site");
    Object.assign(frame.style, { position: "fixed", border: "0", margin: "0", padding: "0", display: "none" });
    frame.addEventListener("load", loaded);
    // The address comes before the frame goes in the page, so the frame does not load `about:blank` first
    frame.src = url;
    container.append(frame);
    return {
      place(box) {
        if (box === undefined) {
          frame.style.display = "none";
          return;
        }
        Object.assign(frame.style, { display: "block", left: `${box.x}px`, top: `${box.y}px`, width: `${box.w}px`, height: `${box.h}px` });
      },
      lock(locked) {
        frame.setAttribute("sandbox", sandbox(locked));
      },
      reload() {
        frame.src = url;
      },
      remove() {
        frame.removeEventListener("load", loaded);
        frame.remove();
      },
    };
  };
}

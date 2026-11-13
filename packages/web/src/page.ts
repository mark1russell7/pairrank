/**
 * This file is the script of the page of @pairrank/web. `tsdown` builds it to `build/page/page.js`. It sends the calls
 * of `@pairrank/ui` to the host over HTTP, and shows each site in an iframe. Before each load, the host checks if the
 * site refuses the frame. A site that refuses the frame shows as a still picture from the host.
 */
/// <reference lib="dom" />
import { errorMessage } from "@mark1russell7/text";
import { type FrameCheckResult, iframeSurface, pictureSurface, withFallback, withLoadTimeout } from "@pairrank/surfaces";
import { type Call, apiOf, bookmarksApiOf, captureApiOf, mount } from "@pairrank/ui";
import { Client, HttpTransport, pathToMethod } from "@procedures/client/browser";
import { API_PATH, LOAD_TIMEOUT_MS } from "./constants.ts";
import { domFrames } from "./dom-frames.ts";

const client = new Client(new HttpTransport({ baseUrl: `${window.location.origin}${API_PATH}` }));
const call: Call = <T>(path: string[], input: unknown) => client.call<unknown, T>(pathToMethod(path), input);

/** This function asks the host if a site refuses the frame. A failed call is a fault of the network, not a refusal. */
async function check(url: string): Promise<FrameCheckResult> {
  try {
    return await call<FrameCheckResult>(["frames", "check"], { url });
  } catch (error) {
    return { ok: false, reason: "network", detail: errorMessage(error) };
  }
}

// The frames are in a container of their own, after the root of the interface. Each frame takes the box of its slot.
const frames = document.createElement("div");
document.body.append(frames);
const live = withLoadTimeout(iframeSurface({ check, frames: domFrames(frames) }), { ms: LOAD_TIMEOUT_MS });
// A site that refuses the frame shows as a still picture. A host without a capture fails the picture, and then the slot
// gets the refusal, with the two details. A slow site is not a reason.
const surface = withFallback(live, pictureSurface(captureApiOf(call)), ["refused"]);

const root = document.getElementById("root");
if (root !== null) mount(root, { api: apiOf(call), bookmarks: bookmarksApiOf(call), surface });

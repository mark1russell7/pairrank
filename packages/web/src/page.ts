/**
 * This file is the script of the page of @pairrank/web. `tsdown` builds it to `build/page/page.js`. It sends the calls
 * of `@pairrank/ui` to the host over HTTP, and shows each site in an iframe. Before each load, the host checks if the
 * site refuses the frame.
 */
/// <reference lib="dom" />
import { type FrameCheckResult, iframeSurface, withLoadTimeout } from "@pairrank/surfaces";
import { type Call, apiOf, bookmarksApiOf, mount } from "@pairrank/ui";
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
    return { ok: false, reason: "network", detail: error instanceof Error ? error.message : String(error) };
  }
}

// The frames are in a container of their own, after the root of the interface. Each frame takes the box of its slot.
const frames = document.createElement("div");
document.body.append(frames);
const timers = { set: (callback: () => void, ms: number) => window.setTimeout(callback, ms), clear: (handle: unknown) => window.clearTimeout(handle as number) };
const surface = withLoadTimeout(iframeSurface({ check, frames: domFrames(frames) }), { ms: LOAD_TIMEOUT_MS, timers });

const root = document.getElementById("root");
if (root !== null) mount(root, { api: apiOf(call), bookmarks: bookmarksApiOf(call), surface });

/**
 * This file is the script of the page of @pairrank/desktop. `tsdown` builds it to `build/page/page.js`. It waits for the
 * two message ports of the main process, and then shows the interface of `@pairrank/ui` on them.
 */
/// <reference lib="dom" />
import { type SurfaceEvent, remoteSurface, withLoadTimeout } from "@pairrank/surfaces";
import { type Call, apiOf, bookmarksApiOf, mount } from "@pairrank/ui";
import { Client, PortTransport, pathToMethod } from "@procedures/client/browser";
import { LOAD_TIMEOUT_MS } from "./constants.ts";

window.addEventListener("message", function onPorts(event: MessageEvent<unknown>) {
  const data = event.data as { type?: unknown } | null;
  if (event.source !== window || event.origin !== window.location.origin || data?.type !== "ports") return;
  const [procedures, surfacePort] = event.ports;
  if (procedures === undefined || surfacePort === undefined) return;
  window.removeEventListener("message", onPorts);

  const client = new Client(new PortTransport(procedures));
  const call: Call = <T>(path: string[], input: unknown) => client.call<unknown, T>(pathToMethod(path), input);

  const remote = remoteSurface((command) => surfacePort.postMessage(command), "electron");
  surfacePort.onmessage = (message: MessageEvent<SurfaceEvent>) => remote.receive(message.data);
  const timers = { set: (callback: () => void, ms: number) => window.setTimeout(callback, ms), clear: (handle: unknown) => window.clearTimeout(handle as number) };
  const surface = withLoadTimeout(remote.surface, { ms: LOAD_TIMEOUT_MS, timers });

  const root = document.getElementById("root");
  if (root !== null) mount(root, { api: apiOf(call), bookmarks: bookmarksApiOf(call), surface });
});

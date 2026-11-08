/**
 * This file is the preload script of @pairrank/desktop. `tsdown` builds it to `build/preload/preload.cjs`, because a preload
 * script in a sandbox must be CommonJS. It gives the page no Electron API: it gives the page only the two message ports
 * of the main process. The first port carries the procedures, and the second port carries the surface.
 */
/// <reference lib="dom" />
import { ipcRenderer } from "electron";

// A reload of the page also starts this script again, so each load of the page gets its ports one time
ipcRenderer.once("ports", (event) => {
  // The target is the origin of the page, so no frame of another origin gets the ports
  window.postMessage({ type: "ports" }, window.location.origin, event.ports);
});

/**
 * This file is the entry of the browser host, and the only file that starts it. `pnpm start` builds the page and
 * starts this file. Open the address that the host prints in a browser.
 *
 * - The environment variable `PORT` gives the port. The default is 4800.
 * - The environment variable `PAIRRANK_STORE` gives the file of the log of events. The default is `pairrank.sqlite`
 *   in the folder `.pairrank` of the home folder.
 * - A site that refuses a frame shows as a still picture. A headless browser of the system takes it (`renderScreenshot`
 *   of `@procedures/browser`). With no browser, the slot tells the failure of the capture.
 * - After SIGTERM or Ctrl-C, the host stops in its phases. The captures stop, and the log closes after the last call.
 */
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MAX_CAPTURES, capturePool } from "@pairrank/host/pictures";
import { openStore } from "@pairrank/store";
import { renderScreenshot } from "@procedures/browser";
import { runProcedureHost } from "@procedures/server";
import { LOAD_TIMEOUT_MS } from "./constants.ts";
import { headlessCapture } from "./headless.ts";
import { DEFAULT_PORT, STORE_FILE, webHost } from "./index.ts";

/** This function gives the port from the environment, or the default port when the variable is not set. */
function portOf(text: string | undefined): number {
  const value = text === undefined ? DEFAULT_PORT : Number(text);
  if (!Number.isInteger(value) || value < 0 || value > 65535) throw new Error(`PORT is not a port: ${text}`);
  return value;
}

const file = process.env["PAIRRANK_STORE"] ?? join(homedir(), ".pairrank", STORE_FILE);
mkdirSync(dirname(file), { recursive: true });
const store = openStore(file);
const page = join(dirname(fileURLToPath(import.meta.url)), "..", "build", "page");
const pictures = capturePool(headlessCapture({ render: renderScreenshot, timeoutMs: LOAD_TIMEOUT_MS }), MAX_CAPTURES);

const running = await runProcedureHost({
  name: "pairrank-web",
  host: webHost({ store, page, port: portOf(process.env["PORT"]), pictures }),
  mode: "foreground",
  log: (line) => console.log(line),
  // The log and the captures are dependencies of the service. They stop in the last stage, after the transports.
  declare: (svc) => {
    svc.dependency("pictures", { system: null, knobs: {}, operations: {} }, { connect: async () => {}, close: async () => pictures.stop() });
    svc.dependency("store", { system: null, knobs: {}, operations: {} }, { connect: async () => {}, close: async () => store.close() });
  },
});
for (const endpoint of running.host.info.endpoints()) {
  if (endpoint.type === "static") console.log(`pairrank: open ${endpoint.address}`);
}

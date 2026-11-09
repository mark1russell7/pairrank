/**
 * This file is the entry of the browser host, and the only file that starts it. `pnpm start` builds the page and
 * starts this file. Open the address that the host prints in a browser.
 *
 * - The environment variable `PORT` gives the port. The default is 4800.
 * - The environment variable `PAIRRANK_STORE` gives the file of the log of events. The default is `pairrank.sqlite`
 *   in the folder `.pairrank` of the home folder.
 * - After SIGTERM or Ctrl-C, the host stops in its phases. The log closes after the last call.
 */
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openStore } from "@pairrank/store";
import { runProcedureHost } from "@procedures/server";
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

const running = await runProcedureHost({
  name: "pairrank-web",
  host: webHost({ store, page, port: portOf(process.env["PORT"]) }),
  mode: "foreground",
  log: (line) => console.log(line),
  // The log is a dependency of the service. It closes in the last stage of the stop, after the transports.
  declare: (svc) => {
    svc.dependency("store", { system: null, knobs: {}, operations: {} }, { connect: async () => {}, close: async () => store.close() });
  },
});
for (const endpoint of running.host.info.endpoints()) {
  if (endpoint.type === "static") console.log(`pairrank: open ${endpoint.address}`);
}

/**
 * The files of the log of events on the disk, for `moveOldLog` of `data.ts`.
 *
 * The snapshot uses `VACUUM INTO` of SQLite on a read-only connection. A plain copy of the file can miss the writes that
 * are still in the WAL file. `VACUUM INTO` writes a consistent copy with those writes, and the old file does not change.
 */
import { existsSync, renameSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { LogFiles } from "./data.ts";

/** This object gives the operations of `LogFiles` on the disk. */
export const diskLogFiles: LogFiles = {
  exists: (path) => existsSync(path),
  remove: (path) => rmSync(path, { force: true }),
  snapshot(from, to) {
    const db = new DatabaseSync(from, { readOnly: true });
    try {
      db.prepare("VACUUM INTO ?").run(to);
    } finally {
      db.close();
    }
  },
  rename: (from, to) => renameSync(from, to),
};

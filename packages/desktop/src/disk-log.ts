/**
 * The files of the log of events on the disk, for `moveOldLog` of `data.ts`.
 *
 * The snapshot uses `snapshot` of `@mark1russell7/sqlite` on a read-only connection of `openDatabase`. A plain copy of
 * the file can miss the writes that are still in the WAL file. `snapshot` writes a consistent copy with those writes
 * through `VACUUM INTO`, flushes the copy to the disk, and the old file does not change.
 */
import { existsSync, renameSync, rmSync } from "node:fs";
import { openDatabase, snapshot as snapshotDatabase } from "@mark1russell7/sqlite";
import type { LogFiles } from "./data.ts";

/** This object gives the operations of `LogFiles` on the disk. */
export const diskLogFiles: LogFiles = {
  exists: (path) => existsSync(path),
  remove: (path) => rmSync(path, { force: true }),
  snapshot(from, to) {
    const db = openDatabase(from, { readOnly: true });
    try {
      snapshotDatabase(db, to);
    } finally {
      db.close();
    }
  },
  rename: (from, to) => renameSync(from, to),
};

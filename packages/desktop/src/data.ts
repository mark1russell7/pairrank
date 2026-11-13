/**
 * The folder of the data of the desktop app, and the one-time move of the log of events into that folder. The functions
 * are pure: the file system and the paths are parameters. Thus a test examines them with temporary folders.
 *
 * Electron names the folder of the user data after the app. A development run (`electron build/main/main.js`) has the
 * name "Electron", and the installed app has the name "pairrank". Thus the main process sets one folder for each run
 * mode, and moves the log of an earlier development run into it once.
 */
import { join } from "node:path";

/** The name of the file of the log of events, in the folder of the data of the app. */
export const STORE_FILE = "pairrank.sqlite";

/** The name of the folder of the data of the app, in the folder `appData` of the system (`%APPDATA%` on Windows). */
export const DATA_FOLDER = "pairrank";

/** The name of the folder of the data of a development run of an earlier version. Electron gave the run its own name. */
export const OLD_DATA_FOLDER = "Electron";

/** This function gives the folder of the data of the app. The installed app and a development run use the same folder. */
export function dataFolderOf(appData: string): string {
  return join(appData, DATA_FOLDER);
}

/** The place of the log of events of a run. */
export type LogPlace =
  /** A smoke run uses a log in memory, and moves no file. */
  | { readonly kind: "memory" }
  /** The variable `PAIRRANK_STORE` gives the file of the log. The app moves no file. */
  | { readonly kind: "chosen"; readonly file: string }
  /** The log is in the folder of the data. The log of an earlier development run (`old`) moves to it once. */
  | { readonly kind: "data"; readonly file: string; readonly old: string };

/** This function gives the place of the log. An empty `PAIRRANK_STORE` is the same as no variable. */
export function logPlaceOf(smoke: boolean, env: Readonly<Record<string, string | undefined>>, appData: string): LogPlace {
  if (smoke) return { kind: "memory" };
  const chosen = env["PAIRRANK_STORE"];
  if (chosen !== undefined && chosen !== "") return { kind: "chosen", file: chosen };
  return { kind: "data", file: join(dataFolderOf(appData), STORE_FILE), old: join(appData, OLD_DATA_FOLDER, STORE_FILE) };
}

/** The part of the file system that `moveOldLog` uses. */
export interface LogFiles {
  /** This function tells if a file is there. */
  exists(path: string): boolean;
  /** This function removes a file. A file that is not there is not an error. */
  remove(path: string): void;
  /**
   * This function writes a consistent copy of an SQLite file to a new file. The copy includes the writes that are still
   * in the WAL file. The old file does not change.
   */
  snapshot(from: string, to: string): void;
  /** This function gives a file a new name. No file has the new name. */
  rename(from: string, to: string): void;
}

/** The result of `moveOldLog`. */
export type LogMove = { readonly moved: true } | { readonly moved: false; readonly reason: "the log is there" | "no old log" };

/** The suffixes of the side files of an SQLite file: the WAL file, its index and the journal of a rollback. */
export const SIDE_FILES: readonly string[] = ["-wal", "-shm", "-journal"];

/**
 * This function copies the log of an earlier development run into the folder of the data, before the store opens the
 * log. It does nothing when the log is there, or when the old log is not there. The old log stays.
 *
 * - The copy goes to a temporary file first, and gets the name of the log only when it is complete. Thus a stop during
 *   the copy leaves no part of a log, and the next start does the move again.
 * - Before the rename, the function removes the side files of an earlier log with no main file. Thus SQLite does not
 *   apply an old WAL file to the copy.
 */
export function moveOldLog(old: string, log: string, files: LogFiles): LogMove {
  if (files.exists(log)) return { moved: false, reason: "the log is there" };
  if (!files.exists(old)) return { moved: false, reason: "no old log" };
  const part = `${log}.move`;
  files.remove(part);
  files.snapshot(old, part);
  for (const side of SIDE_FILES) files.remove(`${log}${side}`);
  files.rename(part, log);
  return { moved: true };
}

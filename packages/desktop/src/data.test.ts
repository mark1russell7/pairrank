import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DATA_FOLDER, type LogFiles, OLD_DATA_FOLDER, SIDE_FILES, STORE_FILE, dataFolderOf, logPlaceOf, moveOldLog } from "./data.ts";
import { diskLogFiles } from "./disk-log.ts";

describe("logPlaceOf", () => {
  const appData = join("C:", "profile", "AppData", "Roaming");

  it("gives a log in memory to a smoke run, also with PAIRRANK_STORE", () => {
    expect(logPlaceOf(true, {}, appData)).toEqual({ kind: "memory" });
    expect(logPlaceOf(true, { PAIRRANK_STORE: "chosen.sqlite" }, appData)).toEqual({ kind: "memory" });
  });

  it("gives the file of PAIRRANK_STORE, with no move", () => {
    expect(logPlaceOf(false, { PAIRRANK_STORE: "chosen.sqlite" }, appData)).toEqual({ kind: "chosen", file: "chosen.sqlite" });
  });

  it("gives the folder of the data, and the old log of a development run, without the variable or with it empty", () => {
    const place = { kind: "data", file: join(appData, DATA_FOLDER, STORE_FILE), old: join(appData, OLD_DATA_FOLDER, STORE_FILE) };
    expect(logPlaceOf(false, {}, appData)).toEqual(place);
    expect(logPlaceOf(false, { PAIRRANK_STORE: "" }, appData)).toEqual(place);
  });

  it("gives one folder of the data for each run mode", () => {
    expect(dataFolderOf(appData)).toBe(join(appData, "pairrank"));
    expect(STORE_FILE).toBe("pairrank.sqlite");
    expect(OLD_DATA_FOLDER).toBe("Electron");
  });
});

/** A file system in memory that records each operation of `moveOldLog`. */
function memoryFiles(names: readonly string[], failSnapshot = false): LogFiles & { names: Set<string>; steps: string[] } {
  const files = new Set(names);
  const steps: string[] = [];
  return {
    names: files,
    steps,
    exists: (path) => files.has(path),
    remove(path) {
      steps.push(`remove ${path}`);
      files.delete(path);
    },
    snapshot(from, to) {
      steps.push(`snapshot ${from} ${to}`);
      if (failSnapshot) throw new Error("the disk is full");
      files.add(to);
    },
    rename(from, to) {
      steps.push(`rename ${from} ${to}`);
      files.delete(from);
      files.add(to);
    },
  };
}

describe("moveOldLog with a file system in memory", () => {
  const old = "old/pairrank.sqlite";
  const log = "new/pairrank.sqlite";

  it("does nothing when the log is there, also when the old log is there", () => {
    const files = memoryFiles([old, log]);
    expect(moveOldLog(old, log, files)).toEqual({ moved: false, reason: "the log is there" });
    expect(files.steps).toEqual([]);
  });

  it("does nothing when the old log is not there", () => {
    const files = memoryFiles([]);
    expect(moveOldLog(old, log, files)).toEqual({ moved: false, reason: "no old log" });
    expect(files.steps).toEqual([]);
  });

  it("copies to a temporary file, removes the old side files, and then gives the copy the name of the log", () => {
    const files = memoryFiles([old, `${log}.move`, `${log}-wal`]);
    expect(moveOldLog(old, log, files)).toEqual({ moved: true });
    expect(files.steps).toEqual([
      `remove ${log}.move`,
      `snapshot ${old} ${log}.move`,
      ...SIDE_FILES.map((side) => `remove ${log}${side}`),
      `rename ${log}.move ${log}`,
    ]);
    expect([...files.names].sort()).toEqual([log, old].sort());
  });

  it("makes no log when the copy fails, so the next start does the move again", () => {
    const files = memoryFiles([old], true);
    expect(() => moveOldLog(old, log, files)).toThrow("the disk is full");
    expect(files.exists(log)).toBe(false);
    expect(files.exists(old)).toBe(true);
    const again = memoryFiles([old]);
    expect(moveOldLog(old, log, again)).toEqual({ moved: true });
  });
});

describe("moveOldLog on the disk", () => {
  let root: string;
  let old: string;
  let log: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "pairrank-move-"));
    mkdirSync(join(root, "Electron"));
    mkdirSync(join(root, "pairrank"));
    old = join(root, "Electron", STORE_FILE);
    log = join(root, "pairrank", STORE_FILE);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  /** This function opens a log in WAL mode with no automatic checkpoint, and writes fictional events to it. */
  function writer(file: string, count: number): DatabaseSync {
    const db = new DatabaseSync(file);
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA wal_autocheckpoint = 0");
    db.exec("CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY, body TEXT NOT NULL) STRICT");
    const insert = db.prepare("INSERT INTO events (body) VALUES (?)");
    for (let index = 0; index < count; index++) insert.run(JSON.stringify({ type: "site", url: `https://site-${index}.example/` }));
    return db;
  }

  /** This function gives the count of events of a log, with a connection that changes nothing. */
  function countOf(file: string): number {
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      return (db.prepare("SELECT count(*) AS n FROM events").get() as { n: number }).n;
    } catch {
      return 0;
    } finally {
      db.close();
    }
  }

  it("copies the events that are still in the WAL file, which a plain copy of the file misses", () => {
    const open = writer(old, 50);
    try {
      expect(existsSync(`${old}-wal`)).toBe(true);
      const plain = join(root, "plain.sqlite");
      copyFileSync(old, plain);
      expect(countOf(plain)).toBe(0);

      expect(moveOldLog(old, log, diskLogFiles)).toEqual({ moved: true });
      expect(countOf(log)).toBe(50);
      expect(existsSync(`${log}.move`)).toBe(false);
    } finally {
      open.close();
    }
    // The old log stays, with each event
    expect(countOf(old)).toBe(50);
  });

  it("copies a closed log, and the store opens the copy in WAL mode", () => {
    writer(old, 3).close();
    expect(moveOldLog(old, log, diskLogFiles)).toEqual({ moved: true });
    const db = new DatabaseSync(log);
    try {
      db.exec("PRAGMA journal_mode = WAL");
      expect(db.prepare("PRAGMA journal_mode").get()).toEqual({ journal_mode: "wal" });
      expect((db.prepare("SELECT count(*) AS n FROM events").get() as { n: number }).n).toBe(3);
    } finally {
      db.close();
    }
  });

  it("does not change a log that is there", () => {
    writer(old, 5).close();
    writer(log, 2).close();
    expect(moveOldLog(old, log, diskLogFiles)).toEqual({ moved: false, reason: "the log is there" });
    expect(countOf(log)).toBe(2);
  });

  it("does nothing with no old log", () => {
    expect(moveOldLog(old, log, diskLogFiles)).toEqual({ moved: false, reason: "no old log" });
    expect(existsSync(log)).toBe(false);
  });

  it("replaces a part of an earlier copy that stopped, and removes the side files of an earlier log", () => {
    writer(old, 4).close();
    writeFileSync(`${log}.move`, "part of a copy");
    writeFileSync(`${log}-wal`, "an old WAL file");
    expect(moveOldLog(old, log, diskLogFiles)).toEqual({ moved: true });
    expect(existsSync(`${log}-wal`)).toBe(false);
    expect(countOf(log)).toBe(4);
  });

  it("keeps no file when the old log is not a database", () => {
    writeFileSync(old, "not a database");
    expect(() => moveOldLog(old, log, diskLogFiles)).toThrow();
    expect(existsSync(log)).toBe(false);
  });
});

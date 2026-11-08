/**
 * An append-only log of events in one SQLite file (`node:sqlite`). This file knows no pairrank types, so it can move to a
 * shared home as one file.
 *
 * @packageDocumentation
 */
import { DatabaseSync } from "node:sqlite";

/** The fields that the log reads from each event. The log keeps the full event as JSON. */
export interface LogRecord {
  readonly id: string;
  readonly at: string;
  readonly type: string;
}

/**
 * This function accepts an event into the state of the caller, or refuses it.
 *
 * @returns a problem when it refuses the event, and then it must not change the state
 */
export type Accept<E, P> = (event: E) => P | undefined;

/** An open log. */
export interface EventLog<E extends LogRecord> {
  /** This function gives each event of the log, in the order of the log. */
  read(): Generator<E>;
  /** This function accepts the event first, and then writes it. A refused event is not written. */
  append<P>(event: E, accept: Accept<E, P>): P | undefined;
  /** This function does `append` for each event, in one transaction. It gives the problems of the refused events. */
  appendAll<P>(events: Iterable<E>, accept: Accept<E, P>): P[];
  /** This function gives the count of events in the log. */
  count(): number;
  close(): void;
}

/** Each entry is one step of the schema. The `user_version` of the file is the count of steps that the file has. */
const MIGRATIONS: readonly string[] = [
  `CREATE TABLE events (
     seq INTEGER PRIMARY KEY,
     id TEXT NOT NULL UNIQUE,
     at TEXT NOT NULL,
     type TEXT NOT NULL,
     body TEXT NOT NULL
   ) STRICT`,
];

/** This function gives the schema version that this code writes. */
export const SCHEMA_VERSION: number = MIGRATIONS.length;

function migrate(db: DatabaseSync): void {
  const row = db.prepare("PRAGMA user_version").get() as { user_version: number };
  const version = row.user_version;
  if (version > MIGRATIONS.length) {
    throw new Error(`The log has the schema version ${version}, and this code knows only ${MIGRATIONS.length}. Use a newer version of the app.`);
  }
  for (let step = version; step < MIGRATIONS.length; step++) {
    db.exec("BEGIN");
    try {
      db.exec(MIGRATIONS[step] as string);
      db.exec(`PRAGMA user_version = ${step + 1}`);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
}

/**
 * This function opens a log, and makes the file when it is not there. `:memory:` gives a log with no file.
 *
 * The state of the caller and the file stay equal: `accept` comes before the write. A write or an `accept` can fail with an
 * error. Then the log is broken. Each later call throws, and the caller must open the log again and replay it.
 *
 * @param parse - The function that changes a stored JSON value into an event. It throws on a value that is not an event.
 */
export function openEventLog<E extends LogRecord>(path: string, parse: (value: unknown) => E): EventLog<E> {
  const db = new DatabaseSync(path);
  try {
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA synchronous = FULL");
    migrate(db);
  } catch (error) {
    db.close();
    throw error;
  }
  const insert = db.prepare("INSERT INTO events (id, at, type, body) VALUES (?, ?, ?, ?)");
  let broken: unknown;

  function guard(): void {
    if (broken !== undefined) throw new Error("The log is broken by an earlier error. Open it again and replay it.", { cause: broken });
  }

  function write<P>(event: E, accept: Accept<E, P>): P | undefined {
    const problem = accept(event);
    if (problem !== undefined) return problem;
    insert.run(event.id, event.at, event.type, JSON.stringify(event));
    return undefined;
  }

  function inTransaction<T>(work: () => T): T {
    guard();
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      broken = error;
      if (db.isTransaction) db.exec("ROLLBACK");
      throw error;
    }
  }

  return {
    *read() {
      guard();
      for (const row of db.prepare("SELECT seq, body FROM events ORDER BY seq").iterate() as Iterable<{ seq: number; body: string }>) {
        try {
          yield parse(JSON.parse(row.body));
        } catch (error) {
          throw new Error(`The event at the position ${row.seq} of the log is not valid.`, { cause: error });
        }
      }
    },
    append(event, accept) {
      return inTransaction(() => write(event, accept));
    },
    appendAll(events, accept) {
      return inTransaction(() => {
        const problems = [];
        for (const event of events) {
          const problem = write(event, accept);
          if (problem !== undefined) problems.push(problem);
        }
        return problems;
      });
    },
    count() {
      guard();
      return (db.prepare("SELECT count(*) AS n FROM events").get() as { n: number }).n;
    },
    close() {
      db.close();
    },
  };
}

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Event } from "@pairrank/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SCHEMA_VERSION, openEventLog } from "./log.ts";
import { openStore } from "./store.ts";

let folder: string;
let file: string;

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "pairrank-store-"));
  file = join(folder, "pairrank.db");
});

afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

let next = 0;
function event(draft: Record<string, unknown>): Event {
  next += 1;
  return { id: `e${next}`, at: "2026-11-08T12:00:00Z", ...draft } as Event;
}

const site = (id: string): Event => event({ type: "site.added", site: id, url: `https://${id}.example/` });

describe("openStore", () => {
  it("gives the same state after a reopen", () => {
    const store = openStore(file);
    expect(store.append(site("a"))).toBeUndefined();
    expect(store.append(site("b"))).toBeUndefined();
    expect(store.append(event({ type: "pick", a: "a", b: "b", scope: { kind: "overall" }, outcome: "a" }))).toBeUndefined();
    store.close();

    const again = openStore(file);
    expect(again.problems).toEqual([]);
    expect([...again.state.sites.keys()]).toEqual(["a", "b"]);
    expect(again.state.picks.size).toBe(1);
    expect([...again.events()].map((each) => each.type)).toEqual(["site.added", "site.added", "pick"]);
    again.close();
  });

  it("does not write a refused event", () => {
    const store = openStore(file);
    store.append(site("a"));
    const problem = store.append(event({ type: "site.tagged", site: "a", tag: "zzz" }));
    expect(problem?.code).toBe("unknown-tag");
    expect([...store.events()]).toHaveLength(1);
    store.close();
  });

  it("writes the accepted events of a batch, and gives the problems of the others", () => {
    const store = openStore(file);
    const problems = store.appendAll([site("a"), site("a"), site("b"), event({ type: "tag.created", tag: "t", name: "" })]);
    expect(problems.map((problem) => problem.code)).toEqual(["duplicate-site", "empty-name"]);
    store.close();
    const again = openStore(file);
    expect([...again.state.sites.keys()]).toEqual(["a", "b"]);
    again.close();
  });

  it("replays the file after a failed write, so the state keeps no event of that write", () => {
    const store = openStore(file);
    store.append(site("a"));
    // A second connection makes the insert of one event fail after its accept, as a full disk does
    const other = new DatabaseSync(file);
    other.exec("CREATE TRIGGER refuse BEFORE INSERT ON events WHEN NEW.id = 'bad' BEGIN SELECT RAISE(ABORT, 'disk full'); END");
    expect(() => store.appendAll([site("b"), { ...site("c"), id: "bad" }])).toThrow("disk full");
    expect([...store.state.sites.keys()]).toEqual(["a"]);
    expect([...store.events()]).toHaveLength(1);

    other.exec("DROP TRIGGER refuse");
    other.close();
    expect(store.append(site("b"))).toBeUndefined();
    expect([...store.state.sites.keys()]).toEqual(["a", "b"]);
    store.close();
  });

  it("refuses each call when the replay after a failed write fails", () => {
    const store = openStore(file);
    store.append(site("a"));
    const other = new DatabaseSync(file);
    other.exec("INSERT INTO events (id, at, type, body) VALUES ('junk', '2026-11-08T12:00:00Z', 'x', '{}')");
    other.exec("CREATE TRIGGER refuse BEFORE INSERT ON events WHEN NEW.id = 'bad' BEGIN SELECT RAISE(ABORT, 'disk full'); END");
    other.close();
    expect(() => store.append({ ...site("b"), id: "bad" })).toThrow("disk full");
    expect(() => store.state).toThrow(/broken/);
    expect(() => store.append(site("c"))).toThrow(/broken/);
    store.close();
  });

  it("works with no file", () => {
    const store = openStore(":memory:");
    store.append(site("a"));
    expect(store.state.sites.size).toBe(1);
    store.close();
  });
});

describe("openEventLog", () => {
  const parse = (value: unknown) => value as { id: string; at: string; type: string };

  it("sets the schema version and the WAL mode", () => {
    openEventLog(file, parse).close();
    const db = new DatabaseSync(file);
    expect(db.prepare("PRAGMA user_version").get()).toEqual({ user_version: SCHEMA_VERSION });
    expect(db.prepare("PRAGMA journal_mode").get()).toEqual({ journal_mode: "wal" });
    db.close();
  });

  it("refuses a file from a newer version", () => {
    const db = new DatabaseSync(file);
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`);
    db.close();
    expect(() => openEventLog(file, parse)).toThrow(/newer version/);
  });

  it("names the position of an event that does not parse", () => {
    const log = openEventLog(file, parse);
    log.append({ id: "x", at: "2026-11-08T12:00:00Z", type: "bad" }, () => undefined);
    log.close();
    const strict = openEventLog(file, (value) => {
      throw new Error(`not an event: ${JSON.stringify(value)}`);
    });
    expect(() => [...strict.read()]).toThrow(/position 1/);
    strict.close();
  });

  it("writes nothing of a batch when an accept fails, and then refuses each call", () => {
    const log = openEventLog(file, parse);
    const records = [1, 2, 3].map((n) => ({ id: `r${n}`, at: "2026-11-08T12:00:00Z", type: "t" }));
    expect(() =>
      log.appendAll(records, (record) => {
        if (record.id === "r3") throw new Error("a bug");
        return undefined;
      }),
    ).toThrow("a bug");
    expect(() => log.count()).toThrow(/broken/);
    log.close();
    const again = openEventLog(file, parse);
    expect(again.count()).toBe(0);
    again.close();
  });

  it("is usable again after recover, and recover of a log that is not broken does nothing", () => {
    const log = openEventLog(file, parse);
    log.recover();
    const record = { id: "r1", at: "2026-11-08T12:00:00Z", type: "t" };
    expect(() =>
      log.append(record, () => {
        throw new Error("a bug");
      }),
    ).toThrow("a bug");
    expect(() => log.count()).toThrow(/broken/);
    log.recover();
    expect(log.count()).toBe(0);
    expect(log.append(record, () => undefined)).toBeUndefined();
    expect(log.count()).toBe(1);
    log.close();
  });
});

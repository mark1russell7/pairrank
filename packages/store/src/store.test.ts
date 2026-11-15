import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { EVENT_LOG_SCHEMA_VERSION } from "@mark1russell7/sqlite";
import type { Event } from "@pairrank/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

  it("opens a file of the earlier local log, keeps its events and moves it to the schema of the home", () => {
    // The schema of the earlier local log is the first step of the home, at user_version 1.
    const first = site("a");
    const db = new DatabaseSync(file);
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("CREATE TABLE events (seq INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, at TEXT NOT NULL, type TEXT NOT NULL, body TEXT NOT NULL) STRICT");
    db.prepare("INSERT INTO events (id, at, type, body) VALUES (?, ?, ?, ?)").run(first.id, first.at, first.type, JSON.stringify(first));
    db.exec("PRAGMA user_version = 1");
    db.close();

    const store = openStore(file);
    expect(store.problems).toEqual([]);
    expect([...store.state.sites.keys()]).toEqual(["a"]);
    expect(store.append(site("b"))).toBeUndefined();
    store.close();

    const check = new DatabaseSync(file);
    expect(check.prepare("PRAGMA user_version").get()).toEqual({ user_version: EVENT_LOG_SCHEMA_VERSION });
    expect(check.prepare("SELECT count(*) AS n FROM events").get()).toEqual({ n: 2 });
    check.close();
  });

  it("gives the problem duplicate-event for a known id, and writes nothing for it", () => {
    const store = openStore(file);
    const first = site("a");
    expect(store.append(first)).toBeUndefined();
    expect(store.append(first)).toEqual({ event: first.id, code: "duplicate-event", message: `The event ${first.id} is in the log.` });
    const changed = { ...first, url: "https://other.example/" } as Event;
    expect(store.append(changed)?.message).toMatch(/different body/);
    expect(store.appendAll([site("b"), first]).map((problem) => problem.code)).toEqual(["duplicate-event"]);
    expect([...store.events()]).toHaveLength(2);
    expect([...store.state.sites.keys()]).toEqual(["a", "b"]);
    store.close();
  });

  it("does not apply a known id that the rules refused at the replay", () => {
    const store = openStore(file);
    store.append(site("a"));
    store.close();
    // The rules refuse this event at the replay, because the tag is not there before it.
    const tagged = event({ type: "site.tagged", site: "a", tag: "t" });
    const db = new DatabaseSync(file);
    db.prepare("INSERT INTO events (id, at, type, body) VALUES (?, ?, ?, ?)").run(tagged.id, tagged.at, tagged.type, JSON.stringify(tagged));
    db.close();

    const again = openStore(file);
    expect(again.problems.map((problem) => problem.code)).toEqual(["unknown-tag"]);
    expect(again.append(event({ type: "tag.created", tag: "t", name: "T" }))).toBeUndefined();
    // The rules now accept the event, but the file has its id. Thus the state must not get it.
    expect(again.append(tagged)?.code).toBe("duplicate-event");
    expect(again.state.events.has(tagged.id)).toBe(false);
    expect([...again.events()]).toHaveLength(3);
    again.close();
  });
});

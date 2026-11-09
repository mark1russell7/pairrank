/**
 * The store of pairrank: the log of events in a SQLite file, and the state that its replay gives.
 *
 * @packageDocumentation
 */
import { type Event, type Problem, type State, apply, parseEvent, replay } from "@pairrank/core";
import { openEventLog } from "./log.ts";

/** An open store. */
export interface Store {
  /**
   * The current state. Only the functions of the store change it. A failed write replays the file, so the state does
   * not keep the events of that write. Thus read it again after each write. It throws when the store cannot replay.
   */
  readonly state: State;
  /** The events of the file that the rules refused at the replay. A new version of a rule can cause them. */
  readonly problems: readonly Problem[];
  /** This function applies an event and writes it. A refused event gives a problem, and the file does not change. */
  append(event: Event): Problem | undefined;
  /** This function applies and writes each event in one transaction. It gives the problems of the refused events. */
  appendAll(events: Iterable<Event>): Problem[];
  /** This function gives each event of the file, in order. */
  events(): Generator<Event>;
  close(): void;
}

/** This function opens a store, and replays its log. `:memory:` gives a store with no file. */
export function openStore(path: string): Store {
  const log = openEventLog(path, parseEvent);
  let { state, problems } = replay(log.read());
  /** The error of a failed write that the store could not repair. */
  let broken: unknown;
  const accept = (event: Event): Problem | undefined => apply(state, event);
  const guard = (): void => {
    if (broken !== undefined) throw new Error("The store is broken by an earlier error. Open it again.", { cause: broken });
  };
  /** This function writes, and replays the file after a failed write: `accept` changed the state before the rollback. */
  const write = <T>(work: () => T): T => {
    guard();
    try {
      return work();
    } catch (error) {
      try {
        log.recover();
        ({ state, problems } = replay(log.read()));
      } catch (replayError) {
        broken = replayError;
      }
      throw error;
    }
  };
  return {
    get state() {
      guard();
      return state;
    },
    get problems() {
      return problems;
    },
    append: (event) => write(() => log.append(event, accept)),
    appendAll: (events) => write(() => log.appendAll(events, accept)),
    events: () => log.read(),
    close: () => log.close(),
  };
}

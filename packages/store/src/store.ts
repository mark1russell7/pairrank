/**
 * The store of pairrank: the log of events in a SQLite file, and the state that its replay gives. The log is the event
 * log of `@mark1russell7/sqlite`.
 *
 * @packageDocumentation
 */
import { type Appended, openEventLog } from "@mark1russell7/sqlite";
import { type Event, type Problem, type State, apply, parseEvent, replay } from "@pairrank/core";

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

/**
 * This function gives the problem of one result of the log, or `undefined` for an added event.
 *
 * The log does not give an event with a known id to `accept`. Thus this function gives the problem `duplicate-event` for
 * it, as the rules do. This function does not use `apply` for it. A refused event of the file has no id in the state.
 * Thus `apply` can change the state, and the file gets no new row.
 */
function problemOf(event: Event, result: Appended<Event, Problem>): Problem | undefined {
  switch (result.kind) {
    case "added":
      return undefined;
    case "refused":
      return result.problem;
    case "duplicate":
      return { event: event.id, code: "duplicate-event", message: `The event ${event.id} is in the log.` };
    case "conflict":
      return { event: event.id, code: "duplicate-event", message: `The event ${event.id} is in the log with a different body.` };
  }
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
    append: (event) => write(() => problemOf(event, log.append(event, accept))),
    appendAll: (events) =>
      write(() => {
        const list = [...events];
        const results = log.appendAll(list, accept);
        const found: Problem[] = [];
        list.forEach((event, index) => {
          const problem = problemOf(event, results[index] as Appended<Event, Problem>);
          if (problem !== undefined) found.push(problem);
        });
        return found;
      }),
    events: () => log.read(),
    close: () => log.close(),
  };
}

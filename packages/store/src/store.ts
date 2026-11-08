/**
 * The store of pairrank: the log of events in a SQLite file, and the state that its replay gives.
 *
 * @packageDocumentation
 */
import { type Event, type Problem, type State, apply, parseEvent, replay } from "@pairrank/core";
import { openEventLog } from "./log.ts";

/** An open store. */
export interface Store {
  /** The current state. Only the functions of the store change it. */
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
  const { state, problems } = replay(log.read());
  const accept = (event: Event): Problem | undefined => apply(state, event);
  return {
    state,
    problems,
    append: (event) => log.append(event, accept),
    appendAll: (events) => log.appendAll(events, accept),
    events: () => log.read(),
    close: () => log.close(),
  };
}

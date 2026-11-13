/**
 * The tools of the checks of the built app. They are a connection to a target of the debug port of Chromium, a wait with
 * a time limit, a free port, and a log. The layout check and the check of the pages use them.
 */
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

/** The time limit of each wait, in milliseconds. */
export const LIMIT_MS = 20_000;

/** A target of a debug port: a page, or the main process for the inspector. */
export interface Target {
  readonly type: string;
  readonly url: string;
  readonly webSocketDebuggerUrl: string;
}

export const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

const started = Date.now();

/** This function writes a line of the log, with the time from the start of the check. */
export const say = (text: string): void => console.log(`${String(Date.now() - started).padStart(6)} ms  ${text}`);

/** A connection to one target of a debug port: `Runtime.evaluate`, and `send` for another method. */
export interface Connection {
  /** This function evaluates an expression in the target. `gesture` makes it an action of the person, as a click. */
  evaluate<T>(expression: string, gesture?: boolean): Promise<T>;
  /** This function sends a method, and gives the value of its result, if it has one. */
  send(method: string, params: Record<string, unknown>): Promise<unknown>;
  close(): void;
}

/** This function connects to one target of the debug port. */
export async function connect(target: Target): Promise<Connection> {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((done, fail) => {
    socket.addEventListener("open", done, { once: true });
    socket.addEventListener("error", fail, { once: true });
  });
  let next = 0;
  const waiting = new Map<number, (value: unknown) => void>();
  socket.addEventListener("message", (message) => {
    const data = JSON.parse(String(message.data)) as { id?: unknown; result?: { result?: { value?: unknown } } };
    // The message comes from outside, so only a number of a waiting call gives a function
    if (typeof data.id !== "number") return;
    const done = waiting.get(data.id);
    if (typeof done !== "function") return;
    waiting.delete(data.id);
    done(data.result?.result?.value);
  });
  const call = (method: string, params: Record<string, unknown>): Promise<unknown> =>
    new Promise((done) => {
      const id = ++next;
      waiting.set(id, done);
      socket.send(JSON.stringify({ id, method, params }));
    });
  return {
    evaluate: async <T>(expression: string, gesture = false) => (await call("Runtime.evaluate", { expression, returnByValue: true, userGesture: gesture })) as T,
    send: (method, params) => call(method, params),
    close: () => socket.close(),
  };
}

/** This function waits until `test` gives a value that is not `undefined`, or throws after the time limit. */
export async function until<T>(what: string, test: () => Promise<T | undefined>): Promise<T> {
  const end = Date.now() + LIMIT_MS;
  while (Date.now() < end) {
    const found = await test();
    if (found !== undefined) return found;
    await sleep(200);
  }
  throw new Error(`No ${what} in ${LIMIT_MS} ms.`);
}

/** This function gives a free port of the loopback address. */
export async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const { port } = server.address() as AddressInfo;
  await new Promise((done) => server.close(done));
  return port;
}

/** This function gives the targets of a debug port, or no targets while the port is not open. */
export async function targetsOf(port: number): Promise<Target[]> {
  try {
    return (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as Target[];
  } catch {
    return [];
  }
}

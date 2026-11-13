/** This file reads the port of the browser host from the environment variable `PORT`. */
import { DEFAULT_PORT } from "./index.ts";

/** This function gives the port from the text of the variable `PORT`, or the default port when the variable is not set. */
export function portOf(text: string | undefined): number {
  const value = text === undefined ? DEFAULT_PORT : Number(text);
  if (!Number.isInteger(value) || value < 0 || value > 65535) throw new Error(`PORT is not a port: ${text}`);
  return value;
}

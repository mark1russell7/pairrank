/**
 * The constants of @pairrank/web that the page also uses. This module has no Node.js code, so the page bundle can
 * import it.
 */

/** The time limit of the load of a site in a frame, in milliseconds. The check of the site is part of this time. */
export const LOAD_TIMEOUT_MS = 20_000;

/** The time limit of one request of the frame check, in milliseconds. */
export const CHECK_TIMEOUT_MS = 8_000;

/** The base path of the procedures of the host. */
export const API_PATH = "/api";

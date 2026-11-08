/**
 * The surfaces of pairrank. A surface shows a site in a slot of the window. This package has the contract of a surface,
 * the status of each slot and a time limit for the loads. It also has the proxy of a surface in another process, and
 * a surface in memory for the tests.
 *
 * @packageDocumentation
 */
export * from "./memory.ts";
export * from "./remote.ts";
export * from "./surface.ts";
export * from "./timeout.ts";

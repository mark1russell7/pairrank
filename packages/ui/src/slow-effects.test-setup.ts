/**
 * This file sets up the slow run of the tests (`vitest.slow.config.ts`). React starts its effects with `setImmediate`.
 * Here each `setImmediate` waits 5 ms, so the effects start after the end of a wait of Testing Library. A test that
 * reads the result of an effect too early fails in this run (B2). A CI machine under load gives this order only
 * sometimes.
 */
import { configure } from "@testing-library/react";

type Task = (...args: unknown[]) => void;
Object.assign(globalThis, { setImmediate: (task: Task, ...args: unknown[]) => setTimeout(task, 5, ...args) });
configure({ asyncUtilTimeout: 5000 });

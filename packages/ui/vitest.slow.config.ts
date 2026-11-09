import { defineConfig, mergeConfig } from "vitest/config";
import base from "./vitest.config.ts";

// The slow run of the tests: React starts its effects late (`src/slow-effects.setup.ts`)
export default mergeConfig(base, defineConfig({ test: { setupFiles: ["./src/slow-effects.setup.ts"], testTimeout: 30_000 } }));

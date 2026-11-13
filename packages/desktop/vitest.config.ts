import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    coverage: {
      // Each source file counts, also a file that no test loads. The end-to-end scripts are tests, not source.
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.{test,spec}.{ts,tsx}", "src/e2e/**"],
      // The CI run of R34 on 2026-11-13. Before it, 5 CI runs agreed, so the values do not change from run to run. A
      // change that lowers a value adds tests.
      thresholds: { lines: 22.7, statements: 20.59, functions: 26.82, branches: 22.97 },
    },
  },
});

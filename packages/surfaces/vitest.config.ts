import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    coverage: {
      // Each source file counts, also a file that no test loads. The end-to-end scripts are tests, not source.
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.{test,spec}.{ts,tsx}", "src/e2e/**"],
      // The worst of 5 CI runs on 2026-11-13, which agreed. A change that lowers a value adds tests.
      thresholds: { lines: 99.44, statements: 97.43, functions: 97.7, branches: 90.43 },
    },
  },
});

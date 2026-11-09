import { defineConfig } from "tsdown";

// The build of the capture check: a main process of Electron, as the main build of tsdown.config.ts. Only the e2e
// script builds it, so the app has no check in its build.
export default defineConfig({
  entry: { capture: "src/e2e/capture.e2e.ts" },
  format: "esm",
  outDir: "build/e2e",
  platform: "node",
  fixedExtension: false,
  sourcemap: true,
  dts: false,
  deps: { neverBundle: ["electron"], alwaysBundle: [/^(?!electron$)/] },
});

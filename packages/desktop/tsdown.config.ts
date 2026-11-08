import { type UserConfig, defineConfig } from "tsdown";

// Three builds for the three processes of the app. Electron is in the app, so no build bundles it.
// - The main process: an ES module for Node.js. It bundles the source packages of the workspace, because Electron
//   does not run TypeScript.
// - The preload script: CommonJS, because a preload script in a sandbox cannot be an ES module.
// - The page: an ES module for the browser, with the files of page/ and the style sheet of @pairrank/ui next to it.
const shared: UserConfig = {
  platform: "node",
  fixedExtension: false,
  sourcemap: true,
  dts: false,
  deps: { neverBundle: ["electron"], alwaysBundle: [/^(?!electron$)/] },
};

export default defineConfig([
  { ...shared, entry: { main: "src/main.ts" }, format: "esm", outDir: "build/main" },
  { ...shared, entry: { preload: "src/preload.ts" }, format: "cjs", outDir: "build/preload" },
  {
    ...shared,
    entry: { page: "src/page.ts" },
    format: "esm",
    platform: "browser",
    outDir: "build/page",
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    copy: ["page/index.html", "../ui/src/app.css"],
  },
]);

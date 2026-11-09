import { defineConfig } from "tsdown";

// The page: an ES module for the browser, with the files of page/ and the style sheet of @pairrank/ui next to it. The
// host has no build: Node.js starts its source.
export default defineConfig({
  entry: { page: "src/page.ts" },
  format: "esm",
  platform: "browser",
  outDir: "build/page",
  fixedExtension: false,
  sourcemap: true,
  dts: false,
  deps: { alwaysBundle: [/./] },
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  copy: ["page/index.html", "../ui/src/app.css"],
});

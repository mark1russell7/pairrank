import { describe, expect, it } from "vitest";
import { APP_ID, INSTALLER_NAME, PRODUCT_NAME, checksForUpdates, foreignImports, releaseTag, stagedPackage } from "./installer.ts";

describe("stagedPackage", () => {
  it("gives the package of the staging folder: the version of the app, the main bundle and no dependencies", () => {
    const staged = stagedPackage("1.2.3");
    expect(staged).toMatchObject({ name: "pairrank", productName: "pairrank", version: "1.2.3", main: "build/main/main.js", type: "module" });
    expect(Object.keys(staged)).not.toContain("dependencies");
    expect(Object.keys(staged)).not.toContain("devDependencies");
  });
});

describe("the names of the release", () => {
  it("gives the tag of a version, and an installer name with no space", () => {
    expect(releaseTag("0.2.0")).toBe("desktop-v0.2.0");
    expect(INSTALLER_NAME).not.toContain(" ");
    expect(PRODUCT_NAME).toBe("pairrank");
    expect(APP_ID).toMatch(/^[a-z0-9.]+$/);
  });
});

describe("foreignImports", () => {
  it("accepts Electron, the modules of Node.js and the files of the build", () => {
    const code = [
      'import { app } from "electron";',
      'import { readFile } from "node:fs/promises";',
      'import path from "path";',
      'import "./chunk.js";',
      'const fs = __require("fs");',
      'const original = require("original-fs");',
      'const later = await import("../page/page.js");',
      'export { thing } from "./thing.js";',
    ].join("\n");
    expect(foreignImports(code)).toEqual([]);
  });

  it("gives each package that the installed app does not have, once and in order", () => {
    const code = [
      'import { autoUpdater } from "electron-updater";',
      'import "polite-crawler/urls";',
      'const color = require("supports-color");',
      'const again = require ( "supports-color" );',
      'const lazy = import("@scope/lazy");',
    ].join("\n");
    expect(foreignImports(code)).toEqual(["@scope/lazy", "electron-updater", "polite-crawler/urls", "supports-color"]);
  });
});

describe("checksForUpdates", () => {
  it("is true only for the installed app out of a smoke run", () => {
    expect(checksForUpdates(true, false)).toBe(true);
    expect(checksForUpdates(true, true)).toBe(false);
    expect(checksForUpdates(false, false)).toBe(false);
    expect(checksForUpdates(false, true)).toBe(false);
  });
});

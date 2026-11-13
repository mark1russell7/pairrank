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
    const imports = ["electron", "node:fs/promises", "path", "./chunk.js", "fs", "original-fs", "../page/page.js", "electron/main"];
    expect(foreignImports(imports)).toEqual([]);
  });

  it("gives each package that the installed app does not have, once and in order", () => {
    const imports = ["electron-updater", "polite-crawler/urls", "supports-color", "electron", "supports-color", "@scope/lazy"];
    expect(foreignImports(imports)).toEqual(["@scope/lazy", "electron-updater", "polite-crawler/urls", "supports-color"]);
  });

  it("accepts a chunk of the build, also with no ./ before its name", () => {
    expect(foreignImports(["main-a1b2.js", "lazy.js"], ["main.js", "main-a1b2.js"])).toEqual(["lazy.js"]);
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

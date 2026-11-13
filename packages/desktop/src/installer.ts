/**
 * The facts of the Windows installer and of the updates of the desktop app, and the pure functions of the script
 * `scripts/installer.ts`. This module imports only the modules of Node.js. Thus Node.js starts the script with no build.
 */
import { builtinModules } from "node:module";

/** The id of the app on Windows. The installer gives it to the shortcuts, and the notifications of the app use it. */
export const APP_ID = "io.github.mark1russell7.pairrank";

/** The name of the app: the installer, the start menu and the folder of the program use it. */
export const PRODUCT_NAME = "pairrank";

/** The repository on GitHub. Its releases give the installer and the updates. */
export const RELEASE_REPOSITORY: { readonly owner: string; readonly repo: string } = { owner: "mark1russell7", repo: "pairrank" };

/**
 * The name of the file of the installer, as a template of electron-builder. The name has no space. GitHub changes each
 * space of an asset name to a dot, and then the name in `latest.yml` does not agree with the asset.
 */
export const INSTALLER_NAME = "pairrank-setup-${version}.${ext}";

/** This function gives the name of the GitHub release of a version of the desktop app. The tag has the same name. */
export function releaseTag(version: string): string {
  return `desktop-v${version}`;
}

/** The `package.json` of the staging folder. It has no dependencies, because the bundles include each package. */
export interface StagedPackage {
  readonly name: string;
  readonly productName: string;
  readonly version: string;
  readonly description: string;
  readonly author: string;
  readonly main: string;
  readonly type: "module";
  readonly private: true;
}

/** This function gives the `package.json` of the staging folder for a version of the app. */
export function stagedPackage(version: string): StagedPackage {
  return {
    name: PRODUCT_NAME,
    productName: PRODUCT_NAME,
    version,
    description: "The desktop app of pairrank.",
    author: PRODUCT_NAME,
    main: "build/main/main.js",
    type: "module",
    private: true,
  };
}

/** The modules that Electron gives each main process, in addition to the modules of Node.js. */
const ELECTRON_MODULES: ReadonlySet<string> = new Set(["electron", "electron/main", "electron/common", "electron/renderer", "original-fs"]);

/** The forms of an import in a bundle: `from "x"`, `import "x"`, `import("x")` and `require("x")`. */
const IMPORT_FORMS: readonly RegExp[] = [
  /\bfrom\s*["']([^"'\n]+)["']/g,
  /\bimport\s*["']([^"'\n]+)["']/g,
  /\bimport\s*\(\s*["']([^"'\n]+)["']\s*\)/g,
  /require\s*\(\s*["']([^"'\n]+)["']\s*\)/g,
];

/** This function tells if the installed app has a module: a module of Node.js or Electron, or a file of the build. */
function isAvailable(name: string): boolean {
  if (name.startsWith("./") || name.startsWith("../") || name.startsWith("node:")) return true;
  return ELECTRON_MODULES.has(name) || builtinModules.includes(name);
}

/**
 * This function gives the modules that a bundle imports and that the installed app does not have. The installer has no
 * `node_modules` folder, so each such import fails when the app starts.
 */
export function foreignImports(code: string): string[] {
  const found = new Set<string>();
  for (const form of IMPORT_FORMS) {
    for (const match of code.matchAll(form)) {
      const name = match[1];
      if (name !== undefined && !isAvailable(name)) found.add(name);
    }
  }
  return [...found].sort();
}

/**
 * This function tells if the main process looks for updates. Only the installed app does: not a development run, and
 * not a smoke run. A development run also has the override of the page address (`PAGE_URL`), so it does not update.
 */
export function checksForUpdates(packaged: boolean, smoke: boolean): boolean {
  return packaged && !smoke;
}

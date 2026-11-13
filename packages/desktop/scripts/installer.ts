/**
 * This script makes the Windows installer of the desktop app in `dist/`. Node.js starts it with no build:
 * `node scripts/installer.ts` in `packages/desktop`, or `pnpm --filter @pairrank/desktop installer`.
 *
 * 1. It builds the three bundles with `tsdown`.
 * 2. It examines the bundles. They can import only Electron, the modules of Node.js and the files of the build.
 * 3. It writes a staging folder with `build/` and a `package.json` with no dependencies. Thus electron-builder does not
 *    collect the `node_modules` folders of the workspace.
 * 4. electron-builder makes an NSIS installer for one user from that folder, with `latest.yml` and the blockmap for the
 *    updates. The installer has no signature, and the script publishes nothing.
 *
 * The option `--dir` makes only the unpacked app in `dist/win-unpacked`, with no installer.
 */
import { cp, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import builder from "electron-builder";
import { build as tsdown } from "tsdown";
import { APP_ID, INSTALLER_NAME, PRODUCT_NAME, RELEASE_REPOSITORY, foreignImports, stagedPackage } from "../src/installer.ts";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(packageDir, "dist");
const unpackedOnly = process.argv.includes("--dir");

/** The bundles of the app, and the files of the build that go into the installer. */
const BUNDLES = ["build/main/main.js", "build/preload/preload.cjs"] as const;
const PARTS = ["main", "preload", "page"] as const;

process.chdir(packageDir);
await tsdown({ config: join(packageDir, "tsdown.config.ts") });

for (const bundle of BUNDLES) {
  const foreign = foreignImports(await readFile(join(packageDir, bundle), "utf8"));
  if (foreign.length > 0) throw new Error(`${bundle} imports packages that the installed app does not have: ${foreign.join(", ")}`);
}

const { version } = JSON.parse(await readFile(join(packageDir, "package.json"), "utf8")) as { version: string };
const stage = await mkdtemp(join(tmpdir(), "pairrank-stage-"));
try {
  // The source maps stay out of the installer: the installed app has no terminal that shows a stack.
  for (const part of PARTS) {
    await cp(join(packageDir, "build", part), join(stage, "build", part), { recursive: true, filter: (file) => !file.endsWith(".map") });
  }
  await writeFile(join(stage, "package.json"), `${JSON.stringify(stagedPackage(version), null, 2)}\n`);

  // The Electron of the workspace: its version, and its files from the install of the package electron
  const electronPackage = createRequire(import.meta.url).resolve("electron/package.json");
  const electronVersion = (JSON.parse(await readFile(electronPackage, "utf8")) as { version: string }).version;

  const { Arch, Platform, build } = builder;
  const artifacts = await build({
    projectDir: stage,
    targets: Platform.WINDOWS.createTarget(unpackedOnly ? "dir" : "nsis", Arch.x64),
    publish: "never",
    config: {
      appId: APP_ID,
      productName: PRODUCT_NAME,
      electronVersion,
      electronDist: join(dirname(electronPackage), "dist"),
      directories: { output: out },
      files: ["build/**/*", "package.json"],
      npmRebuild: false,
      nodeGypRebuild: false,
      // One install for the person, with no admin rights and no questions
      nsis: { oneClick: true, perMachine: false, artifactName: INSTALLER_NAME },
      // electron-builder writes this place to app-update.yml, and electron-updater reads the releases there
      publish: { provider: "github", owner: RELEASE_REPOSITORY.owner, repo: RELEASE_REPOSITORY.repo },
    },
  });
  for (const file of artifacts) console.log(`installer: ${relative(packageDir, file)} (${((await stat(file)).size / 2 ** 20).toFixed(1)} MiB)`);
} finally {
  await rm(stage, { recursive: true, force: true });
}

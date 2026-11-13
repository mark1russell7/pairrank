# @pairrank/desktop

The desktop app of pairrank. It is an Electron app. It shows the interface of `@pairrank/ui`, and it keeps the log of events on disk.

## Start the app

From the root of the repository:

```sh
pnpm install
pnpm --filter @pairrank/desktop start
```

The command builds the app to `build/`, and then starts it with Electron.

- The log of events is the file `pairrank.sqlite` in the folder of the data ("The data").
- To use a different log, set the variable `PAIRRANK_STORE` to the path of a file.
- `pnpm --filter @pairrank/desktop smoke` starts the app with a log in memory. It stops after the first message of the page.

## The installer

Each GitHub release `desktop-v<version>` of this repository has an installer for Windows.

### The first install

1. Open the [releases](https://github.com/mark1russell7/pairrank/releases) of the repository.
2. In the latest release `desktop-v<version>`, download `pairrank-setup-<version>.exe`.
3. Start the file. The installer has no signature, so Windows SmartScreen shows a warning. Select "More info", then "Run anyway".
4. The installer puts the app in `%LOCALAPPDATA%\Programs\pairrank`, only for your account. It needs no admin rights.

### The updates

- The installed app looks for a new release at each start.
- It downloads the new version in the background. A notification tells you when the new version is ready.
- The new version installs when you close the app.
- A development run does not look for updates. A smoke run also does not.

### The data

- The folder of the data is `%APPDATA%\pairrank` on Windows. It has the log of events, `pairrank.sqlite`.
- The installed app and a development run use the same folder, so they use the same log. Only one of them operates at a time.
- An earlier development run kept the log in `%APPDATA%\Electron`. At the first start, the app copies that log to the folder of the data.
- The app does this move only when `%APPDATA%\pairrank\pairrank.sqlite` is not there. The copy includes the last writes of the WAL file.
- The old file stays. Delete it only after you examine the picks in the new version.
- Close the earlier version before the first start of the new version. Else its later picks stay in the old file.
- The logins of the sites do not move. Log in to the sites again.
- An uninstall keeps the folder of the data.

### A release

1. Increase the `version` of `packages/desktop/package.json` with the SemVer rules. Before 1.0.0, a breaking change increases MINOR, and a feature or a fix increases PATCH.
2. Merge the change to `main`.
3. Start the workflow `Desktop` on `main` (`desktop.yml`), for example from the Actions page of the repository.

- The workflow builds the installer, installs it, and starts the installed app with `--smoke`.
- Then it makes the release `desktop-v<version>` with the installer, `latest.yml` and the blockmap.
- When the release of that version is there, the workflow makes no release.
- The updater reads the latest release of the repository. Thus the latest release must always be a release of the desktop app.
- On a pull request that changes the app, the workflow builds and examines the installer, and makes no release.
- `pnpm --filter @pairrank/desktop installer` builds the installer in `dist/`. The script is `scripts/installer.ts`.

## The processes

| Process | File | Task |
| --- | --- | --- |
| Main | `src/main.ts` | It opens the log, serves the procedures of `@pairrank/host` and holds one view for each site. |
| Main | `@pairrank/host/bookmarks` | It finds the bookmarks files of the Chrome profiles, and reads only those files. The page cannot give a path. |
| Main | `src/capture.ts`, `@pairrank/host/pictures` | It loads a site in a window off the screen, and gives a still picture of it. At most two captures operate. |
| Main | `src/data.ts`, `src/disk-log.ts` | It sets the folder of the data, and moves the log of an earlier development run into it once. |
| Main | `src/updates.ts` | It looks for an update of the installed app, and installs it when the app closes. |
| Preload | `src/preload.ts` | It gives the page the two message ports of the main process, and nothing more. |
| Page | `src/page.ts` | It shows the interface, and sends the calls and the slot commands on the ports. |

- The page has no Node.js and operates in a sandbox. It gets only its own files from `app://page/`.
- Each site shows in its own view, in the session `persist:sites`. A site gets no permission and no preload script.
- Each new site starts locked. The lock stops each new window at once.
- The lock stops each navigation of the site after the first load. The first load ends at the first click or key of the person in the page. It also ends after `SETTLE_MS` (2 seconds) with no load in the page.
- Thus a redirect of the first load goes on, also a redirect of a script.
- An unlocked site can navigate. A new window opens as a tab of the slot, in its own view. A slot has at most `MAX_TABS` tabs.
- The bar of the slot shows the tabs, Back, Forward, "Return to the site" and "Add this page". The first tab is the site, and it does not close.
- The lock does not stop a page change inside a single-page site (`pushState` or a hash change). Such a change does not load a new page.
- A click on a site gives the keys to the site. `Escape` gives the keys back to the app.
- The rules of the app are pure functions in `src/index.ts`. The tests examine them with no Electron process.
- When a view crashes, or a site refuses the view, the slot shows a still picture of the site. A capture has the rules of the views.
- `pnpm e2e` starts the built app with two local sites. It opens the Look screen and the duel, and examines the height of each slot.
- Then `pnpm e2e` examines the lock and the tabs with a local site: a redirect, a stopped link, a stopped window, Back, a tab and "Add this page". A click of the mouse soon after a load also stops the link.
- Then `pnpm e2e` captures local sites. It examines the color of the picture, a redirect, a closed port, a page with no answer and the pool.

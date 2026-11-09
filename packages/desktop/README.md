# @pairrank/desktop

The desktop app of pairrank. It is an Electron app. It shows the interface of `@pairrank/ui`, and it keeps the log of events on disk.

## Start the app

From the root of the repository:

```sh
pnpm install
pnpm --filter @pairrank/desktop start
```

The command builds the app to `build/`, and then starts it with Electron.

- The log of events is the file `pairrank.sqlite` in the folder of the user data of the app. On Windows, this folder is `%APPDATA%\pairrank`.
- To use a different log, set the variable `PAIRRANK_STORE` to the path of a file.
- `pnpm --filter @pairrank/desktop smoke` starts the app with a log in memory. It stops after the first message of the page.

## The processes

| Process | File | Task |
| --- | --- | --- |
| Main | `src/main.ts` | It opens the log, serves the procedures of `@pairrank/host` and holds one view for each site. |
| Main | `src/bookmarks.ts` | It finds the bookmarks files of the Chrome profiles, and reads only those files. The page cannot give a path. |
| Main | `src/capture.ts`, `src/pictures.ts` | It loads a site in a window off the screen, and gives a still picture of it. At most two captures operate. |
| Preload | `src/preload.ts` | It gives the page the two message ports of the main process, and nothing more. |
| Page | `src/page.ts` | It shows the interface, and sends the calls and the slot commands on the ports. |

- The page has no Node.js and operates in a sandbox. It gets only its own files from `app://page/`.
- Each site shows in its own view, in the session `persist:sites`. A site gets no permission, no preload script and no new window.
- A click on a site gives the keys to the site. `Escape` gives the keys back to the app.
- The rules of the app are pure functions in `src/index.ts`. The tests examine them with no Electron process.
- When a view crashes, or a site refuses the view, the slot shows a still picture of the site. A capture has the rules of the views.
- `pnpm e2e` starts the built app with two local sites. It opens the Look screen and the duel, and examines the height of each slot.
- Then `pnpm e2e` captures local sites. It examines the color of the picture, a redirect, a closed port, a page with no answer and the pool.

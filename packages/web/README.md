# @pairrank/web

The browser host of pairrank. A Node.js process serves the interface of `@pairrank/ui` to a browser on this computer. The page shows each site in an `iframe`, not in a view of Electron.

## Start the host

From the root of the repository:

```sh
pnpm install
pnpm --filter @pairrank/web start
```

The command builds the page to `build/page/`, and then starts the host. Open the address that the host prints, for example `http://127.0.0.1:4800/`.

- The log of events is the file `pairrank.sqlite` in the folder `.pairrank` of the home folder.
- To use a different log, set the variable `PAIRRANK_STORE` to the path of a file.
- To use a different port, set the variable `PORT`.
- Ctrl-C stops the host in its phases. The log closes after the last call.

## The parts

| Part | File | Task |
| --- | --- | --- |
| Host | `src/index.ts` | It gives the options of the procedures host: the procedures under `/api`, and the files of the page under `/`. |
| Host | `src/frames.ts` | It reads the headers of a site through the host policy of `@procedures/http`, and tells if the site refuses a frame. |
| Host | `@pairrank/host/bookmarks` | It finds the bookmarks files of the Chrome profiles, and reads only those files. The page cannot give a path. |
| Host | `src/main.ts` | It opens the log and starts the host. It is the only file that starts it. |
| Page | `src/page.ts` | It shows the interface, and sends the calls to the host over HTTP. |
| Page | `src/dom-frames.ts` | It makes one hidden `iframe` for each load, in a sandbox, and puts it in the box of its slot. |

- The host listens on `127.0.0.1` only. The browser checks of the host refuse a call from a page of another origin, and the check of the `Host` header stops DNS rebinding.
- The page gets a strict content security policy. It loads only its own files, and it sends requests only to its own origin. Only its frames show other origins.
- A site can refuse a frame with `X-Frame-Options` or `frame-ancestors`. Before each load, the page asks the host (`frames.check`), and the slot shows the refusal. The page cannot see a refusal by itself.
- The check has no cookies of the browser, so a pass is not a promise. The time limit of the load still applies.
- The host policy refuses a private address, for example a router on the local network. The host does not read such an address, and the browser decides.
- Each frame has `referrerpolicy="no-referrer"` and no permissions. A site of the origin of the page gets no `allow-same-origin`.
- The still pictures of R19 are not in this host yet (R22). A site that refuses a frame shows the refusal.

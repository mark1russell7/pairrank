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
| Host | `@pairrank/host/pictures` | It gives the procedure `pictures.capture` over the capture of the option `pictures`. A new capture stops the oldest capture. |
| Host | `src/headless.ts` | It gives a capture with a headless browser of the system. The picture comes back as a JPEG `data:` address. |
| Host | `src/main.ts` | It opens the log and starts the host. It is the only file that starts it. |
| Page | `src/page.ts` | It shows the interface, and sends the calls to the host over HTTP. |
| Page | `src/dom-frames.ts` | It makes one hidden `iframe` for each load, in a sandbox, and puts it in the box of its slot. It changes the sandbox for the lock. |

- The host listens on `127.0.0.1` only. The browser checks of the host refuse a call from a page of another origin, and the check of the `Host` header stops DNS rebinding.
- The page gets a strict content security policy. It loads only its own files, and it sends requests only to its own origin. Only its frames show other origins.
- A site can refuse a frame with `X-Frame-Options` or `frame-ancestors`. Before each load, the page asks the host (`frames.check`), and the slot shows the refusal. The page cannot see a refusal by itself.
- The check has no cookies of the browser, so a pass is not a promise. The time limit of the load still applies.
- The host policy refuses a private address, for example a router on the local network. The host does not read such an address, and the browser decides.
- Each frame has `referrerpolicy="no-referrer"` and no permissions. A site of the origin of the page gets no `allow-same-origin`.
- Each new site starts locked. A locked frame gets no `allow-popups`, so the site opens no window. When a locked frame loads another page, the page loads the site again. After `MAX_RETURNS` such loads, the frame stays on its page.
- The page cannot see a click in the frame of another site. Thus a load within `SETTLE_MS` (2 seconds) of the last load is a redirect of the site, until the first quiet time. A click in that time goes on.
- An unlock adds `allow-popups` and `allow-popups-to-escape-sandbox`. A new window then opens in a tab of the browser, not in the slot.
- A frame has no tabs, no history and no address that the page can read. Thus the bar of a frame slot has no Back, no Forward and no "Add this page".
- The browser check waits for the quiet time. Then it moves the frame of a locked slot, and the lock loads the site again. After an unlock, the frame stays on its new page.
- A site that refuses a frame shows as a still picture from the host. The page sends the refused load to `pictures.capture`.
- The option `pictures` of `webHost` gives the capture. The caller makes the pool and stops it. The tests and the browser check give a fake capture.
- `headlessCapture` writes each picture in a new temporary folder, and deletes the folder after the capture. The render is an option, so the tests start no browser.
- `src/main.ts` gives no capture yet, so a refused site shows the refusal. The first release of `@procedures/browser` gives `renderScreenshot`, the render of `headlessCapture` (R22).

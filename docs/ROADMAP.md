# Roadmap

This file is the plan of pairrank. The tracker of the project mirrors it.

pairrank is a desktop app. It shows websites one at a time for tags. It also shows two websites side by side, and you pick the better one, under one tag or overall. The app keeps each pick in a local database and calculates the ratings from the picks.

## Decisions

- The log of events is the source of truth. The app calculates each rating from the log again, and does not keep a rating as the truth.
- Each scope has its own ladder. A scope is "overall" or one tag. An overall pick is a direct pick, not a mix of the tag ratings.
- The rating model is Bradley-Terry, on the scale of Elo (1500, and 400 points for odds of 10 to 1). Elo and Glicko-2 are also available, and a measure of the log-loss on picks that the fit did not see selects the model.
- The rating math is in `@mark1russell7/rigor-statistics`. The seeded random order of the viewer is in `@mark1russell7/rigor-generators`.
- The desktop app with Electron is first. The same interface also works in a browser with an `iframe`, for the sites that permit it.
- The import uses one standard format. An adapter changes each source into that format. The first adapter reads Chrome bookmarks.
- Bookmark folders do not become tags. The import wizard includes or excludes folders.
- The template gets a preset for an Electron app, in a pull request of the template at the start of R10. The preset joins a React interface, a service host and a Node main process.

## Items

| ID | Item | Status | Needs | Summary |
| --- | --- | --- | --- | --- |
| R1 | Rating math | done | | Add Elo, Glicko-2 and Bradley-Terry with ties to `@mark1russell7/rigor-statistics`, in a pull request of that repository. |
| R2 | The repository | done | | Make the repository from the template, with CI. |
| R3 | The log of events | done | R2 | Define sites, tags, tag events, picks (A, B, tie, skip), hidden sites and scopes as pure data, with tests. |
| R4 | The store | done | R3 | Keep the log in SQLite (`node:sqlite`). Add only, and replay the log to get the state. |
| R5 | Ratings from the log | done | R1, R3 | Calculate one ladder for each scope, with an uncertainty. Select the model by the log-loss on held-out picks. |
| R6 | The standard input format | done | R3 | Define the format of a list of sites (URL, title, tags, source, date). Remove duplicate URLs at import. |
| R7 | The Chrome bookmarks adapter | done | R6, R10 | Read the Chrome bookmarks file. A wizard includes or excludes folders. The adapter shipped in #16. The profile search and the wizard shipped in #17. |
| R8 | The host | done | R4 | The procedures of the app over the store. The main process serves them to the interface through a message port. |
| R9 | The surfaces | done | R2 | One interface shows a site. The interface lays out the slots, and each adapter follows that layout. The contract is in `@pairrank/surfaces`. The first adapter, an Electron view, shipped with R10. R19 adds still pictures, and R21 adds an `iframe`. |
| R10 | The app shell | done | R8, R9 | Add the Electron preset to the template. Make the React interface (`@pairrank/ui`). Then make the desktop app (`@pairrank/desktop`): the log on disk, the procedures and one view for each site. |
| R11 | The tag run | done | R10, R12 | Show one site at a time. Keys set and clear tags. A run has a scope: the sites with no tags, each site, or the sites without a tag. An undo removes the last tag or hide. |
| R12 | Tags | done | R4 | Make, rename, merge, color, delete and find tags at each time. Give a key to a tag. The Look screen puts a tag on a site with its key. |
| R13 | The duel | done | R10, R5 | Show two sites side by side. Pick A, B, tie or skip, or hide a site. Pick under one tag or overall. An undo removes the last pick or hide. The desktop shell of R10 shows the screen. |
| R14 | The choice of pairs | done | R5 | Select the pairs with the least sure result and the sites with the fewest picks. Use a seed. The procedure is `pairrank.pair`. |
| R15 | Duel presets | done | R13 | Save a combined mode: a rule for the pairs, and a list of the picks that each pair asks. The duel asks the picks of a pair one after another. |
| R16 | The viewer | done | R5, R10 | The Sites screen filters the sites by a tag query with `and`, `or` and `not`. It orders them by date, title, one ladder or the mean over chosen tags. A list goes to the tag run. |
| R17 | The temperature of the viewer | done | R16 | A slider mixes an order by rating, from no mix to near random. A Gumbel draw for each site gives the Plackett-Luce law. "Shuffle again" draws again. |
| R18 | Hidden sites | done | R13 | Show the hidden sites, and restore a site. The Sites screen lists them with the reason of each hide. |
| R19 | The screenshot surface | done | R9 | When a view crashes, or a site refuses the view, the slot shows a still picture. The main process captures the site in a window off the screen. |
| R20 | Security scans in a private repository | done | | The template security scan fails in a private repository. A pull request of the template corrects it. |
| R21 | The `iframe` surface in a browser host | in progress | R9 | Show a site in an `iframe`, for a host with no Electron. The server reads the frame headers of a site before the load. A refusal switches the slot to its fallback. The surface `iframeSurface` is in `@pairrank/surfaces`. The browser host is next. |
| R22 | Still pictures in the browser host | later | R19, R21 | The server of the browser host captures the still pictures with a headless browser of the system. The page wiring of R19 stays the same. |
| B1 | Sites load, then disappear | done | | The screen of each site had no height, so the app hid the view after each load. A layout check in CI holds the fix. |
| B2 | A race in the duel tests | done | | The tests read the slots before React gave them their sites. The tests wait for the pair that the screen names. A slow run of the tests holds the fix. |
| B3 | A failed write kept its events in the state | done | | A write that fails after its checks rolls back the file. The state kept the events of the write, so the screens showed them. After a failed write, the store replays the file. |
| B4 | Page zoom moved the site views off their slots | in progress | | The page sends the box of each slot in CSS pixels. The views are in the pixels of the window, so at a zoom they missed their slots. The main process scales each box by the zoom of the page. The layout check in CI zooms out and holds the fix. |

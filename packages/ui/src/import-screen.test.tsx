// @vitest-environment happy-dom
import { pairrankModule } from "@pairrank/host";
import type { BookmarkSource } from "@pairrank/input";
import { openStore } from "@pairrank/store";
import { memorySurface } from "@pairrank/surfaces";
import { parseChromeBookmarks } from "@procedures/browser/bookmarks";
import { callerOf } from "@procedures/client";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { type BookmarksApi, type Call, apiOf } from "./api.ts";
import { App } from "./app.tsx";

afterEach(cleanup);

const url = (name: string, address: string) => ({ type: "url", name, url: address });

/** A bookmarks file of a profile: a folder Design with a folder Fonts in it, and a site that is not a web page. */
const PROFILE = {
  roots: {
    bookmark_bar: {
      type: "folder",
      name: "Bookmarks bar",
      guid: "bar",
      children: [
        url("News", "https://news.example/"),
        url("Settings", "chrome://settings"),
        { type: "folder", name: "Design", guid: "design", children: [url("A", "https://a.example/"), { type: "folder", name: "Fonts", guid: "fonts", children: [url("Type", "https://type.example/")] }] },
      ],
    },
    other: { type: "folder", name: "Other bookmarks", guid: "other", children: [url("Docs", "https://docs.example/"), url("News again", "https://news.example/")] },
  },
};

const ACCOUNT = { roots: { bookmark_bar: { type: "folder", name: "Bookmarks bar", guid: "bar", children: [url("Shop", "https://shop.example/")] } } };

/** A host with two files, over the real procedures of the host. */
function setup(fail?: string) {
  const store = openStore(":memory:");
  let n = 0;
  const caller = callerOf(pairrankModule(store, { key: (address) => address.replace(/\/$/, ""), id: () => `id${++n}`, now: () => "2026-11-08T12:00:00Z" }));
  const call: Call = (path, input) => caller(path, input);
  const sources: BookmarkSource[] = [
    { id: "chrome:Default:Bookmarks", name: "Mark", kind: "profile" },
    { id: "chrome:Default:AccountBookmarks", name: "Mark", kind: "account" },
  ];
  const files: Record<string, unknown> = { [sources[0]?.id ?? ""]: PROFILE, [sources[1]?.id ?? ""]: ACCOUNT };
  const bookmarks: BookmarksApi = {
    sources: async () => sources,
    read: async (source) => {
      if (source === fail) throw new Error("The file is not there now.");
      return parseChromeBookmarks(files[source], { prefix: `${source}:` });
    },
  };
  return { api: apiOf(call), bookmarks, surface: memorySurface().surface };
}

const total = () => screen.getByText(/in the import$/).textContent;

describe("the import of the Chrome bookmarks", () => {
  it("imports the sites of the included folders, and the folders do not become tags", async () => {
    const { api, bookmarks, surface } = setup();
    render(<App api={api} bookmarks={bookmarks} surface={surface} />);
    fireEvent.click(await screen.findByRole("button", { name: "Import Chrome bookmarks" }));

    // The files: both files of the profile, chosen at the start
    const account = await screen.findByRole("checkbox", { name: /Account bookmarks, not synced/ });
    expect(account).toHaveProperty("checked", true);
    fireEvent.click(account);
    fireEvent.click(screen.getByRole("button", { name: "Show the folders" }));

    // The folders: the copy of News is a site of the list, and the chrome:// address is not
    await screen.findByRole("region", { name: "Choose the folders" });
    expect(total()).toBe("5 sites in the import");
    expect(screen.getByText(/1 bookmark of this file is not a web page/)).toBeTruthy();
    expect(screen.queryByRole("checkbox", { name: "Fonts" })).toBeNull();

    fireEvent.click(screen.getByRole("checkbox", { name: "Design" }));
    expect(total()).toBe("3 sites in the import");
    const bar = screen.getByRole("checkbox", { name: "Bookmarks bar" }) as HTMLInputElement;
    expect([bar.checked, bar.indeterminate]).toEqual([false, true]);
    expect(screen.getByText("1 of 3 sites")).toBeTruthy();

    // A folder in an excluded folder can be included again
    fireEvent.click(screen.getByRole("button", { name: "Open Design" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Fonts" }));
    expect(total()).toBe("4 sites in the import");

    // The review: one site for each address
    fireEvent.click(screen.getByRole("button", { name: "Review the import" }));
    const review = await screen.findByRole("region", { name: "Review and import" });
    const report = within(review).getAllByRole("definition").map((cell) => cell.textContent);
    expect(report).toEqual(["3", "0", "1"]);
    fireEvent.click(within(review).getByRole("button", { name: "Import 3 sites" }));

    await screen.findByText("The import added 3 sites.");
    fireEvent.click(screen.getByRole("button", { name: "Show the sites" }));
    expect(await screen.findByText("3 sites, 0 tags")).toBeTruthy();
    const view = await api.view();
    expect(view.sites.map((site) => site.url).sort()).toEqual(["https://docs.example/", "https://news.example/", "https://type.example/"]);
    expect(view.tags).toEqual([]);
  });

  it("imports nothing new the second time", async () => {
    const { api, bookmarks, surface } = setup();
    render(<App api={api} bookmarks={bookmarks} surface={surface} />);
    fireEvent.click(await screen.findByRole("button", { name: "Import" }));
    fireEvent.click(await screen.findByRole("button", { name: "Show the folders" }));
    fireEvent.click(await screen.findByRole("button", { name: "Review the import" }));
    fireEvent.click(await screen.findByRole("button", { name: "Import 5 sites" }));
    await screen.findByText("The import added 5 sites.");

    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    fireEvent.click(await screen.findByRole("button", { name: "Show the folders" }));
    fireEvent.click(await screen.findByRole("button", { name: "Review the import" }));
    const none = await screen.findByRole("button", { name: "No new sites to import" });
    expect(none).toHaveProperty("disabled", true);
  });

  it("excludes each folder, and keeps the review closed with no sites", async () => {
    const { api, bookmarks, surface } = setup();
    render(<App api={api} bookmarks={bookmarks} surface={surface} />);
    fireEvent.click(await screen.findByRole("button", { name: "Import" }));
    fireEvent.click(await screen.findByRole("button", { name: "Show the folders" }));
    fireEvent.click(await screen.findByRole("button", { name: "Exclude all" }));
    expect(total()).toBe("0 sites in the import");
    expect(screen.getByRole("button", { name: "Review the import" })).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("button", { name: "Include all" }));
    expect(total()).toBe("6 sites in the import");
  });

  it("keeps the choices of the folders after Back, and puts the focus on each new step", async () => {
    const { api, bookmarks, surface } = setup();
    render(<App api={api} bookmarks={bookmarks} surface={surface} />);
    fireEvent.click(await screen.findByRole("button", { name: "Import" }));
    fireEvent.click(await screen.findByRole("button", { name: "Show the folders" }));
    const folders = await screen.findByRole("region", { name: "Choose the folders" });
    expect(document.activeElement).toBe(folders);
    fireEvent.click(screen.getByRole("checkbox", { name: "Other bookmarks" }));
    expect(total()).toBe("4 sites in the import");
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(await screen.findByRole("button", { name: "Show the folders" }));
    await screen.findByRole("region", { name: "Choose the folders" });
    expect(total()).toBe("4 sites in the import");
  });

  it("shows the problem of a file that it cannot read, and reads the other file", async () => {
    const { api, bookmarks, surface } = setup("chrome:Default:Bookmarks");
    render(<App api={api} bookmarks={bookmarks} surface={surface} />);
    fireEvent.click(await screen.findByRole("button", { name: "Import" }));
    fireEvent.click(await screen.findByRole("button", { name: "Show the folders" }));
    await screen.findByRole("region", { name: "Choose the folders" });
    expect(screen.getByRole("alert").textContent).toContain("Mark: The file is not there now.");
    expect(total()).toBe("1 site in the import");
  });

  it("reads a file that the user chooses, with no bookmarks procedures in the host", async () => {
    const { api, surface } = setup();
    render(<App api={api} surface={surface} />);
    fireEvent.click(await screen.findByRole("button", { name: "Import" }));
    const show = screen.getByRole("button", { name: "Show the folders" });
    expect(show).toHaveProperty("disabled", true);
    const input = screen.getByLabelText("Choose a bookmarks file") as HTMLInputElement;
    const good = new File([JSON.stringify(ACCOUNT)], "Bookmarks", { type: "application/json" });
    const bad = new File(["no"], "notes.txt");
    fireEvent.change(input, { target: { files: [good, bad] } });
    await screen.findByRole("checkbox", { name: /Chosen file/ });
    expect(screen.getByRole("alert").textContent).toContain("The file notes.txt is not a bookmarks file of Chrome.");
    fireEvent.click(show);
    await waitFor(() => expect(total()).toBe("1 site in the import"));
  });
});

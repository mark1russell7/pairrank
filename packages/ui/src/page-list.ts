/**
 * The list of the sites, as the bar of a slot uses it. The button "Add this page" adds the page of the open tab of a
 * slot to the list. The host compares the addresses by their key, so the button and the import agree on "in the list".
 */
import { siteList } from "@pairrank/input";
import type { PairrankApi } from "./api.ts";

/** The source of a site that the button "Add this page" adds. */
export const PAGE_SOURCE = "slot-page";

/** The result of an addition: a new site, or a site that the list has already. */
export type Addition = "added" | "existing";

/** The list of the sites, for the bar of a slot. */
export interface PageList {
  /** This function tells if the list has the site of an address. A change of the list needs no new call. */
  has(url: string): Promise<boolean>;
  /** This function adds a page to the list, with its title and no tags. A problem throws, with its text. */
  add(url: string, title?: string): Promise<Addition>;
}

/** This function makes the list of the sites over the procedures of the host. `changed` reads the view again after an addition. */
export function pageListOf(api: Pick<PairrankApi, "planImport" | "importList">, changed: () => Promise<void>): PageList {
  const listOf = (url: string, title?: string) => siteList(PAGE_SOURCE, [{ url, ...(title === undefined || title.trim() === "" ? {} : { title }) }]);
  return {
    async has(url) {
      const preview = await api.planImport(listOf(url));
      return preview.report.existing > 0;
    },
    async add(url, title) {
      const result = await api.importList(listOf(url, title));
      const problem = result.entries[0]?.message ?? result.problems[0]?.message;
      if (problem !== undefined) throw new Error(problem);
      await changed();
      return result.report.added > 0 ? "added" : "existing";
    },
  };
}

import { describe, expect, it } from "vitest";
import { UPDATE_NOTICE, type Updater, startUpdates } from "./updates.ts";

/** An updater that records each search, and fails when `fault` is given. */
function fakeUpdater(fault?: Error): Updater & { notices: { title: string; body: string }[] } {
  const notices: { title: string; body: string }[] = [];
  return {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    notices,
    checkForUpdatesAndNotify(notice) {
      notices.push(notice);
      return fault === undefined ? Promise.resolve(null) : Promise.reject(fault);
    },
  };
}

describe("startUpdates", () => {
  it("downloads in the background, installs at the close, and gives the notice with the version", async () => {
    const updater = fakeUpdater();
    const log: string[] = [];
    await startUpdates(updater, (message) => log.push(message));
    expect(updater.autoDownload).toBe(true);
    expect(updater.autoInstallOnAppQuit).toBe(true);
    expect(updater.notices).toEqual([UPDATE_NOTICE]);
    expect(UPDATE_NOTICE.body).toContain("{version}");
    expect(log).toEqual([]);
  });

  it("logs a fault, and does not throw", async () => {
    const updater = fakeUpdater(new Error("net::ERR_INTERNET_DISCONNECTED"));
    const log: string[] = [];
    await expect(startUpdates(updater, (message) => log.push(message))).resolves.toBeUndefined();
    expect(log).toEqual(["the search for an update failed: net::ERR_INTERNET_DISCONNECTED"]);
  });
});

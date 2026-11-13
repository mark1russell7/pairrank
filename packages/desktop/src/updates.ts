/**
 * The updates of the installed app, from the GitHub releases of the repository (`electron-updater`).
 *
 * - The app looks for a new version at each start. Only the installed app does it (`checksForUpdates`).
 * - It downloads the new version in the background, and installs it when the app closes.
 * - A notification of the system tells the person that the new version is ready.
 */
import { errorMessage } from "@mark1russell7/text";

/** The text of the notification. `electron-updater` puts the new version in the place of `{version}`. */
export const UPDATE_NOTICE: { readonly title: string; readonly body: string } = {
  title: "pairrank: an update is ready",
  body: "Version {version} installs when you close pairrank.",
};

/** The part of `autoUpdater` of `electron-updater` that `startUpdates` uses. */
export interface Updater {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  checkForUpdatesAndNotify(notice: { title: string; body: string }): Promise<unknown>;
}

/**
 * This function starts the search for an update, with the download in the background and the install at the close of
 * the app. A fault, for example no network, goes to `log`, and the app continues.
 */
export async function startUpdates(updater: Updater, log: (message: string) => void): Promise<void> {
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  try {
    await updater.checkForUpdatesAndNotify({ ...UPDATE_NOTICE });
  } catch (error) {
    log(`the search for an update failed: ${errorMessage(error)}`);
  }
}

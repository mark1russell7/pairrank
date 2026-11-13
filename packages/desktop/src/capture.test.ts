import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { electronCapture } from "./capture.ts";
import { CAPTURE_FRAME_RATE } from "./index.ts";

/** A fake of a `NativeImage`: a width, and a JPEG that names the width and the quality. */
class FakeImage {
  readonly width: number;
  readonly empty: boolean;
  readonly broken: boolean;
  constructor(width: number, empty = false, broken = false) {
    this.width = width;
    this.empty = empty;
    this.broken = broken;
  }
  isEmpty(): boolean {
    return this.empty;
  }
  getSize(): { width: number; height: number } {
    return { width: this.width, height: this.width / 2 };
  }
  resize({ width }: { width: number }): FakeImage {
    return new FakeImage(width);
  }
  toJPEG(quality: number): Buffer {
    if (this.broken) throw new Error("The encoder failed.");
    return Buffer.from(`jpeg ${this.width} ${quality}`);
  }
}

/** A fake of the `webContents` of a capture window. */
class FakeContents extends EventEmitter {
  muted = false;
  frameRate = 0;
  openHandler: (() => { action: string }) | undefined;
  readonly loads: string[] = [];
  /** The picture of `capturePage`, or a promise of it. */
  capture: Promise<FakeImage> = Promise.resolve(new FakeImage(50));
  capturePage = vi.fn(() => this.capture);
  setAudioMuted(muted: boolean): void {
    this.muted = muted;
  }
  setFrameRate(rate: number): void {
    this.frameRate = rate;
  }
  setWindowOpenHandler(handler: () => { action: string }): void {
    this.openHandler = handler;
  }
  loadURL(url: string): Promise<void> {
    this.loads.push(url);
    return Promise.reject(new Error("The fake does not load pages."));
  }
  getURL(): string {
    return "https://a.example/home";
  }
  getTitle(): string {
    return "Home";
  }
  /** This method sends `will-navigate`, and tells if a listener stopped it. */
  navigate(url: string): boolean {
    let prevented = false;
    this.emit("will-navigate", { preventDefault: () => (prevented = true) }, url);
    return prevented;
  }
}

/** A fake of a `BrowserWindow` off the screen. */
class FakeWindow {
  readonly webContents = new FakeContents();
  destroyed = false;
  readonly options: unknown;
  constructor(options: unknown) {
    this.options = options;
    windows.push(this);
  }
  isDestroyed(): boolean {
    return this.destroyed;
  }
  destroy(): void {
    this.destroyed = true;
  }
}

const { windows } = vi.hoisted(() => ({ windows: [] as FakeWindow[] }));
// The factory starts before the classes of this file exist, so it reads FakeWindow only when the capture makes a window
vi.mock("electron", () => ({
  BrowserWindow: class {
    constructor(options: unknown) {
      return new FakeWindow(options);
    }
  },
}));

const SITE = "https://a.example/";
const SIZE = { w: 100, h: 50 };
const capture = electronCapture({ timeoutMs: 5_000, paintDelayMs: 600, quality: 80 });

/** This function starts a capture, and gives its result and its fake window. */
function start(signal: AbortSignal = new AbortController().signal) {
  const result = capture(SITE, SIZE, signal);
  const window = windows.at(-1);
  if (window === undefined) throw new Error("no window");
  return { result, window, contents: window.webContents };
}

/** The picture of a JPEG with the text of the fake. */
const jpeg = (text: string): string => `data:image/jpeg;base64,${Buffer.from(text).toString("base64")}`;

beforeEach(() => {
  windows.length = 0;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("electronCapture", () => {
  it("mutes the window, opens no other window, and loads only the site", () => {
    const { contents } = start();
    expect([contents.muted, contents.frameRate, contents.loads]).toEqual([true, CAPTURE_FRAME_RATE, [SITE]]);
    expect(contents.openHandler?.()).toEqual({ action: "deny" });
    expect(contents.navigate("https://a.example/next")).toBe(false);
    expect(contents.navigate("file:///C:/secret.txt")).toBe(true);
  });

  it("gives the last painted frame after the paint delay, at most as wide as the window, and closes the window", async () => {
    const { result, window, contents } = start();
    contents.emit("paint", {}, {}, new FakeImage(300));
    contents.emit("paint", {}, {}, new FakeImage(200));
    contents.emit("did-finish-load");
    await vi.advanceTimersByTimeAsync(600);
    await expect(result).resolves.toEqual({ ok: true, picture: jpeg("jpeg 100 80"), url: "https://a.example/home", title: "Home" });
    expect(contents.capturePage).not.toHaveBeenCalled();
    expect(window.destroyed).toBe(true);
  });

  it("waits for the last load of a redirect, and captures the page when no frame came", async () => {
    const { result, contents } = start();
    contents.emit("did-finish-load");
    await vi.advanceTimersByTimeAsync(500);
    contents.emit("did-finish-load");
    await vi.advanceTimersByTimeAsync(500);
    expect(contents.capturePage).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    await expect(result).resolves.toMatchObject({ ok: true, picture: jpeg("jpeg 50 80") });
    expect(contents.capturePage).toHaveBeenCalledTimes(1);
  });

  it("gives network for a page with no picture, and for a picture that fails", async () => {
    const empty = start();
    empty.contents.capture = Promise.resolve(new FakeImage(50, true));
    empty.contents.emit("did-finish-load");
    await vi.advanceTimersByTimeAsync(600);
    await expect(empty.result).resolves.toEqual({ ok: false, reason: "network", detail: "The page painted no picture." });

    const broken = start();
    broken.contents.emit("paint", {}, {}, new FakeImage(80));
    broken.contents.emit("paint", {}, {}, new FakeImage(80, false, true));
    broken.contents.emit("did-finish-load");
    await vi.advanceTimersByTimeAsync(600);
    await expect(broken.result).resolves.toEqual({
      ok: false,
      reason: "network",
      detail: "The window painted 2 frames, and its capture failed: The encoder failed.",
    });
  });

  it("gives the reason of a failed load of the main frame, and ignores a frame and an aborted load", async () => {
    const { result, contents, window } = start();
    contents.emit("did-fail-load", {}, -3, "ERR_ABORTED", SITE, true);
    contents.emit("did-fail-load", {}, -102, "ERR_CONNECTION_REFUSED", SITE, false);
    expect(window.destroyed).toBe(false);
    contents.emit("did-fail-load", {}, -102, "ERR_CONNECTION_REFUSED", SITE, true);
    // A second end changes nothing
    contents.emit("render-process-gone", {}, { reason: "crashed" });
    await expect(result).resolves.toEqual({ ok: false, reason: "refused", detail: "ERR_CONNECTION_REFUSED (-102)" });
    expect(window.destroyed).toBe(true);
  });

  it("gives crashed when the page ends", async () => {
    const { result, contents } = start();
    contents.emit("render-process-gone", {}, { reason: "oom" });
    await expect(result).resolves.toEqual({ ok: false, reason: "crashed", detail: "oom" });
  });

  it("gives timeout after the time limit", async () => {
    const { result, window } = start();
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(result).resolves.toEqual({ ok: false, reason: "timeout", detail: "No picture in 5000 ms." });
    expect(window.destroyed).toBe(true);
  });

  it("stops at the signal, with the text of its reason", async () => {
    const stopper = new AbortController();
    const stopped = start(stopper.signal);
    stopper.abort(new Error("The host stopped."));
    await expect(stopped.result).resolves.toEqual({ ok: false, reason: "network", detail: "The host stopped." });
    expect(stopped.window.destroyed).toBe(true);

    const other = new AbortController();
    const plain = start(other.signal);
    other.abort("no reason");
    await expect(plain.result).resolves.toEqual({ ok: false, reason: "network", detail: "The capture stopped." });

    const early = new AbortController();
    early.abort(new Error("Too late."));
    const before = start(early.signal);
    await expect(before.result).resolves.toEqual({ ok: false, reason: "network", detail: "Too late." });
    expect([before.window.destroyed, before.contents.loads]).toEqual([true, []]);
  });

  it("ignores a picture that comes after the end, and keeps a window that closed", async () => {
    const stopper = new AbortController();
    const { result, contents, window } = start(stopper.signal);
    let give: (image: FakeImage) => void = () => undefined;
    contents.capture = new Promise((resolve) => (give = resolve));
    contents.emit("did-finish-load");
    await vi.advanceTimersByTimeAsync(600);
    window.destroyed = true;
    const destroy = vi.spyOn(window, "destroy");
    stopper.abort();
    give(new FakeImage(50));
    await expect(result).resolves.toMatchObject({ ok: false, reason: "network" });
    await vi.runAllTimersAsync();
    expect(destroy).not.toHaveBeenCalled();
  });
});

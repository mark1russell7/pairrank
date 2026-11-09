// @vitest-environment happy-dom
// @vitest-environment-options {"happyDOM": {"settings": {"disableIframePageLoading": true}}}
import { afterEach, describe, expect, it, vi } from "vitest";
import { FRAME_SANDBOX, domFrames } from "./dom-frames.ts";

/** This function gives the container of the frames, in the page of the test. */
function containerOf(): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  return container;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("domFrames", () => {
  it("makes a hidden iframe with the sandbox, no referrer and no permissions", () => {
    const container = containerOf();
    domFrames(container)("https://a.example/", () => undefined);
    const frame = container.querySelector("iframe");
    expect(frame?.getAttribute("src")).toBe("https://a.example/");
    expect(frame?.getAttribute("sandbox")).toBe(FRAME_SANDBOX.join(" "));
    expect(frame?.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(frame?.getAttribute("allow")).toBe("");
    expect(frame?.getAttribute("loading")).toBe("eager");
    expect(frame?.style.position).toBe("fixed");
    expect(frame?.style.display).toBe("none");
  });

  it("gives no allow-same-origin to a site of the origin of the page", () => {
    const container = containerOf();
    domFrames(container)(`${location.origin}/a`, () => undefined);
    const tokens = container.querySelector("iframe")?.getAttribute("sandbox")?.split(" ");
    expect(tokens).not.toContain("allow-same-origin");
    expect(tokens).toContain("allow-scripts");
  });

  it("puts the frame on a box of the window, and hides it", () => {
    const container = containerOf();
    const frame = domFrames(container)("https://a.example/", () => undefined);
    const element = container.querySelector("iframe");
    frame.place({ x: 10, y: 20.5, w: 300, h: 200 });
    expect([element?.style.display, element?.style.left, element?.style.top, element?.style.width, element?.style.height]).toEqual(["block", "10px", "20.5px", "300px", "200px"]);
    frame.place(undefined);
    expect(element?.style.display).toBe("none");
  });

  it("starts loaded at each load event, and removes the frame and its listener", () => {
    const container = containerOf();
    const loaded = vi.fn();
    const frame = domFrames(container)("https://a.example/", loaded);
    const element = container.querySelector("iframe");
    const before = loaded.mock.calls.length;
    element?.dispatchEvent(new Event("load"));
    expect(loaded.mock.calls.length).toBe(before + 1);
    frame.remove();
    element?.dispatchEvent(new Event("load"));
    expect(loaded.mock.calls.length).toBe(before + 1);
    expect(container.querySelector("iframe")).toBeNull();
  });
});

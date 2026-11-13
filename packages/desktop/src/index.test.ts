import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CONTENT_SECURITY_POLICY, PAGE_URL, SITE_PARTITION, allowsNavigation, allowsSiteNavigation, captureWindowOptions, contentType, failureOf, navigationOf, pageFile, returnsKeys, siteViewPreferences, tabAfterClose, viewBounds, windowOptions } from "./index.ts";

const root = resolve("build", "page");

describe("windowOptions", () => {
  it("gives the page no Node.js, a sandbox and an isolated preload script", () => {
    const { webPreferences } = windowOptions("preload.cjs");
    expect(webPreferences).toMatchObject({
      preload: "preload.cjs",
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
    });
  });
});

describe("allowsNavigation", () => {
  it("keeps the window at the origin of its page", () => {
    expect(allowsNavigation(PAGE_URL, "app://page/settings.html")).toBe(true);
    expect(allowsNavigation(PAGE_URL, "app://other/index.html")).toBe(false);
    expect(allowsNavigation(PAGE_URL, "https://example.com/")).toBe(false);
    expect(allowsNavigation("http://localhost:5173/", "http://localhost:5173/a")).toBe(true);
    expect(allowsNavigation("http://localhost:5173/", "http://localhost:5174/")).toBe(false);
    expect(allowsNavigation(PAGE_URL, "not an address")).toBe(false);
  });
});

describe("pageFile", () => {
  it("gives the file of the page, and index.html for the root", () => {
    expect(pageFile(root, "app://page/page.js")).toBe(join(root, "page.js"));
    expect(pageFile(root, "app://page/")).toBe(join(root, "index.html"));
    expect(pageFile(root, "app://page/a%20b.css")).toBe(join(root, "a b.css"));
  });

  it("refuses a path out of the folder, another host and another scheme", () => {
    expect(pageFile(root, "app://page/..%2F..%2Fsecret.txt")).toBeUndefined();
    expect(pageFile(root, "app://page/..%5C..%5Csecret.txt")).toBeUndefined();
    expect(pageFile(root, "app://page/%00.js")).toBeUndefined();
    expect(pageFile(root, "app://page/%E0%A4%A")).toBeUndefined();
    expect(pageFile(root, "app://other/index.html")).toBeUndefined();
    expect(pageFile(root, "file:///etc/passwd")).toBeUndefined();
  });
});

describe("contentType", () => {
  it("gives a JavaScript type to a module script", () => {
    expect(contentType("page.js")).toBe("text/javascript; charset=utf-8");
    expect(contentType("INDEX.HTML")).toBe("text/html; charset=utf-8");
    expect(contentType("data.bin")).toBe("application/octet-stream");
  });
});

describe("the policy and the port", () => {
  it("allows no inline script and no connection", () => {
    expect(CONTENT_SECURITY_POLICY).toContain("default-src 'none'");
    expect(CONTENT_SECURITY_POLICY).toContain("script-src 'self'");
    expect(CONTENT_SECURITY_POLICY).not.toContain("unsafe");
  });

});

describe("the views of the sites", () => {
  it("give a site no preload script, no Node.js, a sandbox and its own session", () => {
    const preferences = siteViewPreferences();
    expect(preferences).toMatchObject({ partition: SITE_PARTITION, contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, webviewTag: false });
    expect(preferences.preload).toBeUndefined();
    expect(SITE_PARTITION).not.toBe("");
  });

  it("let a site go only to web addresses", () => {
    expect(allowsSiteNavigation("https://a.example/next")).toBe(true);
    expect(allowsSiteNavigation("http://a.example/")).toBe(true);
    for (const url of ["file:///C:/secret.txt", "app://page/index.html", "javascript:alert(1)", "chrome://settings", "not an address"]) expect(allowsSiteNavigation(url), url).toBe(false);
  });

  it("let the redirects of the first load go, and then block each navigation of a locked slot", () => {
    const next = "https://a.example/next";
    expect(navigationOf(next, true, false)).toBe("allow");
    expect(navigationOf(next, true, true)).toBe("block");
    expect(navigationOf(next, false, true)).toBe("allow");
    // A target that is not a web address is refused, locked or not
    for (const [locked, armed] of [[true, true], [false, false]] as const) expect(navigationOf("file:///C:/secret.txt", locked, armed)).toBe("refuse");
  });

  it("show the tab before a closed open tab, and keep the site tab", () => {
    expect(tabAfterClose([0, 3, 5], 5, 5)).toBe(3);
    expect(tabAfterClose([0, 3, 5], 3, 3)).toBe(0);
    expect(tabAfterClose([0, 3, 5], 5, 3)).toBe(5);
    expect(tabAfterClose([0, 3, 5], 3, 0)).toBe(3);
    expect(tabAfterClose([0, 3], 3, 9)).toBe(3);
  });

  it("give a reason for each failed load, and no reason for a replaced load", () => {
    expect(failureOf(-3)).toBeUndefined();
    expect(failureOf(-118)).toBe("timeout");
    expect(failureOf(-7)).toBe("timeout");
    expect(failureOf(-102)).toBe("refused");
    expect(failureOf(-27)).toBe("refused");
    expect(failureOf(-105)).toBe("network");
    expect(failureOf(-200)).toBe("network");
  });

  it("round each edge of a box, so two boxes that touch still touch", () => {
    expect(viewBounds({ x: 8.4, y: 44.6, w: 600.4, h: 700 }, 1)).toEqual({ x: 8, y: 45, width: 601, height: 700 });
    const left = viewBounds({ x: 0.5, y: 0, w: 300.3, h: 10 }, 1);
    const right = viewBounds({ x: 300.8, y: 0, w: 300, h: 10 }, 1);
    expect(left.x + left.width).toBe(right.x);
    expect(viewBounds({ x: 3.2, y: 0, w: 0.1, h: 0 }, 1)).toEqual({ x: 3, y: 0, width: 0, height: 0 });
  });

  it("scale a box of the page by its zoom before the rounding (B4)", () => {
    // At 125%, a slot of 400 by 300 CSS pixels at (10, 44) covers 500 by 375 pixels of the window at (12.5, 55)
    expect(viewBounds({ x: 10, y: 44, w: 400, h: 300 }, 1.25)).toEqual({ x: 13, y: 55, width: 500, height: 375 });
    expect(viewBounds({ x: 10, y: 44, w: 400, h: 300 }, 0.9)).toEqual({ x: 9, y: 40, width: 360, height: 270 });
    // Two slots that touch still touch at a zoom
    const left = viewBounds({ x: 0, y: 0, w: 333.3, h: 10 }, 1.1);
    const right = viewBounds({ x: 333.3, y: 0, w: 333.3, h: 10 }, 1.1);
    expect(left.x + left.width).toBe(right.x);
    expect(() => viewBounds({ x: 0, y: 0, w: 1, h: 1 }, Number.NaN)).toThrow(RangeError);
  });

  it("give the keys back to the page with Escape and no modifier", () => {
    const key = { type: "keyDown", key: "Escape", control: false, alt: false, meta: false };
    expect(returnsKeys(key)).toBe(true);
    expect(returnsKeys({ ...key, type: "keyUp" })).toBe(false);
    expect(returnsKeys({ ...key, control: true })).toBe(false);
    expect(returnsKeys({ ...key, key: "ArrowLeft" })).toBe(false);
  });
});

describe("captureWindowOptions", () => {
  it("renders off the screen, with the size of the capture and the rules of the views of the sites", () => {
    const options = captureWindowOptions({ w: 1280, h: 800 });
    expect(options).toMatchObject({ width: 1280, height: 800, useContentSize: true, show: false, skipTaskbar: true, focusable: false });
    expect(options.webPreferences).toEqual({ ...siteViewPreferences(), offscreen: true });
  });
});

import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CONTENT_SECURITY_POLICY, PAGE_URL, SITE_PARTITION, allowsNavigation, allowsSiteNavigation, boundsOf, contentType, failureOf, pageFile, portOf, returnsKeys, siteViewPreferences, windowOptions } from "./index.ts";

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
    expect(boundsOf({ x: 8.4, y: 44.6, w: 600.4, h: 700 })).toEqual({ x: 8, y: 45, width: 601, height: 700 });
    const left = boundsOf({ x: 0.5, y: 0, w: 300.3, h: 10 });
    const right = boundsOf({ x: 300.8, y: 0, w: 300, h: 10 });
    expect(left.x + left.width).toBe(right.x);
    expect(boundsOf({ x: 3.2, y: 0, w: 0.1, h: 0 })).toEqual({ x: 3, y: 0, width: 0, height: 0 });
  });

  it("give the keys back to the page with Escape and no modifier", () => {
    const key = { type: "keyDown", key: "Escape", control: false, alt: false, meta: false };
    expect(returnsKeys(key)).toBe(true);
    expect(returnsKeys({ ...key, type: "keyUp" })).toBe(false);
    expect(returnsKeys({ ...key, control: true })).toBe(false);
    expect(returnsKeys({ ...key, key: "ArrowLeft" })).toBe(false);
  });
});

describe("portOf", () => {
  it("gives the message of an event of a main port, in the form of the Node ports", () => {
    const sent: unknown[] = [];
    let listener: (event: { readonly data: unknown }) => void = () => {};
    let started = false;
    const port = portOf({ postMessage: (message) => sent.push(message), on: (_type, each) => (listener = each), start: () => (started = true) });
    const received: unknown[] = [];
    port.on("message", (data) => received.push(data));
    port.start();
    port.postMessage({ type: "call" });
    listener({ data: { type: "result" } });
    expect([sent, received, started]).toEqual([[{ type: "call" }], [{ type: "result" }], true]);
  });
});

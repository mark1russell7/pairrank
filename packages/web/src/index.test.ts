/**
 * The browser host on a free port, with a log in memory and a page folder of the test.
 *
 * - The page comes with its content security policy. A route of the page gives `index.html`.
 * - The procedures of `@pairrank/host` and `frames.check` answer under `/api`.
 * - The browser checks refuse a call from a page of another origin.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Lifecycle } from "@mark1russell7/service";
import { fakeProcess } from "@mark1russell7/service/testing";
import { openStore } from "@pairrank/store";
import { Client, HttpTransport, pathToMethod } from "@procedures/client";
import { runProcedureHost } from "@procedures/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { API_PATH, CONTENT_SECURITY_POLICY, webHost } from "./index.ts";

const PAGE = "<!doctype html><title>pairrank</title><div id=root></div>";

let folder: string;
let origin: string;
let life: Lifecycle;
const store = openStore(":memory:");

beforeAll(async () => {
  folder = mkdtempSync(join(tmpdir(), "pairrank-web-"));
  writeFileSync(join(folder, "index.html"), PAGE);
  writeFileSync(join(folder, "page.js"), "export {};");
  const running = await runProcedureHost({
    name: "pairrank-web-test",
    host: webHost({ store, page: folder, port: 0, chromeFolders: [join(folder, "chrome")] }),
    mode: "foreground",
    run: { process: fakeProcess() },
  });
  life = running.life;
  const page = running.host.info.endpoints().find((endpoint) => endpoint.type === "static");
  if (page === undefined) throw new Error("The host has no endpoint of the page.");
  origin = new URL(page.address).origin;
}, 20_000);

afterAll(async () => {
  await life.shutdown("the test ended");
  await life.done;
  store.close();
  rmSync(folder, { recursive: true, force: true });
});

/** This function gives a client of the procedures of the host, with more headers. */
function clientOf(headers: Record<string, string> = {}) {
  const client = new Client(new HttpTransport({ baseUrl: `${origin}${API_PATH}`, defaultHeaders: headers }));
  return <T>(path: string[], input: unknown) => client.call<unknown, T>(pathToMethod(path), input);
}

describe("the browser host", () => {
  it("serves the page with its content security policy, and a route of the page gives index.html", async () => {
    for (const path of ["/", "/duel"]) {
      const got = await fetch(`${origin}${path}`, { headers: { accept: "text/html" } });
      expect(got.status).toBe(200);
      expect(got.headers.get("content-security-policy")).toBe(CONTENT_SECURITY_POLICY);
      expect(got.headers.get("referrer-policy")).toBe("no-referrer");
      expect(await got.text()).toBe(PAGE);
    }
    const script = await fetch(`${origin}/page.js`);
    expect(script.headers.get("content-type")).toMatch(/javascript/);
    expect((await fetch(`${origin}/missing.js`)).status).toBe(404);
  });

  it("answers the procedures of the host and the frame check under the API path", async () => {
    const call = clientOf();
    const view = await call<{ sites: unknown[] }>(["pairrank", "view"], {});
    expect(view.sites).toEqual([]);
    expect(await call(["frames", "check"], { url: "javascript:alert(1)" })).toMatchObject({ ok: false, reason: "not-web" });
    await expect(call(["frames", "check"], { url: "" })).rejects.toThrow();
  });

  it("answers the bookmarks procedures with the folders of the options", async () => {
    const call = clientOf();
    expect(await call(["bookmarks", "sources"], {})).toEqual([]);
  });

  it("refuses a call from a page of another origin", async () => {
    const call = clientOf({ origin: "https://other.example" });
    await expect(call(["pairrank", "view"], {})).rejects.toThrow();
  });

  it("puts each frame rule of the page in its policy", () => {
    expect(CONTENT_SECURITY_POLICY).toContain("frame-src http: https:");
    expect(CONTENT_SECURITY_POLICY).toContain("frame-ancestors 'none'");
    expect(CONTENT_SECURITY_POLICY).toContain("connect-src 'self'");
  });
});

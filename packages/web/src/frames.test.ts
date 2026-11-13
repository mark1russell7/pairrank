/**
 * The frame check of the browser host, with a fake `fetch`.
 *
 * - An address that is not `http` or `https` fails before a request.
 * - The check reads the headers with `HEAD`, and a server that refuses `HEAD` gets a `GET`.
 * - `frame-ancestors` and `X-Frame-Options` refuse with a detail. The address after the redirects comes back.
 * - The host policy refuses a private address. Then the check passes, and the browser decides.
 * - The end of the time limit gives `timeout`, and another error gives `network`.
 */
import { MAX_URL } from "@pairrank/surfaces";
import { callerOf } from "@procedures/client";
import { createHostFetch } from "@procedures/http";
import type { HostFetch, HostFetchInit, HostFetchResponse } from "@procedures/http";
import { describe, expect, it } from "vitest";
import { frameCheck, framesModule } from "./frames.ts";

const ANCESTOR = "http://127.0.0.1:4800";

/** This function gives a response with a status, headers and the address after the redirects. */
function response(url: string, status: number, headers: Record<string, string> = {}): HostFetchResponse {
  return { ok: status < 400, status, url, headers, text: async () => "", json: async () => null };
}

/** This function gives a fake `fetch`, and the requests that it got. */
function fakeFetch(answer: (url: string, init: HostFetchInit | undefined) => HostFetchResponse | Promise<HostFetchResponse>) {
  const requests: { url: string; method: string }[] = [];
  const fetch: HostFetch = async (url, init) => {
    requests.push({ url, method: init?.method ?? "GET" });
    return answer(url, init);
  };
  return { fetch, requests };
}

const checkWith = (fetch: HostFetch) => frameCheck({ fetch, ancestor: ANCESTOR, timeoutMs: 1_000 });

describe("frameCheck", () => {
  it("refuses an address that is not http or https, with no request", async () => {
    const { fetch, requests } = fakeFetch((url) => response(url, 200));
    expect(await checkWith(fetch)("file:///C:/secret.txt")).toEqual({ ok: false, reason: "not-web" });
    expect(requests).toEqual([]);
  });

  it("passes a site with no frame rules, and gives the address after the redirects", async () => {
    const { fetch, requests } = fakeFetch(() => response("https://www.example.com/", 200));
    expect(await checkWith(fetch)("https://example.com/")).toEqual({ ok: true, url: "https://www.example.com/" });
    expect(requests).toEqual([{ url: "https://example.com/", method: "HEAD" }]);
  });

  it("refuses a site with X-Frame-Options or frame-ancestors, with a detail", async () => {
    const deny = fakeFetch((url) => response(url, 200, { "x-frame-options": "DENY" }));
    const denied = await checkWith(deny.fetch)("https://a.example/");
    expect(denied).toMatchObject({ ok: false, reason: "refused" });
    expect(denied.ok === false && denied.detail).toMatch(/X-Frame-Options/);

    const self = fakeFetch((url) => response(url, 200, { "content-security-policy": "frame-ancestors 'self'" }));
    expect(await checkWith(self.fetch)("https://b.example/")).toMatchObject({ ok: false, reason: "refused" });

    const named = fakeFetch((url) => response(url, 200, { "content-security-policy": `frame-ancestors ${ANCESTOR}` }));
    expect(await checkWith(named.fetch)("https://c.example/")).toEqual({ ok: true, url: "https://c.example/" });
  });

  it("sends a GET when the server refuses HEAD with 405 or 501", async () => {
    for (const status of [405, 501]) {
      const { fetch, requests } = fakeFetch((url, init) => (init?.method === "HEAD" ? response(url, status) : response(url, 200, { "x-frame-options": "SAMEORIGIN" })));
      expect(await checkWith(fetch)("https://d.example/")).toMatchObject({ ok: false, reason: "refused" });
      expect(requests.map((request) => request.method)).toEqual(["HEAD", "GET"]);
    }
  });

  it("passes an address that the host policy refuses, with no connection", async () => {
    // The default policy of createHostFetch refuses loopback before a connection, so the test uses no network.
    expect(await checkWith(createHostFetch())("http://127.0.0.1:9/")).toEqual({ ok: true });
  });

  it("gives timeout at the end of the time limit, and network for another error", async () => {
    const slow = fakeFetch(() => Promise.reject(new DOMException("The operation timed out.", "TimeoutError")));
    expect(await checkWith(slow.fetch)("https://e.example/")).toEqual({ ok: false, reason: "timeout", detail: "The operation timed out." });

    const broken = fakeFetch(() => Promise.reject(new Error("connect ECONNREFUSED")));
    expect(await checkWith(broken.fetch)("https://f.example/")).toEqual({ ok: false, reason: "network", detail: "connect ECONNREFUSED" });
  });

  it("gives each request the time limit as a signal", async () => {
    const signals: (AbortSignal | undefined)[] = [];
    const fetch: HostFetch = async (url, init) => {
      signals.push(init?.signal);
      return response(url, 200);
    };
    await checkWith(fetch)("https://g.example/");
    expect(signals).toHaveLength(1);
    expect(signals[0]).toBeInstanceOf(AbortSignal);
  });
});

describe("the input of frames.check", () => {
  const checked: string[] = [];
  const call = callerOf(
    framesModule(async (url) => {
      checked.push(url);
      return { ok: true };
    }),
  );

  it("passes an address of 1 to MAX_URL characters to the check", async () => {
    expect(await call(["frames", "check"], { url: "https://a.example/" })).toEqual({ ok: true });
    expect(checked).toEqual(["https://a.example/"]);
  });

  it("refuses a wrong type, a missing address, an empty or a very long address and an extra field", async () => {
    const message = `The address of a frame check is a text of 1 to ${MAX_URL} characters.`;
    for (const input of [{ url: 5 }, {}, { url: "" }, { url: `https://a.example/${"a".repeat(MAX_URL)}` }]) await expect(call(["frames", "check"], input), JSON.stringify(input).slice(0, 40)).rejects.toThrow(message);
    await expect(call(["frames", "check"], "https://a.example/")).rejects.toThrow(/expected object/);
    await expect(call(["frames", "check"], { url: "https://a.example/", ancestor: "https://b.example" })).rejects.toThrow(/Unrecognized key/);
    expect(checked).toEqual(["https://a.example/"]);
  });
});

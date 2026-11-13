import { type CaptureResult, MAX_URL, type PictureSize } from "@pairrank/surfaces";
import { callerOf } from "@procedures/client";
import { describe, expect, it } from "vitest";
import { type AddressLookup, REPLACED, STOPPED, type StoppableCapture, capturePool, hostRefusal, isLocalName, picturesModule, publicCapture } from "./pictures.ts";

const size: PictureSize = { w: 1280, h: 800 };
const PICTURE = "data:image/jpeg;base64,/9j/";

/** A capture that a test ends by hand, with the calls that it got. */
function handRun() {
  const calls: { url: string; signal: AbortSignal; end(result: CaptureResult): void }[] = [];
  const run: StoppableCapture = (url, _size, signal) => new Promise((resolve) => calls.push({ url, signal, end: resolve }));
  return { run, calls };
}

describe("capturePool", () => {
  it("stops the oldest capture when a new capture comes and the pool is full", async () => {
    const { run, calls } = handRun();
    const pool = capturePool(run, 2);
    const first = pool.capture("https://a.example/", size);
    const second = pool.capture("https://b.example/", size);
    const third = pool.capture("https://c.example/", size);
    await Promise.resolve();
    expect(calls.map((call) => [call.url, call.signal.aborted])).toEqual([
      ["https://a.example/", true],
      ["https://b.example/", false],
      ["https://c.example/", false],
    ]);
    expect(await first).toEqual({ ok: false, reason: "network", detail: REPLACED });
    calls[1]?.end({ ok: true, picture: PICTURE });
    calls[2]?.end({ ok: false, reason: "refused" });
    expect(await second).toEqual({ ok: true, picture: PICTURE });
    expect(await third).toEqual({ ok: false, reason: "refused" });
    // The pool has room again, so a new capture stops nothing
    const fourth = pool.capture("https://d.example/", size);
    await Promise.resolve();
    expect(calls.map((call) => call.signal.aborted)).toEqual([true, false, false, false]);
    calls[3]?.end({ ok: true, picture: PICTURE });
    await fourth;
  });

  it("stops each capture, and gives a failure for a capture that throws", async () => {
    const { run, calls } = handRun();
    const pool = capturePool(run, 2);
    const open = pool.capture("https://a.example/", size);
    pool.stop();
    expect(await open).toEqual({ ok: false, reason: "network", detail: STOPPED });
    expect(calls[0]?.signal.aborted).toBe(true);

    const throwing = capturePool(() => {
      throw new Error("No window.");
    }, 1);
    expect(await throwing.capture("https://a.example/", size)).toEqual({ ok: false, reason: "network", detail: "No window." });
    expect(() => capturePool(run, 0)).toThrow(RangeError);
  });
});

describe("picturesModule", () => {
  it("gives the capture of the host to the caller of the procedure pictures.capture", async () => {
    const asked: [string, PictureSize][] = [];
    const caller = callerOf(
      picturesModule(async (url, at) => {
        asked.push([url, at]);
        return { ok: true, picture: PICTURE, title: "A" };
      }),
    );
    expect(await caller(["pictures", "capture"], { url: "https://a.example/", size })).toEqual({ ok: true, picture: PICTURE, title: "A" });
    expect(asked).toEqual([["https://a.example/", size]]);
  });

  it("refuses an address that is not http or https, and a size out of its range", async () => {
    const caller = callerOf(picturesModule(async () => ({ ok: true, picture: PICTURE })));
    await expect(caller(["pictures", "capture"], { url: "file:///etc/hosts", size })).rejects.toThrow("http or https");
    await expect(caller(["pictures", "capture"], { url: "javascript:alert(1)", size })).rejects.toThrow("http or https");
    await expect(caller(["pictures", "capture"], { url: "https://a.example/", size: { w: 10, h: 800 } })).rejects.toThrow("integers from 64 to 4096");
    await expect(caller(["pictures", "capture"], { url: "https://a.example/", size: { w: 1280.5, h: 800 } })).rejects.toThrow("integers");
    await expect(caller(["pictures", "capture"], { url: "https://a.example/" })).rejects.toThrow("integers");
  });
});

describe("isLocalName", () => {
  it("knows the names of this computer and of the local network, also with a final dot and in capitals", () => {
    for (const name of ["localhost", "LOCALHOST", "localhost.", "app.localhost", "printer.local", "db.internal", "router.home.arpa"]) expect(isLocalName(name), name).toBe(true);
    for (const name of ["example.com", "localhost.example.com", "local.example", "mylocal", "internal.example.org"]) expect(isLocalName(name), name).toBe(false);
  });
});

describe("hostRefusal", () => {
  it("passes a public name and a public address", () => {
    for (const url of ["https://a.example/", "http://93.184.215.14/", "https://[2606:4700::6810:84e5]/", "https://8.8.8.8:8443/x"]) expect(hostRefusal(url), url).toBeUndefined();
  });

  it("refuses a name of this computer or of the local network", () => {
    for (const url of ["http://localhost/", "http://localhost.:8080/", "https://app.localhost/", "http://printer.local/", "http://nas.home.arpa/"]) {
      expect(hostRefusal(url), url).toMatch(/is a name of this computer or of the local network/);
    }
  });

  it("refuses each address that is not public, in each form that the URL parser accepts", () => {
    // Each address, and a part of the refusal: the class of the address, or the address as the URL parser writes it
    const refused: Record<string, string> = {
      "http://127.0.0.1/": "loopback",
      "http://127.8.9.10/": "loopback",
      "http://2130706433/": "127.0.0.1",
      "http://0x7f.1/": "127.0.0.1",
      "http://127.1/": "127.0.0.1",
      "http://[::1]/": "loopback",
      "http://10.0.0.1/": "private",
      "http://172.16.0.1/": "private",
      "http://172.31.255.255/": "private",
      "http://192.168.1.1/": "private",
      "http://[fc00::1]/": "fc00::1",
      "http://[fd12:3456::1]/": "fd12:3456::1",
      "http://169.254.169.254/": "link-local",
      "http://[fe80::1]/": "link-local",
      "http://0.0.0.0/": "0.0.0.0",
      "http://0/": "0.0.0.0",
      "http://[::]/": "[::]",
      "http://[::ffff:127.0.0.1]/": "[::ffff:7f00:1]",
      "http://[::ffff:10.0.0.1]/": "[::ffff:a00:1]",
      "http://[::ffff:192.168.0.1]/": "[::ffff:c0a8:1]",
    };
    for (const [url, part] of Object.entries(refused)) {
      const refusal = hostRefusal(url);
      expect(refusal, url).toMatch(/^A still picture shows only a public site\. The address .* is not public/);
      expect(refusal, url).toContain(part);
    }
    // The ranges end where they must: 172.32.0.1 and 11.0.0.1 are public
    expect(hostRefusal("http://172.32.0.1/")).toBeUndefined();
    expect(hostRefusal("http://11.0.0.1/")).toBeUndefined();
  });

  it("passes only the hosts of the allow list, as the URL parser writes them", () => {
    expect(hostRefusal("http://127.0.0.1:4800/b", ["127.0.0.1"])).toBeUndefined();
    expect(hostRefusal("http://2130706433/", ["127.0.0.1"])).toBeUndefined();
    expect(hostRefusal("http://[::1]/", ["127.0.0.1"])).toMatch(/not public/);
    expect(hostRefusal("http://localhost/", ["127.0.0.1"])).toMatch(/name of this computer/);
    expect(hostRefusal("not an address")).toMatch(/not a valid address/);
  });
});

describe("publicCapture", () => {
  const picture = async (): Promise<CaptureResult> => ({ ok: true, picture: PICTURE });
  const signal = new AbortController().signal;

  it("captures a name with only public addresses, and refuses a name with an address that is not public", async () => {
    const asked: string[] = [];
    const lookup: AddressLookup = async (hostname) => {
      asked.push(hostname);
      return hostname === "a.example" ? [{ address: "93.184.215.14" }] : [{ address: "93.184.215.14" }, { address: "10.0.0.7" }];
    };
    const capture = publicCapture(picture, lookup);
    expect(await capture("https://a.example/", size, signal)).toEqual({ ok: true, picture: PICTURE });
    expect(await capture("https://inside.example/", size, signal)).toEqual({
      ok: false,
      reason: "network",
      detail: "A still picture shows only a public site. The host inside.example has the address 10.0.0.7, which is not public.",
    });
    expect(asked).toEqual(["a.example", "inside.example"]);
  });

  it("refuses a local host with no lookup, looks up no IP address, and captures when the lookup fails", async () => {
    const asked: string[] = [];
    const lookup: AddressLookup = async (hostname) => {
      asked.push(hostname);
      throw new Error("ENOTFOUND");
    };
    const capture = publicCapture(picture, lookup);
    expect(await capture("http://localhost:3000/", size, signal)).toMatchObject({ ok: false, reason: "network" });
    expect(await capture("http://192.168.1.1/", size, signal)).toMatchObject({ ok: false, reason: "network" });
    expect(await capture("http://8.8.8.8/", size, signal)).toEqual({ ok: true, picture: PICTURE });
    expect(asked).toEqual([]);
    expect(await capture("https://gone.example/", size, signal)).toEqual({ ok: true, picture: PICTURE });
    expect(asked).toEqual(["gone.example"]);
  });
});

describe("the input of pictures.capture", () => {
  const caller = callerOf(picturesModule(async () => ({ ok: true, picture: PICTURE })));
  const local = callerOf(picturesModule(async () => ({ ok: true, picture: PICTURE }), { allow: ["127.0.0.1"] }));

  it("refuses a host of this computer or of the local network before the capture", async () => {
    await expect(caller(["pictures", "capture"], { url: "http://127.0.0.1:8080/", size })).rejects.toThrow(/is not public \(loopback\)/);
    await expect(caller(["pictures", "capture"], { url: "http://169.254.169.254/latest/meta-data/", size })).rejects.toThrow(/not public \(link-local\)/);
    await expect(caller(["pictures", "capture"], { url: "http://router.local/", size })).rejects.toThrow(/name of this computer/);
    expect(await local(["pictures", "capture"], { url: "http://127.0.0.1:8080/", size })).toEqual({ ok: true, picture: PICTURE });
    await expect(local(["pictures", "capture"], { url: "http://192.168.0.1/", size })).rejects.toThrow(/not public \(private\)/);
  });

  it("refuses a wrong type, a missing field, an extra field and a very long address", async () => {
    await expect(caller(["pictures", "capture"], { url: 42, size })).rejects.toThrow("http or https");
    await expect(caller(["pictures", "capture"], { size })).rejects.toThrow("http or https");
    await expect(caller(["pictures", "capture"], "https://a.example/")).rejects.toThrow();
    await expect(caller(["pictures", "capture"], { url: "https://a.example/", size: "1280x800" })).rejects.toThrow("integers from 64 to 4096");
    await expect(caller(["pictures", "capture"], { url: "https://a.example/", size, picture: "x" })).rejects.toThrow(/Unrecognized key/);
    await expect(caller(["pictures", "capture"], { url: "https://a.example/", size: { ...size, d: 2 } })).rejects.toThrow(/Unrecognized key/);
    await expect(caller(["pictures", "capture"], { url: `https://a.example/${"a".repeat(MAX_URL)}`, size })).rejects.toThrow(`${MAX_URL} characters or fewer`);
  });
});

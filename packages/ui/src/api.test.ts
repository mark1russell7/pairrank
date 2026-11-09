// The calls of the page reach the procedures of the host: the capture of a still picture.
import { picturesModule } from "@pairrank/host/pictures";
import type { PictureSize } from "@pairrank/surfaces";
import { callerOf } from "@procedures/client";
import { describe, expect, it } from "vitest";
import { captureApiOf } from "./api.ts";

const size: PictureSize = { w: 1280, h: 800 };
const PICTURE = "data:image/jpeg;base64,/9j/";

describe("captureApiOf", () => {
  it("gives the capture of the host through the procedure pictures.capture", async () => {
    const asked: [string, PictureSize][] = [];
    const caller = callerOf(
      picturesModule(async (url, at) => {
        asked.push([url, at]);
        return { ok: true, picture: PICTURE, title: "A" };
      }),
    );
    const capture = captureApiOf((path, input) => caller(path, input));
    expect(await capture("https://a.example/", size)).toEqual({ ok: true, picture: PICTURE, title: "A" });
    expect(asked).toEqual([["https://a.example/", size]]);
  });
});

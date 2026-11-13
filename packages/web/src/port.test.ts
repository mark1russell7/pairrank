import { describe, expect, it } from "vitest";
import { DEFAULT_PORT } from "./index.ts";
import { portOf } from "./port.ts";

describe("portOf", () => {
  it("gives the default port with no variable, and the port of a valid text", () => {
    expect(portOf(undefined)).toBe(DEFAULT_PORT);
    expect(portOf("0")).toBe(0);
    expect(portOf("65535")).toBe(65535);
  });

  it("refuses a text that is not a port", () => {
    for (const text of ["x", "1.5", "-1", "65536"]) expect(() => portOf(text), text).toThrow(`PORT is not a port: ${text}`);
  });
});

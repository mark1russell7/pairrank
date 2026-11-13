import { describe, expect, it } from "vitest";
import { wordSearch } from "./search.ts";

describe("wordSearch", () => {
  it("agrees with a text that has each word, in any case and in any order", () => {
    const has = wordSearch("  News  daily ");
    expect(has("The Daily News")).toBe(true);
    expect(has("dailynews")).toBe(true);
    expect(has("Daily sport")).toBe(false);
  });

  it("agrees with each text for a search with no words", () => {
    expect(wordSearch("")("anything")).toBe(true);
    expect(wordSearch(" \t ")("")).toBe(true);
  });
});

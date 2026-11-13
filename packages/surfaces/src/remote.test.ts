import type { Rect } from "@mark1russell7/layout-contract";
import { describe, expect, it } from "vitest";
import { type SlotHost, type SurfaceCommand, MAX_SLOT, MAX_URL, applyCommand, parseAction, parseCommand, remoteSurface } from "./remote.ts";
import { type SlotAction, type SurfaceEvent, refusalOf, trackSlots } from "./surface.ts";

const url = "https://a.example/";

/** The page and a fake main process, joined as a port joins them: each command is a structured clone. */
function loop() {
  const boxes = new Map<string, Rect | undefined>();
  const commands: SurfaceCommand[] = [];
  const actions: { slot: string; load: number; action: SlotAction }[] = [];
  let toPage: (event: SurfaceEvent) => void = () => {};
  const host: SlotHost = {
    show(slot, address, load) {
      const reason = refusalOf(address);
      toPage(reason === undefined ? { type: "loading", slot, load, url: address } : { type: "failed", slot, load, url: address, reason });
    },
    place: (slot, box) => void boxes.set(slot, box),
    clear: (slot, load) => toPage({ type: "cleared", slot, load }),
    act: (slot, load, action) => void actions.push({ slot, load, action }),
  };
  const remote = remoteSurface((command) => {
    const received = parseCommand(structuredClone(command));
    commands.push(received);
    applyCommand(host, received);
  });
  toPage = (event) => remote.receive(structuredClone(event));
  return { remote, boxes, commands, actions, emit: (event: SurfaceEvent) => toPage(event) };
}

describe("remoteSurface", () => {
  it("gives the load number at once, and the main process uses the same number", () => {
    const { remote, commands, emit } = loop();
    const slots = trackSlots(remote.surface);
    expect(remote.surface.show("a", url)).toBe(1);
    expect(remote.surface.show("a", "https://b.example/")).toBe(2);
    expect(commands.map((command) => command.type === "show" && command.load)).toEqual([1, 2]);
    emit({ type: "shown", slot: "a", load: 1, url });
    expect(slots.status("a")).toEqual({ state: "loading", load: 2, url: "https://b.example/" });
    emit({ type: "shown", slot: "a", load: 2, url: "https://b.example/", title: "B" });
    expect(slots.status("a")).toMatchObject({ state: "shown", title: "B" });
  });

  it("sends a hidden slot as null, and the main process gets undefined", () => {
    const { remote, boxes, commands } = loop();
    remote.surface.place("a", { x: 8, y: 44, w: 600, h: 700 });
    remote.surface.place("b", undefined);
    expect(commands[1]).toEqual({ type: "place", slot: "b", box: null });
    expect(boxes.get("a")).toEqual({ x: 8, y: 44, w: 600, h: 700 });
    expect(boxes.has("b") && boxes.get("b")).toBeUndefined();
  });

  it("sends each action with the number of the open load, and no action before a load", () => {
    const { remote, actions } = loop();
    remote.surface.act("a", { type: "back" });
    remote.surface.show("a", url);
    remote.surface.show("a", url);
    remote.surface.act("a", { type: "open", url, where: "tab" });
    expect(actions).toEqual([{ slot: "a", load: 2, action: { type: "open", url, where: "tab" } }]);
  });

  it("lets the main process refuse an address that is not a web address", () => {
    const { remote } = loop();
    const slots = trackSlots(remote.surface);
    remote.surface.show("a", "file:///C:/secret.txt");
    expect(slots.status("a")).toMatchObject({ state: "failed", reason: "not-web" });
  });

  it("clears each slot at dispose, and then sends and gives nothing", () => {
    const { remote, commands, emit } = loop();
    const events: string[] = [];
    remote.surface.subscribe((event) => events.push(event.type));
    remote.surface.show("a", url);
    remote.surface.show("b", url);
    remote.surface.dispose();
    expect(commands.slice(2)).toEqual([
      { type: "clear", slot: "a", load: 1 },
      { type: "clear", slot: "b", load: 1 },
    ]);
    remote.surface.show("a", url);
    remote.surface.place("a", undefined);
    remote.surface.act("a", { type: "home" });
    emit({ type: "shown", slot: "a", load: 1, url });
    expect(commands).toHaveLength(4);
    expect(events).toEqual(["loading", "loading"]);
  });
});

describe("parseCommand", () => {
  it("keeps only the known fields", () => {
    expect(parseCommand({ type: "show", slot: "a", load: 3, url, extra: true })).toEqual({ type: "show", slot: "a", load: 3, url });
    expect(parseCommand({ type: "clear", slot: "a", load: 0 })).toEqual({ type: "clear", slot: "a", load: 0 });
    expect(parseCommand({ type: "place", slot: "a", box: { x: -2, y: 0, w: 0, h: 10, z: 1 } })).toEqual({ type: "place", slot: "a", box: { x: -2, y: 0, w: 0, h: 10 } });
    expect(parseCommand({ type: "act", slot: "a", load: 2, action: { type: "back", tab: 3 }, x: 1 })).toEqual({ type: "act", slot: "a", load: 2, action: { type: "back" } });
  });

  it("keeps each valid action with only its fields", () => {
    const actions: SlotAction[] = [
      { type: "lock", locked: true },
      { type: "lock", locked: false },
      { type: "back" },
      { type: "forward" },
      { type: "home" },
      { type: "select", tab: 0 },
      { type: "close", tab: 4 },
      { type: "open", url, where: "tab" },
      { type: "open", url: "javascript:alert(1)", where: "here" },
    ];
    for (const action of actions) expect(parseAction({ ...action, extra: 1 })).toEqual(action);
  });

  it("refuses each action that is not valid", () => {
    const bad: unknown[] = [
      null,
      "back",
      { type: "reload" },
      { type: "lock" },
      { type: "lock", locked: "no" },
      { type: "select" },
      { type: "close", tab: -1 },
      { type: "select", tab: 1.5 },
      { type: "open", url },
      { type: "open", url, where: "window" },
      { type: "open", url: 7, where: "tab" },
      { type: "open", url: `https://a.example/${"x".repeat(MAX_URL)}`, where: "tab" },
    ];
    for (const value of bad) expect(() => parseAction(value), JSON.stringify(value)).toThrow();
    expect(() => parseCommand({ type: "act", slot: "a", load: 1 })).toThrow();
  });

  it("refuses each command that is not valid", () => {
    const bad: unknown[] = [
      null,
      [],
      { type: "close" },
      { type: "show", slot: "", load: 1, url },
      { type: "show", slot: "x".repeat(MAX_SLOT + 1), load: 1, url },
      { type: "show", slot: "a", load: 1.5, url },
      { type: "show", slot: "a", load: -1, url },
      { type: "show", slot: "a", load: 1, url: 7 },
      { type: "show", slot: "a", load: 1, url: `https://a.example/${"x".repeat(MAX_URL)}` },
      { type: "place", slot: "a" },
      { type: "place", slot: "a", box: { x: 0, y: 0, w: -1, h: 1 } },
      { type: "place", slot: "a", box: { x: Number.NaN, y: 0, w: 1, h: 1 } },
      { type: "place", slot: "a", box: { x: 0, y: 0, w: Number.POSITIVE_INFINITY, h: 1 } },
    ];
    for (const value of bad) expect(() => parseCommand(value), JSON.stringify(value)).toThrow();
  });
});

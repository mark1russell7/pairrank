/**
 * A surface in another process. The page of the app has the proxy (`remoteSurface`). The main process has the views of
 * the sites, and applies each command of the page (`parseCommand`, `applyCommand`).
 *
 * The proxy gives each load its number, so `show` gives the number at once, as the contract tells. The main process
 * uses the number of the command, so the events of the two sides agree.
 */
import { createEmitter } from "@mark1russell7/collections";
import type { Rect } from "@mark1russell7/layout-contract";
import type { LoadId, SlotAction, SlotId, Surface, SurfaceEvent, SurfaceEvents, TabId } from "./surface.ts";

/**
 * A command of the page to the main process. A port sends `null` for a hidden slot, not `undefined`. An action has the
 * number of its load, so the main process does not apply an action of an earlier load to a new site.
 */
export type SurfaceCommand =
  | { readonly type: "show"; readonly slot: SlotId; readonly load: LoadId; readonly url: string }
  | { readonly type: "place"; readonly slot: SlotId; readonly box: Rect | null }
  | { readonly type: "clear"; readonly slot: SlotId; readonly load: LoadId }
  | { readonly type: "act"; readonly slot: SlotId; readonly load: LoadId; readonly action: SlotAction };

/** The longest name of a slot. */
export const MAX_SLOT = 64;

/** The longest address of a command. A longer address is not a site of a list. */
export const MAX_URL = 8192;

function objectOf(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("A command must be an object.");
  return value as Readonly<Record<string, unknown>>;
}

function slotOf(value: unknown): SlotId {
  if (typeof value !== "string" || value === "" || value.length > MAX_SLOT) throw new Error(`The slot must be a text of 1 to ${MAX_SLOT} characters.`);
  return value;
}

function loadOf(value: unknown): LoadId {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error("The load must be an integer of 0 or more.");
  return value;
}

function boxOf(value: unknown): Rect | null {
  if (value === null) return null;
  const box = objectOf(value);
  const [x, y, w, h] = [box["x"], box["y"], box["w"], box["h"]];
  const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
  if (!finite(x) || !finite(y) || !finite(w) || !finite(h) || w < 0 || h < 0) throw new Error("The box must have finite x and y, and a width and a height of 0 or more.");
  return { x, y, w, h };
}

function urlOf(value: unknown): string {
  if (typeof value !== "string" || value.length > MAX_URL) throw new Error(`The address must be a text of ${MAX_URL} characters or fewer.`);
  return value;
}

function tabOf(value: unknown): TabId {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error("The tab must be an integer of 0 or more.");
  return value;
}

/** This function examines an action of a command, and gives it with only its known fields. */
export function parseAction(value: unknown): SlotAction {
  const action = objectOf(value);
  switch (action["type"]) {
    case "lock":
      if (typeof action["locked"] !== "boolean") throw new Error("The action lock must have a boolean locked.");
      return { type: "lock", locked: action["locked"] };
    case "back":
    case "forward":
    case "home":
      return { type: action["type"] };
    case "select":
    case "close":
      return { type: action["type"], tab: tabOf(action["tab"]) };
    case "open": {
      const where = action["where"];
      if (where !== "tab" && where !== "here") throw new Error("The action open must have where tab or here.");
      return { type: "open", url: urlOf(action["url"]), where };
    }
    default:
      throw new Error("The type of an action must be lock, back, forward, home, select, close or open.");
  }
}

/**
 * This function examines a command from the page, and gives it with only its known fields. A command that is not
 * valid throws. The address of `show` or `open` can be any text: the adapter refuses an address that is not a web
 * address.
 */
export function parseCommand(value: unknown): SurfaceCommand {
  const command = objectOf(value);
  switch (command["type"]) {
    case "show":
      return { type: "show", slot: slotOf(command["slot"]), load: loadOf(command["load"]), url: urlOf(command["url"]) };
    case "place":
      return { type: "place", slot: slotOf(command["slot"]), box: boxOf(command["box"]) };
    case "clear":
      return { type: "clear", slot: slotOf(command["slot"]), load: loadOf(command["load"]) };
    case "act":
      return { type: "act", slot: slotOf(command["slot"]), load: loadOf(command["load"]), action: parseAction(command["action"]) };
    default:
      throw new Error("The type of a command must be show, place, clear or act.");
  }
}

/** The views of the sites in the main process. The page gives the number of each load. */
export interface SlotHost {
  /** This method starts the load `load` of the address in the slot. It sends `failed` with `not-web` for an address that is not a web address. */
  show(slot: SlotId, url: string, load: LoadId): void;
  place(slot: SlotId, box: Rect | undefined): void;
  /** This method removes the page of the slot, and sends `cleared` with the number `load`. */
  clear(slot: SlotId, load: LoadId): void;
  /** This method does an action on the pages of the slot. It ignores an action of a load that is not the open load. */
  act(slot: SlotId, load: LoadId, action: SlotAction): void;
}

/** This function applies one command of the page to the views of the main process. */
export function applyCommand(host: SlotHost, command: SurfaceCommand): void {
  switch (command.type) {
    case "show":
      host.show(command.slot, command.url, command.load);
      return;
    case "place":
      host.place(command.slot, command.box ?? undefined);
      return;
    case "clear":
      host.clear(command.slot, command.load);
      return;
    case "act":
      host.act(command.slot, command.load, command.action);
      return;
  }
}

/** The proxy of a surface in another process. */
export interface RemoteSurface {
  readonly surface: Surface;
  /** This function gives an event of the main process to the listeners of the surface. */
  receive(event: SurfaceEvent): void;
}

/**
 * This function makes the proxy of a surface in another process. `send` gives each command to the main process, and the
 * events of the main process come back through `receive`.
 */
export function remoteSurface(send: (command: SurfaceCommand) => void, kind = "remote"): RemoteSurface {
  const events = createEmitter<SurfaceEvents>();
  const counts = new Map<SlotId, LoadId>();
  let gone = false;
  const surface: Surface = {
    kind,
    show(slot, url) {
      const load = (counts.get(slot) ?? 0) + 1;
      counts.set(slot, load);
      if (!gone) send({ type: "show", slot, load, url });
      return load;
    },
    place(slot, box) {
      if (!gone) send({ type: "place", slot, box: box ?? null });
    },
    clear(slot) {
      if (!gone) send({ type: "clear", slot, load: counts.get(slot) ?? 0 });
    },
    act(slot, action) {
      const load = counts.get(slot);
      if (!gone && load !== undefined) send({ type: "act", slot, load, action });
    },
    subscribe: (listener) => events.on("event", listener),
    dispose() {
      if (gone) return;
      // Stop first: the answers of the main process to these commands reach no listener
      gone = true;
      events.dispose();
      for (const [slot, load] of counts) send({ type: "clear", slot, load });
    },
  };
  return {
    surface,
    receive(event) {
      if (!gone) events.emit("event", event);
    },
  };
}

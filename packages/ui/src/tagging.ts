/**
 * The rules of the tag screen and the tag keys, with no React code. Each function gives the drafts of one change, and
 * the rules of the state examine them again in the host.
 */
import type { Draft } from "@pairrank/core";
import type { StateView, TagView } from "@pairrank/host/views";
import { wordSearch } from "./search.ts";

/** One color of a tag: a name for the screen readers, and a value that shows in the light and the dark mode. */
export interface TagColor {
  readonly name: string;
  readonly value: string;
}

/** The colors of the tags. The red of the frame is not here, because it marks the focus and the pick. */
export const TAG_COLORS: readonly TagColor[] = [
  { name: "Blue", value: "#3d6fb6" },
  { name: "Teal", value: "#188a7e" },
  { name: "Green", value: "#4f8f2f" },
  { name: "Ochre", value: "#b8860b" },
  { name: "Orange", value: "#d0682a" },
  { name: "Plum", value: "#8e4a9e" },
  { name: "Rose", value: "#c2477a" },
  { name: "Gray", value: "#6b7280" },
];

/**
 * The keys that the app uses. A tag cannot have one of them. `j` and `k` go to the next and the previous site. The duel
 * uses `h` to hide, `s` to skip, `t` for a tie and `u` to undo.
 */
export const APP_KEYS: ReadonlySet<string> = new Set(["j", "k", "h", "s", "t", "u"]);

/** This function gives the key of a tag in its stored form: one lowercase letter or digit, or `undefined` for no key. */
export function keyOf(text: string): string | undefined {
  const key = text.trim().toLowerCase();
  return key === "" ? undefined : key;
}

/** The fields of a tag in the form of the tag screen. */
export interface TagFields {
  readonly name: string;
  /** The key, as the user types it. An empty text gives no key. */
  readonly key: string;
  readonly color: string | undefined;
}

/** This function gives the first problem of the fields of a tag, or `undefined`. `self` is the id of the tag that changes. */
export function tagProblem(fields: TagFields, tags: readonly TagView[], self?: string): string | undefined {
  const name = fields.name.trim();
  if (name === "") return "Type a name for the tag.";
  const other = tags.find((tag) => tag.id !== self && tag.name.trim().toLowerCase() === name.toLowerCase());
  if (other !== undefined) return `The tag "${other.name}" has this name.`;
  const key = keyOf(fields.key);
  if (key === undefined) return undefined;
  if (!/^[a-z0-9]$/.test(key)) return "A key is one letter or one digit.";
  if (APP_KEYS.has(key)) return `The app uses the key ${key}. Use a different key.`;
  const owner = tags.find((tag) => tag.id !== self && tag.key === key);
  if (owner !== undefined) return `The tag "${owner.name}" has the key ${key}.`;
  return undefined;
}

/** This function gives the draft that makes a tag. */
export function createDraft(id: string, fields: TagFields): Draft {
  const key = keyOf(fields.key);
  return {
    type: "tag.created",
    tag: id,
    name: fields.name.trim(),
    ...(fields.color === undefined ? {} : { color: fields.color }),
    ...(key === undefined ? {} : { key }),
  };
}

/** This function gives the draft that changes a tag, or `undefined` when no field changes. */
export function editDraft(tag: TagView, fields: TagFields): Draft | undefined {
  const name = fields.name.trim();
  const key = keyOf(fields.key);
  const changes = {
    ...(name === tag.name ? {} : { name }),
    ...(fields.color === tag.color ? {} : { color: fields.color ?? null }),
    ...(key === tag.key ? {} : { key: key ?? null }),
  };
  return Object.keys(changes).length === 0 ? undefined : { type: "tag.edited", tag: tag.id, ...changes };
}

/** This function gives the draft that puts a tag on a site, or removes it when the site has it. */
export function toggleDraft(site: { readonly id: string; readonly tags: readonly string[] }, tag: string): Draft {
  return site.tags.includes(tag) ? { type: "site.untagged", site: site.id, tag } : { type: "site.tagged", site: site.id, tag };
}

/** The sites and the picks that a merge or a delete changes. */
export interface TagImpact {
  readonly sites: number;
  readonly picks: number;
}

/** This function gives the count of the sites and the picks of a tag. */
export function impactOf(view: StateView, tag: string): TagImpact {
  return { sites: view.tags.find((entry) => entry.id === tag)?.sites ?? 0, picks: view.picks[`tag:${tag}`] ?? 0 };
}

/** This function gives the tags whose names have each word of a search, in the order of their names. */
export function findTags(tags: readonly TagView[], query: string): TagView[] {
  const has = wordSearch(query);
  return tags.filter((tag) => has(tag.name)).sort((a, b) => a.name.localeCompare(b.name));
}

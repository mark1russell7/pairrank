/**
 * The home page: the theme, the copy button and the live demo of the duel. `demo.ts` has the rules of the demo. This
 * file only draws its state and sends the actions of the person to it.
 */
import { byId, copyText, setupTheme } from "@mark1russell7/site-pages/chrome";
import type { Ladder, ModelName } from "@pairrank/ratings";
import { type DuelAction, actionOf } from "@pairrank/ui/duel";
import { type Demo, type LadderRow, MODELS, act, agreementOf, createDemo, ladderOfDemo, rowsOf, setModel, siteOf, tastePicks } from "./demo.ts";

setupTheme(byId<HTMLButtonElement>("theme"), "theme");

const copy = byId<HTMLButtonElement>("copy");
copy.addEventListener("click", () => {
  void copyText(copy, byId("install").textContent ?? "");
});

/** The lowest and the highest rating of the scale of the ladder. A rating outside the scale stays at its edge. */
const SCALE = { low: 1100, high: 1900 } as const;
/** The count of picks of the hidden taste for each press of its button. */
const TASTE_PICKS = 10;

const duel = byId("duel");
const cards = { left: byId<HTMLButtonElement>("one"), right: byId<HTMLButtonElement>("two") };
const undo = byId<HTMLButtonElement>("undo");
const status = byId("status");
const ladder = byId<HTMLOListElement>("ladder");
const model = byId<HTMLSelectElement>("model");
const reveal = byId<HTMLButtonElement>("reveal");
const agreement = byId("agreement");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

let demo: Demo = createDemo();
/** The message of the last action, for the status line. */
let told = "Pick the better site of the two.";

for (const { model: name, name: label } of MODELS) model.add(new Option(label, name, name === demo.model, name === demo.model));

/** This function makes the small drawing of a sample site: the bar of its address, a picture and three lines of text. */
function drawing(id: string, host: string): HTMLElement {
  const page = document.createElement("span");
  page.className = `mini motif-${id}`;
  page.setAttribute("aria-hidden", "true");
  const bar = document.createElement("span");
  bar.className = "mini-bar";
  bar.textContent = host;
  page.append(bar);
  const hero = document.createElement("span");
  hero.className = "mini-hero";
  const lines = document.createElement("span");
  lines.className = "mini-lines";
  lines.append(document.createElement("i"), document.createElement("i"), document.createElement("i"));
  page.append(hero, lines);
  return page;
}

/** This function draws one card of the duel. A card with a new site moves in, so the person sees the change. */
function drawCard(card: HTMLButtonElement, id: string | undefined, number: "1" | "2"): void {
  const changed = card.dataset["site"] !== id;
  card.replaceChildren();
  card.disabled = id === undefined;
  if (id === undefined) return;
  const site = siteOf(id);
  const key = document.createElement("span");
  key.className = "card-key";
  key.textContent = number;
  const name = document.createElement("span");
  name.className = "card-name";
  name.textContent = site.title;
  card.append(key, drawing(site.id, site.host), name);
  card.dataset["site"] = site.id;
  card.setAttribute("aria-label", `${number === "1" ? "One" : "Two"} is better: ${site.title}`);
  if (changed && !reduceMotion.matches) card.animate([{ opacity: 0.35, transform: "translateY(4px)" }, { opacity: 1, transform: "none" }], { duration: 180, easing: "ease-out" });
}

/** This function gives the position of a rating on the scale, in percent. */
const position = (rating: number): number => (100 * (Math.min(SCALE.high, Math.max(SCALE.low, rating)) - SCALE.low)) / (SCALE.high - SCALE.low);

/** This function gives the row element of a site, and makes it on the first call. */
function rowOf(id: string): HTMLLIElement {
  const found = ladder.querySelector<HTMLLIElement>(`li[data-site="${id}"]`);
  if (found !== null) return found;
  const row = document.createElement("li");
  row.dataset["site"] = id;
  // The id is one of the ids of `SAMPLE_SITES`, so the markup has no text of a person
  row.innerHTML = `<span class="place"></span><span class="site"><span class="chip motif-${id}" aria-hidden="true"></span><span class="title"></span><span class="taste-place"></span></span><span class="track" aria-hidden="true"><span class="whisker"></span><span class="dot"></span></span><span class="rating"></span><span class="record"></span>`;
  ladder.append(row);
  return row;
}

/** This function writes the text of a part of a row. */
function put(row: HTMLElement, selector: string, value: string): void {
  const part = row.querySelector<HTMLElement>(selector);
  if (part !== null) part.textContent = value;
}

/** This function draws one row of the ladder. */
function drawRow(row: HTMLLIElement, data: LadderRow): void {
  put(row, ".place", String(data.place));
  put(row, ".title", data.site.title);
  put(row, ".taste-place", `taste ${String(data.tastePlace)}`);
  const rating = Math.round(data.rating);
  put(row, ".rating", `${String(rating)} ± ${String(Math.round(data.uncertainty))}`);
  put(row, ".record", `${String(data.wins)} won, ${String(data.losses)} lost${data.ties > 0 ? `, ${String(data.ties)} tied` : ""}`);
  const whisker = row.querySelector<HTMLElement>(".whisker");
  const dot = row.querySelector<HTMLElement>(".dot");
  const from = position(data.rating - data.uncertainty);
  if (whisker !== null) Object.assign(whisker.style, { left: `${String(from)}%`, width: `${String(position(data.rating + data.uncertainty) - from)}%` });
  if (dot !== null) dot.style.left = `${String(position(data.rating))}%`;
  row.setAttribute("aria-label", `Place ${String(data.place)}: ${data.site.title}, rating ${String(rating)}`);
}

/**
 * This function draws the ladder. Each row moves from its old place to its new place, so the change of a pick is
 * visible. A person who asks for less motion sees no move.
 */
function drawLadder(current: Ladder): void {
  const rows = rowsOf(current);
  const before = new Map([...ladder.children].map((row) => [(row as HTMLElement).dataset["site"], row.getBoundingClientRect().top]));
  for (const data of rows) {
    const row = rowOf(data.site.id);
    drawRow(row, data);
    ladder.append(row);
  }
  if (reduceMotion.matches) return;
  for (const row of ladder.children) {
    const old = before.get((row as HTMLElement).dataset["site"]);
    const shift = old === undefined ? 0 : old - row.getBoundingClientRect().top;
    if (Math.abs(shift) > 1) row.animate([{ transform: `translateY(${String(shift)}px)` }, { transform: "none" }], { duration: 320, easing: "cubic-bezier(.2,.7,.2,1)" });
  }
}

/** This function draws the whole demo. */
function draw(): void {
  drawCard(cards.left, demo.pair?.a, "1");
  drawCard(cards.right, demo.pair?.b, "2");
  const current = ladderOfDemo(demo);
  drawLadder(current);
  const picks = demo.steps.length;
  undo.disabled = picks === 0;
  status.textContent = `${told} ${picks === 1 ? "1 pick" : `${String(picks)} picks`} so far.`;
  const tau = agreementOf(current);
  agreement.textContent =
    tau === undefined ? "The ranking has no order yet, so it cannot agree with the hidden taste."
    : `The ranking agrees with the hidden taste: ${tau.toFixed(2)}. This is the Kendall tau of the two orders: 1 is the same order, and 0 is no relation.`;
}

/** This function does one action of the duel, and draws the demo again. */
function perform(action: DuelAction): void {
  const pair = demo.pair;
  if (!act(demo, action)) return;
  const name = (id: string | undefined): string => (id === undefined ? "" : siteOf(id).title);
  told =
    action === "left" ? `${name(pair?.a)} won.`
    : action === "right" ? `${name(pair?.b)} won.`
    : action === "tie" ? "A tie."
    : action === "skip" ? "Skipped. A skip does not change the ratings."
    : "The last pick is gone.";
  draw();
}

for (const button of duel.querySelectorAll<HTMLButtonElement>("button[data-action]")) {
  button.addEventListener("click", () => perform(button.dataset["action"] as DuelAction));
}
cards.left.addEventListener("click", () => perform("left"));
cards.right.addEventListener("click", () => perform("right"));

// The keys of the duel are the keys of the app. A press of Space or Enter on a button stays a click of the button
duel.addEventListener("keydown", (event) => {
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.target instanceof HTMLButtonElement && (event.key === " " || event.key === "Enter")) return;
  const action = actionOf(event.key);
  if (action === undefined || action === "hide") return;
  event.preventDefault();
  perform(action);
});

model.addEventListener("change", () => {
  setModel(demo, model.value as ModelName);
  told = `The ranking uses ${model.selectedOptions[0]?.text ?? model.value} now.`;
  draw();
});

byId<HTMLButtonElement>("taste").addEventListener("click", () => {
  const done = tastePicks(demo, TASTE_PICKS);
  told = `The hidden taste picked ${String(done)} times.`;
  draw();
});

reveal.addEventListener("click", () => {
  const shown = reveal.getAttribute("aria-pressed") !== "true";
  reveal.setAttribute("aria-pressed", String(shown));
  reveal.textContent = shown ? "Hide the order of the taste" : "Show the order of the taste";
  ladder.classList.toggle("show-taste", shown);
});

byId<HTMLButtonElement>("restart").addEventListener("click", () => {
  demo = createDemo(demo.seed, demo.model);
  told = "A new start. Pick the better site of the two.";
  draw();
});

draw();

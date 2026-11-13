/**
 * The probe of the demo of the duel. The site check of the Pages workflow starts it in a browser at each width and
 * in each theme, before the deploy. A failed check stops the deploy.
 *
 * The site check reads this TypeScript file directly. It removes the types and the `export` line, and it starts the
 * result as the body of an async function.
 */

// The site check gives these helpers to the probe. Each element of this page is an HTML element.
declare const check: (name: string, ok: unknown, detail?: unknown) => boolean;
declare const until: <T>(fn: () => T | Promise<T>, ms?: number) => Promise<T>;
declare const $: (selector: string) => HTMLElement | null;
declare const $$: (selector: string) => HTMLElement[];
declare const click: (target: string | Element) => void;

const text = (selector: string): string => $(selector)?.textContent ?? "";
const pair = (): string => `${$("#one")?.dataset["site"] ?? ""}|${$("#two")?.dataset["site"] ?? ""}`;
const order = (): string[] => $$("#ladder li").map((row) => row.dataset["site"] ?? "");
const press = (key: string): void => {
  $("#duel")?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
};
const button = (selector: string): HTMLButtonElement | null => $(selector) as HTMLButtonElement | null;

// The start
const [left, right] = pair().split("|");
check("the duel shows two different sample sites", left !== "" && right !== "" && left !== right, pair());
check("the ladder has a row for each of the eight sites", order().length === 8, order());
check("the duel starts with no picks", text("#status").includes("0 picks so far"), text("#status"));
check("the undo button is off before the first pick", button("#undo")?.disabled === true);
check("the agreement waits for the first pick", text("#agreement").includes("no order yet"), text("#agreement"));

// A click on a card picks its site
click("#two");
check("a click on the second card counts a pick", await until(() => text("#status").includes("1 pick so far")), text("#status"));
check("the winner goes to the top of the ladder", order()[0] === right, order());
check("the status names the winner", text("#status").includes(`${text(`#ladder li[data-site="${right ?? ""}"] .title`)} won.`), text("#status"));
check("the duel shows a new pair", pair() !== `${left ?? ""}|${right ?? ""}`, pair());

// The keys of the duel
const second = pair();
press("ArrowLeft");
check("the left arrow picks the first site", await until(() => text("#status").includes("2 picks so far")), text("#status"));
press("Backspace");
check("Backspace removes the last pick", await until(() => text("#status").includes("1 pick so far")), text("#status"));
check("an undo shows the pair of the removed pick again", pair() === second, `${pair()} and ${second}`);
press("t");
check("t is a tie", await until(() => text("#status").includes("A tie.")), text("#status"));

// The model and the hidden taste
const model = $("#model") as HTMLSelectElement | null;
if (model !== null) {
  model.value = "elo";
  model.dispatchEvent(new Event("change", { bubbles: true }));
}
check("a change of the model keeps the picks", await until(() => text("#status").includes("Elo now. 2 picks so far")), text("#status"));
click("#taste");
click("#taste");
check("the hidden taste picks 10 times at each press", await until(() => text("#status").includes("22 picks so far")), text("#status"));
check("the agreement shows the Kendall tau", /agrees with the hidden taste: -?\d\.\d\d\./.test(text("#agreement")), text("#agreement"));
click("#reveal");
check("the button shows the order of the taste", await until(() => $("#ladder")?.classList.contains("show-taste") === true));
check("each row shows its place in the taste", $$("#ladder .taste-place").every((place) => getComputedStyle(place).display !== "none"));

// A new start
click("#restart");
check("Start again removes each pick", await until(() => text("#status").includes("0 picks so far")), text("#status"));
check("Start again keeps the model", text("#status").includes("A new start") && model?.value === "elo", model?.value);

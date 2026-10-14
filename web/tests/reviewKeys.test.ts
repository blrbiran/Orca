// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { reviewKeyAction } from "../src/reviewKeys.js";

const ev = (key: string, target: EventTarget | null = document.body, mods: Partial<Record<"metaKey" | "ctrlKey" | "altKey" | "repeat", boolean>> = {}) =>
  ({ key, target, metaKey: false, ctrlKey: false, altKey: false, repeat: false, ...mods });

/** Taste refinement P1-3 / Review Focus 2: a letter typed into a field must never record a review. */
describe("reviewKeyAction", () => {
  it("maps j/k/a/c on the page", () => {
    expect(["j", "k", "a", "c"].map((k) => reviewKeyAction(ev(k)))).toEqual(["next", "previous", "agree", "correct"]);
  });
  it("ignores keys typed into an input, a textarea, a select or an editable element", () => {
    const input = document.createElement("input"), area = document.createElement("textarea"), select = document.createElement("select");
    // jsdom does not reflect `contentEditable = "true"` into the attribute; set the attribute itself.
    const editable = document.createElement("div"); editable.setAttribute("contenteditable", "true");
    const inside = document.createElement("span"); editable.appendChild(inside);
    for (const target of [input, area, select, editable, inside]) expect(reviewKeyAction(ev("a", target))).toBeNull();
  });
  it("ignores a held key (auto-repeat): an Agree is never sent twice by holding 'a' (Review Focus 2)", () => {
    expect(reviewKeyAction(ev("a", document.body, { repeat: true }))).toBeNull();
  });
  it("ignores chords and other keys", () => {
    expect(reviewKeyAction(ev("a", document.body, { metaKey: true }))).toBeNull();
    expect(reviewKeyAction(ev("c", document.body, { ctrlKey: true }))).toBeNull();
    expect(reviewKeyAction(ev("x"))).toBeNull();
    expect(reviewKeyAction(ev("A"))).toBeNull();
  });
});

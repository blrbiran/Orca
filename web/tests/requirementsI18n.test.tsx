// @vitest-environment jsdom
/**
 * N1 spec §11.2, panel i18n spec §6.5: the Requirements section's own words go through t, in zh and en; what the model
 * wrote is shown as written (human ruling H8). The helpers and the bundle swap are web/tests/i18nPseudo.test.tsx:42-90's,
 * copied: a pseudo-locale wraps every fixed part of every value as ⟦…⟧, so an English value of at least 4 characters left
 * on screen once the markers are stripped is a literal that bypassed t.
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import i18n from "../src/i18n.js";
import { en } from "../src/locales/en.js";
import { zh } from "../src/locales/zh.js";
import { RequirementsPanel } from "../src/RequirementsPanel.js";
import type { RequirementViewV1 } from "../src/controlTypes.js";
import type { ControlRefusal } from "../src/controlState.js";
import { config, requirementView, summaryWith } from "./fixtures/requirement.js";
import type { RequirementFixtureState } from "./fixtures/requirement.js";

type Tree = { readonly [key: string]: string | Tree };
function flatten(node: Tree, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(node)) {
    const path = prefix === "" ? key : `${prefix}.${key}`;
    if (typeof value === "string") out[path] = value;
    else Object.assign(out, flatten(value, path));
  }
  return out;
}
/** A value's fixed text and its {{placeholders}} / <tags>, alternating: odd indexes are the placeholders and tags. */
const parts = (value: string): string[] => value.split(/(\{\{[^}]*\}\}|<\/?[a-z0-9]+>)/);
const wrapValue = (value: string): string => parts(value).map((part, index) => (index % 2 === 1 || part === "" ? part : `⟦${part}⟧`)).join("");
const wrap = (node: Tree): Tree => Object.fromEntries(Object.entries(node).map(([key, value]) => [key, typeof value === "string" ? wrapValue(value) : wrap(value)]));
const EN = flatten(en as unknown as Tree);
const ZH = flatten(zh as unknown as Tree);
const WHOLE = Object.entries(EN).filter(([key, value]) => value.length >= 4 && !value.includes("{{") && value !== ZH[key]);
const FRAGMENTS = Object.entries(EN).filter(([, value]) => value.includes("{{")).flatMap(([key, value]) =>
  parts(value).filter((part, index) => index % 2 === 0).map((part) => part.trim()).filter((part) => part.length >= 4 && !ZH[key]!.includes(part))
    .map((part): [string, string] => [`${key} (fixed part)`, part]));
const CHECKED = [...WHOLE, ...FRAGMENTS];
const strip = (text: string): string => {
  let out = text;
  for (;;) {
    const next = out.replace(/⟦[^⟦⟧]*⟧/g, "");
    if (next === out) return out;
    out = next;
  }
};
/**
 * A reason code is shown as sent beside its explanation, as a refusal's code is in Task control: it is a machine id, not
 * a sentence, so it is taken out before the check (requirement-budget-exhausted would otherwise read as the English
 * value "exhausted"). Only these codes are taken out; their explanations stay checked.
 */
const CODES = Object.keys(en.requirements.reason);
const withoutCodes = (text: string): string => CODES.reduce((out, code) => out.split(code).join(""), text);
function leftovers(root: HTMLElement): string[] {
  const attributes = [...root.querySelectorAll("*")].flatMap((element) => ["aria-label", "title", "placeholder", "label"].map((name) => element.getAttribute(name) ?? ""));
  const visible = [root.textContent ?? "", ...attributes].map(strip).map(withoutCodes).join("\n");
  return CHECKED.filter(([, value]) => visible.includes(value)).map(([key, value]) => `${key}: ${value}`);
}
function setZhBundle(bundle: Tree): void {
  i18n.removeResourceBundle("zh", "translation");
  i18n.addResourceBundle("zh", "translation", bundle);
}
async function usePseudo(): Promise<void> {
  setZhBundle(wrap(en as unknown as Tree));
  await i18n.changeLanguage("zh");
}
async function useChinese(): Promise<void> {
  setZhBundle(structuredClone(zh) as unknown as Tree);
  await i18n.changeLanguage("zh");
}
afterEach(() => {
  cleanup();
  setZhBundle(structuredClone(zh) as unknown as Tree);
});

const STATES: RequirementFixtureState[] = ["awaiting-answers", "answered", "awaiting-review", "failed"];
const show = (view: RequirementViewV1, refusal: ControlRefusal | null = null): HTMLElement =>
  render(<RequirementsPanel config={config} summary={summaryWith(view)} views={{ r: view }} selected="r" agents={null} language="zh" onSelect={() => {}} onCommand={() => {}} refusal={refusal} />).container;

/** The branches the four plan fixtures do not reach: an exhausted budget, a blocked export, a done export, a refusal. */
function moreViews(): Array<[RequirementViewV1, ControlRefusal | null]> {
  const review = requirementView("awaiting-review");
  const answered = requirementView("answered");
  const exportAt = (state: "pending" | "done" | "conflict", commit: string | null, reasonCode: string | null): RequirementViewV1 => ({
    ...review, summary: { ...review.summary, requirement: { ...review.summary.requirement!, reasonCode, exportState: state } },
    requirement: { ...review.requirement, export: { ...review.requirement.export, state, commit } },
  });
  return [
    [{ ...answered, summary: { ...answered.summary, requirement: { ...answered.summary.requirement!, waiting: "requirement-budget-exhausted" } }, ledger: { ...answered.ledger, usageUnknown: true } }, null],
    [{ ...answered, rounds: [...answered.rounds, { ...answered.rounds[0]!, roundNo: 2, state: "drafting", result: null, answers: null }] }, null],
    [exportAt("conflict", null, "requirement-export-path-blocked"), null],
    [exportAt("conflict", null, "requirement-export-conflict"), null],
    [exportAt("pending", null, null), null],
    [exportAt("done", "c0ffee1", null), { status: 422, code: "requirement-export-pending", message: "requirement-export-pending", commandRevision: 3 }],
    [answered, { status: 422, code: "requirement-not-split", message: "requirement-not-split", commandRevision: 3 }],
  ];
}

describe("the Requirements section in zh and en (N1 spec §11.2)", () => {
  it("leaves no English value on screen under the pseudo-locale, for each of the four fixture states", async () => {
    await usePseudo();
    for (const state of STATES) {
      expect(leftovers(show(requirementView(state))), state).toEqual([]);
      cleanup();
    }
  });

  it("leaves no English value on screen under the pseudo-locale for the reason codes, the export, drafting and a refusal", async () => {
    await usePseudo();
    for (const [index, [view, refusal]] of moreViews().entries()) {
      expect(leftovers(show(view, refusal)), String(index)).toEqual([]);
      cleanup();
    }
    expect(leftovers(render(<RequirementsPanel config={{ ...config, repositories: [] }} summary={summaryWith(requirementView("answered"))} views={{}} selected={null} agents={null} language="zh" onSelect={() => {}} onCommand={() => {}} />).container)).toEqual([]);
  });

  it("shows the section's own words in real Chinese and the model's words as written", async () => {
    await useChinese();
    const root = show(requirementView("awaiting-answers"));
    expect(root.textContent).toContain("需求");
    expect(root.textContent).toContain(zh.requirements.acceptAll);
    expect(root.textContent).toContain("全部采用推荐答案");
    // H8: the model wrote English; it stays English on a Chinese page.
    expect(root.textContent).toContain("Which Markdown flavour?");
  });
});

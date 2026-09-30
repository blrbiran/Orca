import { describe, expect, it } from "vitest";
import { en } from "../src/locales/en.js";
import { zh } from "../src/locales/zh.js";

/**
 * Review Focus 5 (panel i18n plan): jsdom lays nothing out, so a width proxy pins that a Chinese value does not widen a
 * narrow table cell or a button: its display width (CJK and full-width forms count 2 columns) is at most the English
 * width + 2, for every table header, every in-table enum value and every button label listed here.
 */
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
const EN = flatten(en as unknown as Tree);
const ZH = flatten(zh as unknown as Tree);
const width = (text: string): number => [...text].reduce((n, ch) => n + (/[⺀-鿿　-〿＀-￯]/.test(ch) ? 2 : 1), 0);
const NARROW_PREFIXES = [
  "control.group.th.", "control.group.runsTh.", "budget.th.", "enums.workStatus.", "enums.runPhase.", "enums.runState.",
  "enums.allocationState.", "enums.bucket.", "enums.ownerKind.", "enums.dimension.",
];
const BUTTONS = [
  "control.group.start", "control.group.pause", "control.group.handoffStop", "control.group.resume", "control.group.resumeNoContinuation",
  "control.task.addSystem", "control.task.addCustom", "control.task.save", "control.task.discard", "control.task.restore",
  "budget.applyRow", "budget.applyAll", "budget.setLimit", "budget.save", "budget.reestimate", "budget.confirm",
  "loopPlan.changePlan", "loopPlan.discard", "chains.start", "chains.stop", "decisions.agree", "decisions.correct", "recovery.retry",
];

describe("Chinese in narrow places (Review Focus 5)", () => {
  it("keeps every table header, in-table enum value and button no wider in Chinese than in English + 2 columns", () => {
    const keys = [...Object.keys(EN).filter((key) => NARROW_PREFIXES.some((prefix) => key.startsWith(prefix))), ...BUTTONS];
    expect(keys.length).toBeGreaterThanOrEqual(85);
    for (const key of keys) {
      expect(EN[key], key).toBeDefined();
      expect(width(ZH[key]!), `${key}: ${EN[key]} → ${ZH[key]}`).toBeLessThanOrEqual(width(EN[key]!) + 2);
    }
  });
});

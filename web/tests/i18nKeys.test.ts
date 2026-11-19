import { describe, expect, it } from "vitest";
import i18n, { enumText } from "../src/i18n.js";
import { en, enErrors } from "../src/locales/en.js";
import { zh, zhErrors } from "../src/locales/zh.js";

/**
 * Panel i18n spec §2, §6.2: Chinese has exactly the English keys, both ways (the Chinese-only zhErrors table is a separate
 * export and part of neither); every value is a non-empty string; a Chinese value keeps every placeholder and markup tag
 * of its English value (a dropped {{count}} would drop data without an error); each Chinese _one key carries its _other
 * text (Chinese has one plural form). §3.5: an enum value this panel has no words for is shown as sent.
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
const marks = (value: string): string[] => [...value.matchAll(/\{\{\w+\}\}|<\/?\w+>/g)].map((match) => match[0]).sort();

describe("key parity (spec §6.2)", () => {
  it("gives Chinese exactly the English keys, both ways, every value a non-empty string", () => {
    expect(Object.keys(ZH).sort()).toEqual(Object.keys(EN).sort());
    for (const [key, value] of [...Object.entries(EN), ...Object.entries(ZH)]) expect(value, key).not.toBe("");
  });

  it("keeps every placeholder and markup tag of the English value in the Chinese one", () => {
    for (const key of Object.keys(EN)) expect(marks(ZH[key] ?? ""), key).toEqual(marks(EN[key]!));
  });

  it("gives each Chinese _one key the text of its _other key", () => {
    // No plural key exists before Task 3; MT3-10 is this criterion's red.
    for (const key of Object.keys(ZH).filter((name) => name.endsWith("_one"))) expect(ZH[key], key).toBe(ZH[key.replace(/_one$/, "_other")]);
  });

  // #389 doc follow-up (2026-11-20): the operator's set-limit now installs a finite limit, so this conflict reaches the web
  // channel only from set-spend-cap; both locales must name the spend cap, not a finite limit.
  it("names the spend cap for active-unbounded-budget-conflict (#389)", () => {
    expect([enErrors["active-unbounded-budget-conflict"], zhErrors["active-unbounded-budget-conflict"]])
      .toEqual(["Stop and reconcile the active unlimited run before setting a spend cap.", "设置花费上限前，请停止并结算正在进行的不限额运行。"]);
  });
});

describe("enum values in words (spec §3.5)", () => {
  it("shows a known value in the reader's language and an unknown one as sent", async () => {
    expect(enumText("theme", "dark")).toBe("dark");
    await i18n.changeLanguage("zh");
    expect(enumText("theme", "dark")).toBe("深色");
    expect(enumText("theme", "sepia")).toBe("sepia");
  });
});

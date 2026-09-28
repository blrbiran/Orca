import { describe, expect, it } from "vitest";
import { ControlError } from "../../src/control/errors.js";
import {
  CUSTOM_LABEL_PREFIX,
  MAX_TASK_LABELS,
  SYSTEM_LABELS,
  effectiveTaskLabels,
  inputLabelsSchema,
  nonEmptyStoredLabelsSchema,
  normalizeInputLabels,
  readTaskLabelState,
  storedLabelsSchema,
} from "../../src/control/labels.js";

/**
 * Labels and progress spec §2.1, §2.4, §2.5, criteria L2, L3, L5 and §8 R15. The Mutation lines of plan Task 1 name
 * the production line each `it` goes red on.
 */
describe("the label vocabulary and the input door (spec §2.1, §8 R15)", () => {
  it("is G11's ten system words, and a custom label carries the lower-case custom: prefix", () => {
    expect([...SYSTEM_LABELS]).toEqual(["feature", "bug", "refactor", "test", "doc", "design", "investigate", "perf", "security", "chore"]);
    expect(CUSTOM_LABEL_PREFIX).toBe("custom:");
    expect(MAX_TASK_LABELS).toBe(16);
  });

  it("L3: deduplicates and sorts by UTF-16 code unit, never by locale", () => {
    // 'Z' (0x5a) sorts before 'a' (0x61) by code unit; localeCompare would put custom:alpha first.
    expect(normalizeInputLabels(["test", "bug", "custom:Zeta", "custom:alpha", "bug"]))
      .toEqual({ ok: true, labels: ["bug", "custom:Zeta", "custom:alpha", "test"] });
  });

  it("L3: refuses a bare word outside the vocabulary and names it, case-sensitively", () => {
    expect(normalizeInputLabels(["bug", "urgent"])).toEqual({ ok: false, detail: "urgent" });
    expect(normalizeInputLabels(["Feature"])).toEqual({ ok: false, detail: "Feature" });
    expect(normalizeInputLabels(["Custom:x"])).toEqual({ ok: false, detail: "Custom:x" });
  });

  it("L3: accepts a Chinese custom label and stores every custom label NFC-normalized", () => {
    expect(normalizeInputLabels(["custom:前端"])).toEqual({ ok: true, labels: ["custom:前端"] });
    // "e" + U+0301 (NFD) and U+00E9 (NFC) are one label after normalization.
    expect(normalizeInputLabels(["custom:café", "custom:café"])).toEqual({ ok: true, labels: ["custom:café"] });
  });

  it("L3: counts a custom label in NFC code points, without the prefix", () => {
    expect(normalizeInputLabels([`custom:${"😀".repeat(32)}`]).ok).toBe(true); // 32 code points, 64 code units
    expect(normalizeInputLabels([`custom:${"a".repeat(33)}`])).toEqual({ ok: false, detail: `custom:${"a".repeat(33)}` });
    expect(normalizeInputLabels(["custom:"])).toEqual({ ok: false, detail: "custom:" });
  });

  it("L3: refuses whitespace, a control character and a lone surrogate -- the last without echoing it", () => {
    expect(normalizeInputLabels(["custom:a b"])).toEqual({ ok: false, detail: "custom:a b" });
    expect(normalizeInputLabels(["custom:a\u0007"])).toEqual({ ok: false, detail: "custom:a\u0007" });
    expect(normalizeInputLabels(["custom:\ud800"])).toEqual({ ok: false, detail: "lone-surrogate" });
  });

  it("L3: refuses a 17th distinct label, counting after deduplication", () => {
    const sixteen = [...SYSTEM_LABELS, ...Array.from({ length: 6 }, (_, i) => `custom:c${i}`)];
    expect(normalizeInputLabels(sixteen)).toMatchObject({ ok: true });
    expect(normalizeInputLabels([...sixteen, "custom:c16"])).toEqual({ ok: false, detail: "count:17" });
    expect(normalizeInputLabels([...sixteen, "bug"])).toMatchObject({ ok: true });
  });

  it("L3: the plan file's schema normalizes, and names a refused label in its message", () => {
    expect(inputLabelsSchema.parse(["test", "bug", "bug"])).toEqual(["bug", "test"]);
    const refused = inputLabelsSchema.safeParse(["bug", "Feature"]);
    expect(refused.success).toBe(false);
    if (!refused.success) expect(refused.error.issues[0]!.message).toBe("labels-invalid:Feature");
  });
});

describe("storage checks format only (spec §2.1, human ruling L-6)", () => {
  it("L2: keeps reading a word the vocabulary no longer has", () => {
    expect(storedLabelsSchema.parse(["bug", "zz-retired-word"])).toEqual(["bug", "zz-retired-word"]);
  });

  it("refuses an unsorted, duplicated, empty, over-long or over-many list; the archive's form refuses []", () => {
    expect(storedLabelsSchema.safeParse(["test", "bug"]).success).toBe(false);
    expect(storedLabelsSchema.safeParse(["bug", "bug"]).success).toBe(false);
    expect(storedLabelsSchema.safeParse([""]).success).toBe(false);
    expect(storedLabelsSchema.safeParse(["x".repeat(65)]).success).toBe(false);
    expect(storedLabelsSchema.safeParse(Array.from({ length: 17 }, (_, i) => `l${String(i).padStart(2, "0")}`)).success).toBe(false);
    expect(storedLabelsSchema.parse([])).toEqual([]);
    expect(nonEmptyStoredLabelsSchema.safeParse([]).success).toBe(false);
  });
});

describe("a task's effective labels (spec §2.4, §2.5, criterion L5)", () => {
  it("reads a work item written before labels existed as no override at version 0", () => {
    expect(readTaskLabelState({ kind: "task", status: "draft" })).toEqual({ override: null, version: 0 });
    expect(readTaskLabelState({ labelsOverride: ["bug"], labelsVersion: 3 })).toEqual({ override: ["bug"], version: 3 });
  });

  it("blocks a work item whose label fields are not the stored format", () => {
    expect(() => readTaskLabelState({ labelsOverride: ["test", "bug"], labelsVersion: 1 })).toThrow(ControlError);
    expect(() => readTaskLabelState({ labelsOverride: null, labelsVersion: -1 })).toThrow("recovery-blocked:work-item-labels-invalid");
  });

  it("L5: an override wins, an empty override is the person clearing them, no override falls back to the plan", () => {
    expect(effectiveTaskLabels({ override: ["perf"], version: 1 }, ["bug"])).toEqual({ labels: ["perf"], provenance: "operator" });
    expect(effectiveTaskLabels({ override: [], version: 2 }, ["bug"])).toEqual({ labels: [], provenance: "operator" });
    expect(effectiveTaskLabels({ override: null, version: 3 }, ["bug"])).toEqual({ labels: ["bug"], provenance: "plan" });
    expect(effectiveTaskLabels({ override: null, version: 0 }, undefined)).toEqual({ labels: [], provenance: "plan" });
  });
});

/**
 * Issue fixes spec §4.2(1), §2.2(a): every ccloop failure reason the run views show has text in both languages, and a
 * reason as ccloop sends it (behind `Error: `) reaches that text.
 */
import { describe, expect, it } from "vitest";
import { enErrors } from "../src/locales/en.js";
import { zhErrors } from "../src/locales/zh.js";
import { explainRunReason } from "../src/refusalExplain.js";
import { reasonCode } from "../src/runFacts.js";

const REASONS = [
  "codex-result-invalid", "codex-events-invalid", "codex-no-completion", "codex-usage-invalid", "codex-usage-unavailable", "codex-event-error",
  "codex-timeout", "codex-skills-cleanup-failed", "codex-skills-path-conflict", "codex-skills-pending", "codex-skills-setup-failed",
  "codex-skills-source-invalid", "terminal",
];

describe("ccloop failure reasons (spec §4.2(1))", () => {
  it("has an English and a Chinese entry for every reason", () => {
    expect(REASONS.filter((code) => !Object.hasOwn(enErrors, code) || !Object.hasOwn(zhErrors, code))).toEqual([]);
  });

  it("explains a reason as ccloop sends it, through its Error: prefix, and an outcome through its detail", () => {
    expect(explainRunReason(reasonCode("Error: codex-result-invalid: /runs/r/attempt-1"))).toBe(enErrors["codex-result-invalid"]);
    expect(explainRunReason(reasonCode("terminal:exhausted"))).toContain("exhausted");
  });
});

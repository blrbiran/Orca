/**
 * Issue fixes spec §4.2(1), §2.2(a): every ccloop failure reason the run views show has text in both languages, and a
 * reason as ccloop sends it (behind `Error: `) reaches that text.
 */
import { describe, expect, it } from "vitest";
import i18n, { refusalText } from "../src/i18n.js";
import { enErrors } from "../src/locales/en.js";
import { zhErrors } from "../src/locales/zh.js";
import { explainRunReason } from "../src/refusalExplain.js";
import { reasonCode } from "../src/runFacts.js";

const REASONS = [
  "codex-result-invalid", "codex-events-invalid", "codex-no-completion", "codex-usage-invalid", "codex-usage-unavailable", "codex-event-error",
  "codex-timeout", "codex-skills-cleanup-failed", "codex-skills-path-conflict", "codex-skills-pending", "codex-skills-setup-failed",
  "codex-skills-source-invalid", "codex-exit-error", "terminal",
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

describe("archive-stop-pending names the recovery step (final fix wave W1)", () => {
  it("tells the person to retry recovery first when the stop is unresolved, in both languages", () => {
    expect(enErrors["archive-stop-pending"]).toContain("If it is unresolved, retry recovery first");
    expect(enErrors["archive-stop-pending"]).not.toContain("archive-stop-pending");
    expect(zhErrors["archive-stop-pending"]).toContain("如果停止状态未解决，请先重试恢复。");
  });

  // Final review M8: the server's detail is `<mode>:<state>` (archiveGroup.ts); the stop banner already says the stop's
  // mode and state in words, so the sentence carries no machine text.
  it("keeps the server's mode:state detail out of the sentence, in both languages", async () => {
    const refusal = { code: "archive-stop-pending", message: "archive-stop-pending:shutdown:handoff-pending", status: 409 };
    try {
      for (const language of ["en", "zh"]) {
        await i18n.changeLanguage(language);
        const text = refusalText(refusal);
        expect(text, language).not.toContain("handoff-pending");
        expect(text, language).not.toContain("{{");
        expect(text, language).toContain(language === "en" ? "A stop is still settling." : "停止还没有完成。");
      }
    } finally {
      await i18n.changeLanguage("en");
    }
  });
});

// Final review M4: Handoff stop is not rendered under a pause (ControlGroupView.tsx), though a paused group with an
// active run is refused archive-run-active; the text names what works there: Resume dispatch, then Handoff stop.
describe("archive-run-active names a way out a paused group has (final review M4)", () => {
  it("tells a paused group to resume dispatch before Handoff stop, in both languages", () => {
    expect(enErrors["archive-run-active"]).toContain("If the group is paused, press Resume dispatch first: Handoff stop is not offered under a pause.");
    expect(zhErrors["archive-run-active"]).toContain("如果组已暂停，先点「恢复调度」：暂停时不提供「交接停止」。");
  });
});

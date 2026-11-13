import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import i18n from "../src/i18n.js";
import { RunReason } from "../src/RunReason.js";
import { run } from "./fixtures/board.js";

afterEach(async () => { await i18n.changeLanguage("en"); });

const KIND = "execution-complete-before-verification-v1" as const;
const exhausted = (complete: boolean) => run({ runId: "run-x", state: "settled-failed", outcome: "exhausted", stopReason: "budget exhausted",
  failureCause: { cause: "budget-exhausted", phase: "execute", retries: 0, detail: null },
  ...(complete ? { executionCompleteBeforeVerification: { sourceKind: KIND, attempt: 2 } } : {}) });
const text = (html: string): string => html.replace(/<[^>]*>/g, "").replace(/&#x27;/g, "'");

// Tester #263 (follow-up I): a run whose execute completed and then stopped on its budget before verification showed only
// `exhausted`, so people re-ran it from scratch although its saved result can be verified. The reason says what happened
// (execute completed, verification did not run, the saved source) and the way out, in English and Chinese.
describe("an exhausted run whose execute completed says so (#263)", () => {
  // mutation M-I2d: RunReason drops completeLine -> red
  it("names the completed execute, the skipped verification, the source and the next step", async () => {
    const en = text(renderToStaticMarkup(<RunReason run={exhausted(true)} />));
    expect(en).toContain("Execute completed (attempt 2); verification did not run");
    expect(en).toContain(`(saved source: ${KIND})`);
    expect(en).toContain("Verify saved results on the task, or orca run eligibility run-x.");
    await i18n.changeLanguage("zh");
    const zh = text(renderToStaticMarkup(<RunReason run={exhausted(true)} />));
    expect(zh).toContain("执行已完成（第 2 次尝试）；验证没有运行");
    expect(zh).toContain("orca run eligibility run-x");
  });

  it("says nothing new for a plain exhausted run", () => {
    const html = renderToStaticMarkup(<RunReason run={exhausted(false)} />);
    expect(html).toContain("budget exhausted");
    expect(html).not.toContain("run-execution-complete");
    expect(html).not.toContain("Execute completed");
  });
});

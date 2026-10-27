import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import i18n from "../src/i18n.js";
import { RunReason } from "../src/RunReason.js";
import { run } from "./fixtures/board.js";

describe("run failure diagnosis", () => {
  it("shows typed phase and decode cause before the raw code and identity", () => {
    const html = renderToStaticMarkup(<RunReason run={run({ runId: "run-a", providerAttemptOrdinal: 2, state: "blocked", outcome: "failed", stopReason: "Error: codex-execution-format-invalid", diagnosis: { phase: "work", step: "executing", cause: "execution-format-invalid", attempt: 2 } })} />);
    expect(html).toContain("Execution output could not be decoded");
    expect(html).toContain("executing");
    expect(html).toContain("attempt 2");
    expect(html.indexOf("Execution output could not be decoded")).toBeLessThan(html.indexOf("codex-execution-format-invalid"));
    expect(html).toContain("run-a");
  });

  it("names an old unknown cause without inventing a token diagnosis", () => {
    const html = renderToStaticMarkup(<RunReason run={run({ runId: "run-old", state: "blocked", outcome: "failed", stopReason: "Error: strange-old-error", diagnosis: { phase: "work", step: null, cause: "unknown", attempt: 1 } })} />);
    expect(html).toContain("Cause unknown");
    expect(html).toContain("strange-old-error");
    expect(html).not.toMatch(/token budget|token exhaustion/i);
  });

  it("keeps the diagnosis for a settled failed run with no raw reason or code", () => {
    const html = renderToStaticMarkup(<RunReason run={run({ runId: "run-silent", providerAttemptOrdinal: 3, state: "settled-failed", outcome: "failed", stopReason: null, blockedReason: null, failureCode: null, diagnosis: { phase: "work", step: null, cause: "unknown", attempt: 3 } })} />);
    expect(html).toContain("Cause unknown");
    expect(html).toContain("attempt 3");
    expect(html).toContain("run-silent");
  });
});

// Failure-cause spec 2026-10-21 §5: ccloop's typed cause is worded with what to do next, in the reader's language, before
// the diagnosis; a cause this panel does not know reads as unknown; automatic retries are counted. Texts written out here.
describe("run failure cause (failure-cause spec §5)", () => {
  afterEach(async () => { await i18n.changeLanguage("en"); });
  const failed = (cause: string, retries = 0) => run({ runId: "run-c", state: "blocked", outcome: "failed", stopReason: "Error: codex-rate-limited: /x", failureCause: { cause, phase: "execute", retries, detail: null } });

  it("words the cause and its next step before the raw reason, in English and Chinese", async () => {
    const html = renderToStaticMarkup(<RunReason run={failed("quota")} />);
    expect(html).toContain("Why it stopped: the agent&#x27;s quota or credits are used up. Wait for the quota to reset or add credits, then retry the task.");
    expect(html.indexOf("Why it stopped")).toBeLessThan(html.indexOf("codex-rate-limited"));
    await i18n.changeLanguage("zh");
    expect(renderToStaticMarkup(<RunReason run={failed("quota")} />)).toContain("停止原因：agent 的额度或余额已用尽。等额度恢复或充值后，再重试这个任务。");
  });

  it("counts automatic retries, and reads a cause it does not know as unknown", () => {
    expect(renderToStaticMarkup(<RunReason run={failed("rate-limited", 3)} />)).toContain("the provider kept rate-limiting. Retry later; if it keeps happening, lower the running-group cap. (after 3 automatic retries)");
    expect(renderToStaticMarkup(<RunReason run={failed("a-newer-cause")} />)).toContain("Why it stopped: the cause is unknown. Review the evidence below, then retry the task.");
  });

  // ccloop per-contract tool rules spec 2026-10-22 §4, §9: a broken tool rule is its own cause, worded, not `unknown`.
  it("words a tool-rule violation, in English and Chinese", async () => {
    expect(renderToStaticMarkup(<RunReason run={failed("tool-rule-violated")} />)).toContain("Why it stopped: the agent broke the step&#x27;s tool rules. Read the tool-rule report and the evidence below, then fix the step&#x27;s tools or the task, and retry.");
    await i18n.changeLanguage("zh");
    expect(renderToStaticMarkup(<RunReason run={failed("tool-rule-violated")} />)).toContain("停止原因：agent 违反了这一步的工具规则。看下方工具规则报告和证据，改好这一步的 tools 或任务后重试。");
  });

  it("says nothing of a cause when ccloop stated none", () => {
    expect(renderToStaticMarkup(<RunReason run={run({ runId: "run-n", state: "blocked", outcome: "failed", stopReason: "Error: x", failureCause: null })} />)).not.toContain("Why it stopped");
  });

  // Issue #60: ccloop's cause parser leaves omp's forbidden-tool stop as `unknown` (or states none), and "review the
  // evidence" told the person nothing: the model reached for a tool the phase does not allow, and a retry or another
  // model/agent is the way on. The code's own next step replaces the unknown one; a cause ccloop did classify keeps its own.
  it("words omp's forbidden-tool stop as its next step when the cause is unknown or unstated, in English and Chinese", async () => {
    const forbidden = (failureCause: { cause: string; phase: string; retries: number; detail: null } | null, extra: Record<string, unknown> = {}) =>
      run({ runId: "run-f", state: "blocked", outcome: "failed", stopReason: "Error: omp-phase-tool-forbidden", failureCause, ...extra });
    const words = "Why it stopped: the cause is unknown. The model tried to use a tool this step does not allow (a plan phase may only read files; a single call may use none). Retry, or choose another model or agent.";
    expect(renderToStaticMarkup(<RunReason run={forbidden({ cause: "unknown", phase: "plan", retries: 0, detail: null })} />)).toContain(words);
    expect(renderToStaticMarkup(<RunReason run={forbidden(null, { stopReason: "Error: x", failureCode: "omp-phase-tool-forbidden" })} />)).toContain(words);
    expect(renderToStaticMarkup(<RunReason run={forbidden({ cause: "quota", phase: "plan", retries: 0, detail: null })} />)).toContain("Wait for the quota to reset or add credits, then retry the task.");
    expect(renderToStaticMarkup(<RunReason run={forbidden({ cause: "unknown", phase: "plan", retries: 0, detail: null }, { stopReason: "Error: omp-phase-tool-forbidden-later" })} />)).toContain("Review the evidence below, then retry the task.");
    await i18n.changeLanguage("zh");
    expect(renderToStaticMarkup(<RunReason run={forbidden({ cause: "unknown", phase: "plan", retries: 0, detail: null })} />)).toContain("停止原因：原因未知。模型试图使用这一步不允许的工具（plan 阶段只能读文件；单次调用不能用任何工具）。请重试，或换一个模型或 agent。");
  });
});

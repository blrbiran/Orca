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

  it("says nothing of a cause when ccloop stated none", () => {
    expect(renderToStaticMarkup(<RunReason run={run({ runId: "run-n", state: "blocked", outcome: "failed", stopReason: "Error: x", failureCause: null })} />)).not.toContain("Why it stopped");
  });
});

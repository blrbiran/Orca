/**
 * Feedback #62 (with #45/#48): ccloop fails a phase `codex-rate-limited: <evidenceDir>` when Codex answers HTTP 429 and its
 * backoff is used up (ccloop 3069dbf src/runtime/codex/codexAdapter.ts). The run view must say what happened and what to
 * do, in the reader's language, with the raw reason beside it -- not the bare code alone. The texts are written out here
 * (not read from the tables) so a dropped entry and a zh entry left in English both turn this red.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import i18n from "../src/i18n.js";
import { RunReason } from "../src/RunReason.js";
import { run } from "./fixtures/board.js";

const EN = "The provider rate-limited the Codex call (HTTP 429). Retry the task later, once the provider quota window has passed; a call refused before any work booked no usage.";
const ZH = "服务商对这次 Codex 调用限流了（HTTP 429）。请稍后重试这个任务，等服务商的额度窗口过去之后再试；开始工作之前就被拒绝的调用不计用量。";
const failed = run({ runId: "run-429", state: "blocked", outcome: "failed", stopReason: "Error: codex-rate-limited: /x/y" });

describe("a Codex 429 shows words, not only a code (feedback #62)", () => {
  it("explains it in English beside the raw reason, and keeps the evidence path out of the sentence", () => {
    const html = renderToStaticMarkup(<RunReason run={failed} />);
    expect(html, "en text").toContain(`${EN} <code>Error: codex-rate-limited: /x/y</code>`);
  });

  it("explains it in Chinese", async () => {
    await i18n.changeLanguage("zh");
    const html = renderToStaticMarkup(<RunReason run={failed} />);
    expect(html, "zh text").toContain(`${ZH} <code>Error: codex-rate-limited: /x/y</code>`);
  });
});

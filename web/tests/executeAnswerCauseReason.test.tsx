import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import i18n from "../src/i18n.js";
import { RunReason } from "../src/RunReason.js";
import { run } from "./fixtures/board.js";

afterEach(async () => { await i18n.changeLanguage("en"); });

const text = (html: string): string => html.replace(/<[^>]*>/g, "").replace(/&#x27;/g, "'");
const stopped = (cause: string) => run({ runId: "run-n", state: "blocked", outcome: "failed", stopReason: "ExecutionFormatFailure: SyntaxError: Unexpected token 'I'",
  failureCause: { cause, phase: "execute", retries: 0, detail: null } });

// Tester #347: the panel words ccloop's three execute-answer causes (they read as "unknown" before), in English and
// Chinese; a cause it does not know still reads as unknown.
describe("a run whose execute answer ccloop could not take (#347)", () => {
  it("names narration-only and says the next retry is told", async () => {
    // mutation N4 (narration-only missing from KNOWN_FAILURE_CAUSES) -> "the cause is unknown", red here.
    expect(text(renderToStaticMarkup(<RunReason run={stopped("narration-only")} />))).toContain("Why it stopped: the agent ended its turn after a short message without doing the task. Retry the task; the next retry of this task is told that the previous attempt stopped without working.");
    await i18n.changeLanguage("zh");
    expect(text(renderToStaticMarkup(<RunReason run={stopped("narration-only")} />))).toContain("agent 只说了一句话就结束了这一轮，没有执行任务");
    expect(text(renderToStaticMarkup(<RunReason run={stopped("narration-only")} />))).toContain("这个任务的下一次重试会被告知");
  });

  it("names execution-not-json and execution-shape", async () => {
    expect(text(renderToStaticMarkup(<RunReason run={stopped("execution-not-json")} />))).toContain("Why it stopped: the agent's final message was not the JSON answer.");
    expect(text(renderToStaticMarkup(<RunReason run={stopped("execution-shape")} />))).toContain("Why it stopped: the agent's JSON answer did not have the required shape.");
    await i18n.changeLanguage("zh");
    expect(text(renderToStaticMarkup(<RunReason run={stopped("execution-not-json")} />))).toContain("agent 的最终消息不是 JSON 答案");
    expect(text(renderToStaticMarkup(<RunReason run={stopped("execution-shape")} />))).toContain("agent 的 JSON 答案不符合要求的格式");
  });

  it("still reads a cause it does not know as unknown", () => {
    expect(text(renderToStaticMarkup(<RunReason run={stopped("some-future-cause")} />))).toContain("Why it stopped: the cause is unknown.");
  });
});

import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import i18n from "../src/i18n.js";
import { RunReason } from "../src/RunReason.js";
import { run } from "./fixtures/board.js";

afterEach(async () => { await i18n.changeLanguage("en"); });

const text = (html: string): string => html.replace(/<[^>]*>/g, "").replace(/&#x27;/g, "'");

/**
 * Session 3cfc2e73 D7 (#158): an omp execute format failure's work lives only under ccloop's attempt refs; the run reason
 * names each ref, what it changed and the git command to see it, so the person can take the work by hand.
 */
describe("an execute format failure names the attempt's refs (D7)", () => {
  const BASE = "1234567890abcdef1234567890abcdef12345678", COMMIT = "fedcba0987654321fedcba0987654321fedcba09";
  const formatRun = () => run({ runId: "run-f", state: "blocked", outcome: "failed", stopReason: "Error: omp-execution-format-invalid",
    diagnosis: { phase: "work", step: "executing", cause: "execution-format-invalid", attempt: 2, formatFailureWork: {
      attempt: 2, attemptBase: BASE,
      refs: [
        { ref: "refs/ccloop/run-f/attempts/2", commit: COMMIT, files: ["src/a.ts", "src/b.ts"], filesMore: false, stat: [" src/a.ts | 3 ++-", " src/b.ts | 1 +", " 2 files changed, 3 insertions(+), 1 deletion(-)"] },
        { ref: "refs/ccloop/run-f/attempts/2-pre", commit: null, files: [], filesMore: false, stat: [] },
      ],
      issues: [{ path: "", message: "Expected object" }],
    } } });

  it("lists each ref with its commit, files, stat and the git diff line; a missing ref is said to be missing", async () => {
    const html = text(renderToStaticMarkup(<RunReason run={formatRun()} />));
    expect(html).toContain("Execute format failure (attempt 2): the attempt's work is kept under these refs in the project repository on base 1234567890ab");
    expect(html).toContain("Refused: (top level): Expected object");
    expect(html).toContain("refs/ccloop/run-f/attempts/2 = fedcba098765 — 2 files changed");
    expect(html).toContain("src/a.ts | 3 ++-\nsrc/b.ts | 1 +\n2 files changed, 3 insertions(+), 1 deletion(-)");
    expect(html).toContain("see it: git diff 1234567890ab refs/ccloop/run-f/attempts/2");
    expect(html).toContain("refs/ccloop/run-f/attempts/2-pre — not found in the project repository (not published yet, or removed)");
    expect(html).not.toContain("git diff 1234567890ab refs/ccloop/run-f/attempts/2-pre");
    await i18n.changeLanguage("zh");
    const zh = text(renderToStaticMarkup(<RunReason run={formatRun()} />));
    expect(zh).toContain("执行格式失败（第 2 次尝试）：这次尝试的成果保存在项目仓库的下列 ref 下 基于 1234567890ab");
    expect(zh).toContain("改了 2 个文件");
    expect(zh).toContain("查看： git diff 1234567890ab refs/ccloop/run-f/attempts/2");
  });

  it("shows nothing extra for a run without it", () => {
    expect(renderToStaticMarkup(<RunReason run={run({ runId: "run-f", state: "blocked", outcome: "failed", stopReason: "Error: x", diagnosis: { phase: "work", step: null, cause: "unknown", attempt: 1 } })} />)).not.toContain("run-format-failure-work");
  });
});

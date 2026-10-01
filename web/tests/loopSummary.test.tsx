/**
 * Panel i18n spec §3.1, §6.3: the panel builds a loop task's card lines from the view's fields, and in English they are
 * exactly the lines the server's describeLoopPlan produced before its removal -- pinned below as literals captured from it
 * at ac969bb for every plan and version and a case set (one or two paths; protected paths or none; file cap unset, 1 or
 * 25; one or two checks). Carried over from the removed tests/control/loopPlanSummary.test.ts (loop plans spec §2.1,
 * §4.1): no line carries a check command's text or a rejectOn token, only the agent-verified plans say a model checks
 * them, and the red-first line is bugfix's alone. Review Focus 3: a plan version this panel has no words for.
 */
import { describe, expect, it } from "vitest";
import i18n from "../src/i18n.js";
import { loopPlanTitle, loopSummaryLines, planText } from "../src/LoopPlanCard.js";
import type { LoopInputsV1, LoopPlanIdV1, LoopPlanViewV1 } from "../src/controlTypes.js";

type CaseName = "one-path" | "two-paths-protected-cap1" | "protected-two-cap25" | "two-paths-one-check";
const base = { goal: "fix login", successCondition: "the login test passes", nonGoals: [], relevantDocs: [] };
function inputsFor(planId: LoopPlanIdV1, name: CaseName): LoopInputsV1 {
  const one = planId === "investigate" ? ["docs/report.md"] : ["src/auth/**"];
  const two = planId === "investigate" ? ["docs/report.md"] : ["src/auth/**", "tests/auth/**"];
  switch (name) {
    case "one-path": return { ...base, targetPaths: one, checks: ["npm test"], protectedPaths: [], maxFilesTouched: null };
    case "two-paths-protected-cap1": return { ...base, targetPaths: two, checks: ["npm test", "npm run lint"], protectedPaths: ["tests/fixtures/**"], maxFilesTouched: 1 };
    case "protected-two-cap25": return { ...base, targetPaths: one, checks: ["npm test", "npm run lint"], protectedPaths: ["docs/**", "scripts/**"], maxFilesTouched: planId === "investigate" ? null : 25 };
    case "two-paths-one-check": return { ...base, targetPaths: two, checks: ["npm run lint"], protectedPaths: [], maxFilesTouched: null };
  }
}
const viewOf = (planId: LoopPlanIdV1, planVersion: number, name: CaseName, maxFiles: number, hasDiscipline: boolean): LoopPlanViewV1 => ({
  planId, planVersion, chosenBy: "labels", chosenByLabel: "bug", amended: false, loopVersion: 0, inputs: inputsFor(planId, name), maxFiles, hasDiscipline,
});

// Captured from describeLoopPlan at ac969bb (plan Task 3 step 1 re-captures and compares before the removal).
// Rewritten under the human's 2026-10-01 ruling on C4: design v2 and investigate v2 carry their new registry text.
const ROWS: Array<[LoopPlanIdV1, number, CaseName, number, boolean, string[]]> = [
  ["standard", 1, "one-path", 25, false, ["Goal: fix login","Done when: the login test passes","Only changes: src/auth/**","At most 25 files changed (reported by the agent)","Acceptance: 1 check command, all must pass"]],
  ["standard", 1, "two-paths-protected-cap1", 1, false, ["Goal: fix login","Done when: the login test passes","Only changes: src/auth/**, tests/auth/**","Must not change: tests/fixtures/** (reported by the agent, not checked in git)","At most 1 file changed (reported by the agent)","Acceptance: 2 check commands, all must pass"]],
  ["standard", 1, "protected-two-cap25", 25, false, ["Goal: fix login","Done when: the login test passes","Only changes: src/auth/**","Must not change: docs/**, scripts/** (reported by the agent, not checked in git)","At most 25 files changed (reported by the agent)","Acceptance: 2 check commands, all must pass"]],
  ["standard", 1, "two-paths-one-check", 25, false, ["Goal: fix login","Done when: the login test passes","Only changes: src/auth/**, tests/auth/**","At most 25 files changed (reported by the agent)","Acceptance: 1 check command, all must pass"]],
  ["standard", 2, "one-path", Number.MAX_SAFE_INTEGER, false, ["Goal: fix login","Done when: the login test passes","Only changes: src/auth/**","No file limit","Acceptance: 1 check command, all must pass"]],
  ["standard", 2, "two-paths-protected-cap1", 1, false, ["Goal: fix login","Done when: the login test passes","Only changes: src/auth/**, tests/auth/**","Must not change: tests/fixtures/** (reported by the agent, not checked in git)","At most 1 file changed (reported by the agent)","Acceptance: 2 check commands, all must pass"]],
  ["standard", 2, "protected-two-cap25", 25, false, ["Goal: fix login","Done when: the login test passes","Only changes: src/auth/**","Must not change: docs/**, scripts/** (reported by the agent, not checked in git)","At most 25 files changed (reported by the agent)","Acceptance: 2 check commands, all must pass"]],
  ["standard", 2, "two-paths-one-check", Number.MAX_SAFE_INTEGER, false, ["Goal: fix login","Done when: the login test passes","Only changes: src/auth/**, tests/auth/**","No file limit","Acceptance: 1 check command, all must pass"]],
  ["bugfix", 1, "one-path", 25, true, ["Goal: fix login","Done when: the login test passes","Only changes: src/auth/**","At most 25 files changed (reported by the agent)","Acceptance: 1 check command, all must pass","Write a failing test that reproduces the bug, then fix it (checked by a model, not proven mechanically)"]],
  ["bugfix", 1, "two-paths-protected-cap1", 1, true, ["Goal: fix login","Done when: the login test passes","Only changes: src/auth/**, tests/auth/**","Must not change: tests/fixtures/** (reported by the agent, not checked in git)","At most 1 file changed (reported by the agent)","Acceptance: 2 check commands, all must pass","Write a failing test that reproduces the bug, then fix it (checked by a model, not proven mechanically)"]],
  ["bugfix", 1, "protected-two-cap25", 25, true, ["Goal: fix login","Done when: the login test passes","Only changes: src/auth/**","Must not change: docs/**, scripts/** (reported by the agent, not checked in git)","At most 25 files changed (reported by the agent)","Acceptance: 2 check commands, all must pass","Write a failing test that reproduces the bug, then fix it (checked by a model, not proven mechanically)"]],
  ["bugfix", 1, "two-paths-one-check", 25, true, ["Goal: fix login","Done when: the login test passes","Only changes: src/auth/**, tests/auth/**","At most 25 files changed (reported by the agent)","Acceptance: 1 check command, all must pass","Write a failing test that reproduces the bug, then fix it (checked by a model, not proven mechanically)"]],
  ["bugfix", 2, "one-path", Number.MAX_SAFE_INTEGER, true, ["Goal: fix login","Done when: the login test passes","Only changes: src/auth/**","No file limit","Acceptance: 1 check command, all must pass","Write a failing test that reproduces the bug, then fix it (checked by a model, not proven mechanically)"]],
  ["bugfix", 2, "two-paths-protected-cap1", 1, true, ["Goal: fix login","Done when: the login test passes","Only changes: src/auth/**, tests/auth/**","Must not change: tests/fixtures/** (reported by the agent, not checked in git)","At most 1 file changed (reported by the agent)","Acceptance: 2 check commands, all must pass","Write a failing test that reproduces the bug, then fix it (checked by a model, not proven mechanically)"]],
  ["bugfix", 2, "protected-two-cap25", 25, true, ["Goal: fix login","Done when: the login test passes","Only changes: src/auth/**","Must not change: docs/**, scripts/** (reported by the agent, not checked in git)","At most 25 files changed (reported by the agent)","Acceptance: 2 check commands, all must pass","Write a failing test that reproduces the bug, then fix it (checked by a model, not proven mechanically)"]],
  ["bugfix", 2, "two-paths-one-check", Number.MAX_SAFE_INTEGER, true, ["Goal: fix login","Done when: the login test passes","Only changes: src/auth/**, tests/auth/**","No file limit","Acceptance: 1 check command, all must pass","Write a failing test that reproduces the bug, then fix it (checked by a model, not proven mechanically)"]],
  ["refactor", 1, "one-path", 25, true, ["Goal: fix login","Done when: the login test passes","Only changes: src/auth/**","At most 25 files changed (reported by the agent)","Acceptance: 1 check command, all must pass","No observable behavior change (an instruction to the agent; only the checks are enforced)"]],
  ["refactor", 1, "two-paths-protected-cap1", 1, true, ["Goal: fix login","Done when: the login test passes","Only changes: src/auth/**, tests/auth/**","Must not change: tests/fixtures/** (reported by the agent, not checked in git)","At most 1 file changed (reported by the agent)","Acceptance: 2 check commands, all must pass","No observable behavior change (an instruction to the agent; only the checks are enforced)"]],
  ["refactor", 1, "protected-two-cap25", 25, true, ["Goal: fix login","Done when: the login test passes","Only changes: src/auth/**","Must not change: docs/**, scripts/** (reported by the agent, not checked in git)","At most 25 files changed (reported by the agent)","Acceptance: 2 check commands, all must pass","No observable behavior change (an instruction to the agent; only the checks are enforced)"]],
  ["refactor", 1, "two-paths-one-check", 25, true, ["Goal: fix login","Done when: the login test passes","Only changes: src/auth/**, tests/auth/**","At most 25 files changed (reported by the agent)","Acceptance: 1 check command, all must pass","No observable behavior change (an instruction to the agent; only the checks are enforced)"]],
  ["refactor", 2, "one-path", Number.MAX_SAFE_INTEGER, true, ["Goal: fix login","Done when: the login test passes","Only changes: src/auth/**","No file limit","Acceptance: 1 check command, all must pass","No observable behavior change (an instruction to the agent; only the checks are enforced)"]],
  ["refactor", 2, "two-paths-protected-cap1", 1, true, ["Goal: fix login","Done when: the login test passes","Only changes: src/auth/**, tests/auth/**","Must not change: tests/fixtures/** (reported by the agent, not checked in git)","At most 1 file changed (reported by the agent)","Acceptance: 2 check commands, all must pass","No observable behavior change (an instruction to the agent; only the checks are enforced)"]],
  ["refactor", 2, "protected-two-cap25", 25, true, ["Goal: fix login","Done when: the login test passes","Only changes: src/auth/**","Must not change: docs/**, scripts/** (reported by the agent, not checked in git)","At most 25 files changed (reported by the agent)","Acceptance: 2 check commands, all must pass","No observable behavior change (an instruction to the agent; only the checks are enforced)"]],
  ["refactor", 2, "two-paths-one-check", Number.MAX_SAFE_INTEGER, true, ["Goal: fix login","Done when: the login test passes","Only changes: src/auth/**, tests/auth/**","No file limit","Acceptance: 1 check command, all must pass","No observable behavior change (an instruction to the agent; only the checks are enforced)"]],
  ["design", 1, "one-path", 25, true, ["Goal: fix login","Done when: the login test passes","Only changes: src/auth/**","At most 25 files changed (reported by the agent)","Acceptance: 1 check command, all must pass","The deliverable is a document, no code changes (checked by a model, not proven mechanically)"]],
  ["design", 1, "two-paths-protected-cap1", 1, true, ["Goal: fix login","Done when: the login test passes","Only changes: src/auth/**, tests/auth/**","Must not change: tests/fixtures/** (reported by the agent, not checked in git)","At most 1 file changed (reported by the agent)","Acceptance: 2 check commands, all must pass","The deliverable is a document, no code changes (checked by a model, not proven mechanically)"]],
  ["design", 1, "protected-two-cap25", 25, true, ["Goal: fix login","Done when: the login test passes","Only changes: src/auth/**","Must not change: docs/**, scripts/** (reported by the agent, not checked in git)","At most 25 files changed (reported by the agent)","Acceptance: 2 check commands, all must pass","The deliverable is a document, no code changes (checked by a model, not proven mechanically)"]],
  ["design", 1, "two-paths-one-check", 25, true, ["Goal: fix login","Done when: the login test passes","Only changes: src/auth/**, tests/auth/**","At most 25 files changed (reported by the agent)","Acceptance: 1 check command, all must pass","The deliverable is a document, no code changes (checked by a model, not proven mechanically)"]],
  ["design", 2, "one-path", Number.MAX_SAFE_INTEGER, true, ["Goal: fix login","Done when: the login test passes","Only changes: src/auth/**","No file limit","Acceptance: 1 check command, all must pass","The deliverable is a document: a command checks that it exists and is not empty; \"no code changes\" is an instruction to the agent"]],
  ["design", 2, "two-paths-protected-cap1", 1, true, ["Goal: fix login","Done when: the login test passes","Only changes: src/auth/**, tests/auth/**","Must not change: tests/fixtures/** (reported by the agent, not checked in git)","At most 1 file changed (reported by the agent)","Acceptance: 2 check commands, all must pass","The deliverable is a document: a command checks that it exists and is not empty; \"no code changes\" is an instruction to the agent"]],
  ["design", 2, "protected-two-cap25", 25, true, ["Goal: fix login","Done when: the login test passes","Only changes: src/auth/**","Must not change: docs/**, scripts/** (reported by the agent, not checked in git)","At most 25 files changed (reported by the agent)","Acceptance: 2 check commands, all must pass","The deliverable is a document: a command checks that it exists and is not empty; \"no code changes\" is an instruction to the agent"]],
  ["design", 2, "two-paths-one-check", Number.MAX_SAFE_INTEGER, true, ["Goal: fix login","Done when: the login test passes","Only changes: src/auth/**, tests/auth/**","No file limit","Acceptance: 1 check command, all must pass","The deliverable is a document: a command checks that it exists and is not empty; \"no code changes\" is an instruction to the agent"]],
  ["investigate", 1, "one-path", 1, true, ["Goal: fix login","Done when: the login test passes","Only changes: docs/report.md","At most 1 file changed (reported by the agent)","Acceptance: 1 check command, all must pass","Investigate only; findings go to the report file, nothing else changes (checked by a model, not proven mechanically)"]],
  ["investigate", 1, "two-paths-protected-cap1", 1, true, ["Goal: fix login","Done when: the login test passes","Only changes: docs/report.md","Must not change: tests/fixtures/** (reported by the agent, not checked in git)","At most 1 file changed (reported by the agent)","Acceptance: 2 check commands, all must pass","Investigate only; findings go to the report file, nothing else changes (checked by a model, not proven mechanically)"]],
  ["investigate", 1, "protected-two-cap25", 1, true, ["Goal: fix login","Done when: the login test passes","Only changes: docs/report.md","Must not change: docs/**, scripts/** (reported by the agent, not checked in git)","At most 1 file changed (reported by the agent)","Acceptance: 2 check commands, all must pass","Investigate only; findings go to the report file, nothing else changes (checked by a model, not proven mechanically)"]],
  ["investigate", 1, "two-paths-one-check", 1, true, ["Goal: fix login","Done when: the login test passes","Only changes: docs/report.md","At most 1 file changed (reported by the agent)","Acceptance: 1 check command, all must pass","Investigate only; findings go to the report file, nothing else changes (checked by a model, not proven mechanically)"]],
  ["investigate", 2, "one-path", 1, true, ["Goal: fix login","Done when: the login test passes","Only changes: docs/report.md","At most 1 file changed (reported by the agent)","Acceptance: 1 check command, all must pass","Investigate only; findings go to the report file: a command checks that it exists and is not empty"]],
  ["investigate", 2, "two-paths-protected-cap1", 1, true, ["Goal: fix login","Done when: the login test passes","Only changes: docs/report.md","Must not change: tests/fixtures/** (reported by the agent, not checked in git)","At most 1 file changed (reported by the agent)","Acceptance: 2 check commands, all must pass","Investigate only; findings go to the report file: a command checks that it exists and is not empty"]],
  ["investigate", 2, "protected-two-cap25", 1, true, ["Goal: fix login","Done when: the login test passes","Only changes: docs/report.md","Must not change: docs/**, scripts/** (reported by the agent, not checked in git)","At most 1 file changed (reported by the agent)","Acceptance: 2 check commands, all must pass","Investigate only; findings go to the report file: a command checks that it exists and is not empty"]],
  ["investigate", 2, "two-paths-one-check", 1, true, ["Goal: fix login","Done when: the login test passes","Only changes: docs/report.md","At most 1 file changed (reported by the agent)","Acceptance: 1 check command, all must pass","Investigate only; findings go to the report file: a command checks that it exists and is not empty"]],
];

describe("the loop card's lines, built by the panel (spec §6.3)", () => {
  it.each(ROWS)("%s v%i %s: the English lines equal describeLoopPlan's", (planId, version, name, maxFiles, hasDiscipline, lines) => {
    expect(loopSummaryLines(viewOf(planId, version, name, maxFiles, hasDiscipline))).toEqual(lines);
  });

  it("never puts a check command's text or a rejectOn token into a line; only agent-verified plans say a model checks them", () => {
    for (const [planId, version, name, maxFiles, hasDiscipline] of ROWS) {
      const view = viewOf(planId, version, name, maxFiles, hasDiscipline);
      const lines = loopSummaryLines(view);
      for (const line of lines) {
        for (const check of view.inputs.checks) expect(line).not.toContain(check);
        expect(line).not.toContain("REJECT:");
      }
      // Rewritten under the human's 2026-10-01 ruling on C4: design v2 and investigate v2 are checked by a command.
      const agentVerified = planId === "bugfix" || (["design", "investigate"].includes(planId) && version === 1);
      expect(lines.filter((line) => line.includes("checked by a model")).length, `${planId} v${version}`).toBe(agentVerified ? 1 : 0);
      expect(lines.some((line) => line.startsWith("Write a failing test")), `${planId} v${version}`).toBe(planId === "bugfix");
    }
  });

  it("builds the lines, the title and the name in Chinese from the same fields (spec §5)", async () => {
    await i18n.changeLanguage("zh");
    expect(loopSummaryLines(viewOf("bugfix", 2, "two-paths-protected-cap1", 1, true))).toEqual([
      "目标：fix login",
      "完成条件：the login test passes",
      "只改：src/auth/**、tests/auth/**",
      "不许改：tests/fixtures/**（由 agent 自报，不是 git 检查）",
      "最多改 1 个文件（由 agent 自报）",
      "验收：运行 2 条检查命令，全部通过",
      "先写能复现的失败测试再修（由模型核对，不是机械证明）",
    ]);
    expect(loopSummaryLines(viewOf("standard", 2, "one-path", Number.MAX_SAFE_INTEGER, false))).toContain("不限文件数");
    expect(loopPlanTitle({ ...viewOf("bugfix", 2, "one-path", Number.MAX_SAFE_INTEGER, true), amended: true })).toBe("修 bug（先红后绿） · v2 · 按标签 `bug` 选择 · 已修改");
    expect(planText("design", 1, "name")).toBe("先写设计／文档");
  });

  it("shows a plan version this panel has no words for by its id, and keeps its discipline line (Review Focus 3)", () => {
    const unknown = viewOf("bugfix", 9, "one-path", 25, true);
    expect(planText("bugfix", 9, "name")).toBe("bugfix");
    expect(loopPlanTitle(unknown)).toBe("bugfix · v9 · chosen by label `bug`");
    expect(loopSummaryLines(unknown).at(-1)).toBe("bugfix v9");
  });
});

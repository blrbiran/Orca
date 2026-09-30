### Task 3: The loop plan view sends fields; the panel builds the plan's words

Spec §3.1, §6.3, §6.8, §6.9. The server, the strict schema, the web mirror and the parity criteria change together, and
the card's lines are built by the panel in the same commit, so no commit leaves the card without its lines.

**Files:**
- Modify: `src/control/webProtocol.ts:953-967` (`loopPlanViewSchema`)
- Modify: `src/panel/controlViews.ts:12` (import), `:478` (doc), `:492-504` (`taskPlanView`)
- Modify: `src/control/loopPlans.ts:22` (doc), `:29` (doc), `:168` (doc), `:244-270` (remove `countOf`, `describeLoopPlan`)
- Modify: `web/src/controlTypes.ts:345-363` (`LoopPlanViewV1`, `WEB_LOOP_PLANS`)
- Modify: `web/src/LoopPlanCard.tsx:1-20` (header, imports, title), `:131` (picker), `:149-172` (card lines)
- Modify: `web/src/ControlGroupView.tsx:20` (import), `:132` (chip)
- Modify: `web/src/locales/en.ts`, `web/src/locales/zh.ts` (`loopPlan` area)
- Delete: `tests/control/loopPlanSummary.test.ts`
- Create: `tests/control/loopPlanViewFields.test.ts`, `web/tests/loopSummary.test.tsx`
- Modify (existing criteria, H18): `tests/control/loopPlanView.test.ts:2,16-25`, `tests/panel/taskLoopApi.test.ts:6,75-78`, `web/tests/loopPlanCard.test.tsx:25,27,51,75`, `web/tests/loopBudgetRows.test.tsx:25,27`, `web/tests/loopPlanDraft.test.tsx:37,39`, `web/tests/loopPlanEdit.test.tsx:26,28`, `web/tests/loopSuggestionApply.test.tsx:26,28`, `web/tests/loopSuggestionDraft.test.tsx:24,26`

**Interfaces:**
- Changes: `loopPlanViewSchema` / `LoopPlanViewV1` = `{ planId, planVersion, chosenBy, chosenByLabel, amended, loopVersion, inputs, maxFiles, hasDiscipline }` (strict; no `planName`, no `summary`). `WEB_LOOP_PLANS: ReadonlyArray<{ planId: LoopPlanIdV1; version: number }>`.
- Removes: `describeLoopPlan` (and its private `countOf`) from `src/control/loopPlans.ts`.
- Produces (`web/src/LoopPlanCard.tsx`):
  ```ts
  export function planText(planId: LoopPlanIdV1, version: number, part: "name" | "discipline"): string;
  export function loopPlanTitle(plan: LoopPlanViewV1): string;          // signature kept
  export function loopSummaryLines(plan: LoopPlanViewV1): string[];
  ```

- [ ] **Step 1: Re-capture `describeLoopPlan`'s lines before removing it** (spec §6.3: "the lines `describeLoopPlan` produced before its removal"). Write `$SCRATCH/t3-capture.ts`:

```ts
// Panel i18n plan Task 3 step 1: describeLoopPlan's English lines for the §6.3 case set, one TS row per case.
const { LOOP_PLAN_IDS, describeLoopPlan, loopPlanDefinition } = await import(`${process.env.REPO}/src/control/loopPlans.ts`);
type Inputs = { goal: string; successCondition: string; targetPaths: string[]; checks: string[]; nonGoals: string[]; relevantDocs: string[]; protectedPaths: string[]; maxFilesTouched: number | null };
const base = { goal: "fix login", successCondition: "the login test passes", nonGoals: [], relevantDocs: [] };
const CASES: Array<[string, (planId: string) => Inputs]> = [
  ["one-path", (p) => ({ ...base, targetPaths: [p === "investigate" ? "docs/report.md" : "src/auth/**"], checks: ["npm test"], protectedPaths: [], maxFilesTouched: null })],
  ["two-paths-protected-cap1", (p) => ({ ...base, targetPaths: p === "investigate" ? ["docs/report.md"] : ["src/auth/**", "tests/auth/**"], checks: ["npm test", "npm run lint"], protectedPaths: ["tests/fixtures/**"], maxFilesTouched: 1 })],
  ["protected-two-cap25", (p) => ({ ...base, targetPaths: [p === "investigate" ? "docs/report.md" : "src/auth/**"], checks: ["npm test", "npm run lint"], protectedPaths: ["docs/**", "scripts/**"], maxFilesTouched: p === "investigate" ? null : 25 })],
  ["two-paths-one-check", (p) => ({ ...base, targetPaths: p === "investigate" ? ["docs/report.md"] : ["src/auth/**", "tests/auth/**"], checks: ["npm run lint"], protectedPaths: [], maxFilesTouched: null })],
];
const rows: string[] = [];
for (const planId of LOOP_PLAN_IDS) for (const planVersion of [1, 2]) for (const [name, inputsOf] of CASES) {
  const inputs = inputsOf(planId);
  const plan = loopPlanDefinition(planId, planVersion)!;
  // The view's maxFiles is the expanded contract's safetyPolicy.maxFilesTouched (loopPlans.ts maxFilesOf).
  const maxFiles = planId === "investigate" ? 1 : inputs.maxFilesTouched ?? plan.defaultMaxFilesTouched;
  const lines = describeLoopPlan({ planId, planVersion, inputs })!.summary;
  rows.push(`  [${JSON.stringify(planId)}, ${planVersion}, ${JSON.stringify(name)}, ${maxFiles === Number.MAX_SAFE_INTEGER ? "Number.MAX_SAFE_INTEGER" : maxFiles}, ${plan.discipline !== null}, ${JSON.stringify(lines)}],`);
}
process.stdout.write(`${rows.join("\n")}\n`);
```

```bash
REPO="$REPO" ./node_modules/.bin/tsx "$SCRATCH/t3-capture.ts" > "$SCRATCH/t3-capture.txt" 2>&1; echo rc=$?
```
Expected `rc=0` and 40 lines, identical to the `ROWS` body of `web/tests/loopSummary.test.tsx` below (Step 2 checks it with `cmp`). If they differ, stop: the registry moved since `ac969bb`; report, do not edit the literals.

- [ ] **Step 2: Write the failing criteria**

`web/tests/loopSummary.test.tsx`:

```tsx
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
  ["design", 2, "one-path", Number.MAX_SAFE_INTEGER, true, ["Goal: fix login","Done when: the login test passes","Only changes: src/auth/**","No file limit","Acceptance: 1 check command, all must pass","The deliverable is a document, no code changes (checked by a model, not proven mechanically)"]],
  ["design", 2, "two-paths-protected-cap1", 1, true, ["Goal: fix login","Done when: the login test passes","Only changes: src/auth/**, tests/auth/**","Must not change: tests/fixtures/** (reported by the agent, not checked in git)","At most 1 file changed (reported by the agent)","Acceptance: 2 check commands, all must pass","The deliverable is a document, no code changes (checked by a model, not proven mechanically)"]],
  ["design", 2, "protected-two-cap25", 25, true, ["Goal: fix login","Done when: the login test passes","Only changes: src/auth/**","Must not change: docs/**, scripts/** (reported by the agent, not checked in git)","At most 25 files changed (reported by the agent)","Acceptance: 2 check commands, all must pass","The deliverable is a document, no code changes (checked by a model, not proven mechanically)"]],
  ["design", 2, "two-paths-one-check", Number.MAX_SAFE_INTEGER, true, ["Goal: fix login","Done when: the login test passes","Only changes: src/auth/**, tests/auth/**","No file limit","Acceptance: 1 check command, all must pass","The deliverable is a document, no code changes (checked by a model, not proven mechanically)"]],
  ["investigate", 1, "one-path", 1, true, ["Goal: fix login","Done when: the login test passes","Only changes: docs/report.md","At most 1 file changed (reported by the agent)","Acceptance: 1 check command, all must pass","Investigate only; findings go to the report file, nothing else changes (checked by a model, not proven mechanically)"]],
  ["investigate", 1, "two-paths-protected-cap1", 1, true, ["Goal: fix login","Done when: the login test passes","Only changes: docs/report.md","Must not change: tests/fixtures/** (reported by the agent, not checked in git)","At most 1 file changed (reported by the agent)","Acceptance: 2 check commands, all must pass","Investigate only; findings go to the report file, nothing else changes (checked by a model, not proven mechanically)"]],
  ["investigate", 1, "protected-two-cap25", 1, true, ["Goal: fix login","Done when: the login test passes","Only changes: docs/report.md","Must not change: docs/**, scripts/** (reported by the agent, not checked in git)","At most 1 file changed (reported by the agent)","Acceptance: 2 check commands, all must pass","Investigate only; findings go to the report file, nothing else changes (checked by a model, not proven mechanically)"]],
  ["investigate", 1, "two-paths-one-check", 1, true, ["Goal: fix login","Done when: the login test passes","Only changes: docs/report.md","At most 1 file changed (reported by the agent)","Acceptance: 1 check command, all must pass","Investigate only; findings go to the report file, nothing else changes (checked by a model, not proven mechanically)"]],
  ["investigate", 2, "one-path", 1, true, ["Goal: fix login","Done when: the login test passes","Only changes: docs/report.md","At most 1 file changed (reported by the agent)","Acceptance: 1 check command, all must pass","Investigate only; findings go to the report file, nothing else changes (checked by a model, not proven mechanically)"]],
  ["investigate", 2, "two-paths-protected-cap1", 1, true, ["Goal: fix login","Done when: the login test passes","Only changes: docs/report.md","Must not change: tests/fixtures/** (reported by the agent, not checked in git)","At most 1 file changed (reported by the agent)","Acceptance: 2 check commands, all must pass","Investigate only; findings go to the report file, nothing else changes (checked by a model, not proven mechanically)"]],
  ["investigate", 2, "protected-two-cap25", 1, true, ["Goal: fix login","Done when: the login test passes","Only changes: docs/report.md","Must not change: docs/**, scripts/** (reported by the agent, not checked in git)","At most 1 file changed (reported by the agent)","Acceptance: 2 check commands, all must pass","Investigate only; findings go to the report file, nothing else changes (checked by a model, not proven mechanically)"]],
  ["investigate", 2, "two-paths-one-check", 1, true, ["Goal: fix login","Done when: the login test passes","Only changes: docs/report.md","At most 1 file changed (reported by the agent)","Acceptance: 1 check command, all must pass","Investigate only; findings go to the report file, nothing else changes (checked by a model, not proven mechanically)"]],
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
      expect(lines.filter((line) => line.includes("checked by a model")).length, `${planId} v${version}`).toBe(["bugfix", "design", "investigate"].includes(planId) ? 1 : 0);
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
```

Check the captured rows against the literals (byte-equal):

```bash
node -e 'const s=require("fs").readFileSync("web/tests/loopSummary.test.tsx","utf8"); const a=s.indexOf("= [\n", s.indexOf("const ROWS"))+4; process.stdout.write(s.slice(a, s.indexOf("\n];", a)+1));' > "$SCRATCH/t3-rows-in-test.txt" 2>&1; echo rc=$?
cmp "$SCRATCH/t3-capture.txt" "$SCRATCH/t3-rows-in-test.txt" > "$SCRATCH/t3-rows-cmp.txt" 2>&1; echo rc=$?
```
Expected both `rc=0`, `t3-rows-cmp.txt` empty.

`tests/control/loopPlanViewFields.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { loopPlanViewSchema } from "../../src/control/webProtocol.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { webFixture } from "./fixtures/web.js";

/**
 * Panel i18n spec §3.1, §6.8: the loop plan view carries the fields the panel builds its words from -- the expanded
 * contract's file cap (not the input's: investigate is always 1, and a v2 plan has none unless the input sets one) and
 * whether the plan version has a discipline line -- and no English sentence: the strict schema refuses a view that still
 * carries summary or planName.
 */
const LOOP = { goal: "fix login", successCondition: "the login test passes", targetPaths: ["a"], checks: ["npm test"] };
const FIELDS = ["amended", "chosenBy", "chosenByLabel", "hasDiscipline", "inputs", "loopVersion", "maxFiles", "planId", "planVersion"];

describe("the loop plan view's fields (panel i18n spec §3.1, §6.8)", () => {
  it("carries exactly the fields of §3.1: the contract's file cap and whether the plan version has a discipline line", async () => {
    const h = await webFixture(undefined, [
      { taskId: "a", loop: { ...LOOP, plan: "standard" } },
      { taskId: "b", loop: { ...LOOP, plan: "bugfix", targetPaths: ["b"], maxFilesTouched: 7 } },
      { taskId: "c", loop: { ...LOOP, plan: "investigate", targetPaths: ["docs/report.md"] } },
    ]);
    try {
      const [a, b, c] = readControlGroup(h.store, "epoch", "g").workItems.map((item) => item.loopPlan!);
      expect(Object.keys(a!).sort()).toEqual(FIELDS);
      expect(a).toMatchObject({ planId: "standard", planVersion: 2, maxFiles: Number.MAX_SAFE_INTEGER, hasDiscipline: false });
      expect(b).toMatchObject({ planId: "bugfix", planVersion: 2, maxFiles: 7, hasDiscipline: true });
      expect(c).toMatchObject({ planId: "investigate", planVersion: 2, maxFiles: 1, hasDiscipline: true });
    } finally { await h.dispose(); }
  });

  it("refuses a view that still carries summary or planName", () => {
    const view = {
      planId: "standard", planVersion: 2, chosenBy: "explicit", chosenByLabel: null, amended: false, loopVersion: 0,
      inputs: { goal: "g", successCondition: "s", targetPaths: ["a"], checks: ["npm test"], nonGoals: [], relevantDocs: [], protectedPaths: [], maxFilesTouched: null },
      maxFiles: 1, hasDiscipline: false,
    };
    expect(loopPlanViewSchema.safeParse(view).success).toBe(true);
    expect(loopPlanViewSchema.safeParse({ ...view, summary: ["Goal: g"] }).success).toBe(false);
    expect(loopPlanViewSchema.safeParse({ ...view, planName: "Standard" }).success).toBe(false);
  });
});
```

**Existing criteria rewritten (spec §6.1, H18):**

- `tests/control/loopPlanSummary.test.ts` — deleted (`/usr/bin/git rm`); it tests `describeLoopPlan`, which is removed. Its eight cases are carried by `web/tests/loopSummary.test.tsx` (the pinned bugfix lines are rows `bugfix 1 two-paths-protected-cap1` and `bugfix 1 protected-two-cap25`; the command-text/REJECT, red-first and "checked by a model" intents are the second `it`; the protected-path, investigate-cap-1, v2 "No file limit" and singular cases are rows; "knows no plan version it does not have" becomes Review Focus 3's fallback) and by the §6.9 rewrite below (the names).
- `tests/control/loopPlanView.test.ts`: line 2 `import { describeLoopPlan, expandLoopPlan } from "../../src/control/loopPlans.js";` → `import { expandLoopPlan } from "../../src/control/loopPlans.js";`; in `shows the plan, how it was chosen and its summary lines for a loop task`, after the existing H19 comment line add `// Rewritten under human ruling H18 (2026-10-01) for panel i18n: the view carries the fields its lines are built from.` and replace lines 22-25 with
  ```ts
      expect(item.loopPlan).toEqual({
        planId: "bugfix", planVersion: 2, chosenBy: "labels", chosenByLabel: "bug",
        amended: false, loopVersion: 0, inputs: recipe.inputs, maxFiles: Number.MAX_SAFE_INTEGER, hasDiscipline: true,
      });
  ```
- `tests/panel/taskLoopApi.test.ts`: after line 6 add `import { en } from "../../web/src/locales/en.js";` and `import { zh } from "../../web/src/locales/zh.js";`; replace lines 75-78 (`it("mirrors every plan's current panel name on the web side", …)`) with
  ```ts
    it("mirrors every plan's current version on the web side, and the panel's English carries each version's registry text", () => {
      // Rewritten under human ruling H18 (2026-10-01) for panel i18n: the view no longer carries a name (spec §3.1); the web
      // side keeps each plan's current version, the English resource is pinned to the registry, the English source of
      // record, and Chinese has the same keys (spec §6.9).
      expect(WEB_LOOP_PLANS.map((plan) => [plan.planId, plan.version])).toEqual(LOOP_PLAN_IDS.map((planId) => [planId, currentLoopPlanVersion(planId)]));
      type PlanTexts = Record<string, Record<string, Record<string, string>>>;
      const enPlans = en.loopPlan.plan as unknown as PlanTexts;
      const zhPlans = zh.loopPlan.plan as unknown as PlanTexts;
      let versions = 0;
      for (const planId of LOOP_PLAN_IDS) {
        for (let version = 1; version <= currentLoopPlanVersion(planId)!; version += 1) {
          const plan = loopPlanDefinition(planId, version)!;
          const expected = plan.discipline === null ? { name: plan.name } : { name: plan.name, discipline: plan.discipline };
          expect(enPlans[planId]?.[`v${version}`], `${planId} v${version}`).toEqual(expected);
          expect(Object.keys(zhPlans[planId]?.[`v${version}`] ?? {}).sort(), `${planId} v${version}`).toEqual(Object.keys(expected).sort());
          versions += 1;
        }
      }
      expect(Object.values(enPlans).reduce((n, byVersion) => n + Object.keys(byVersion).length, 0)).toBe(versions);
    });
  ```
- Web fixtures (assertions on rendered English stay; the fixture changes shape). In each file, the `planName: "Bug fix (red first)", ` fragment is deleted from the named line, and the `summary: [...]` line is replaced by `maxFiles: 25, hasDiscipline: true,` (same indentation): `web/tests/loopBudgetRows.test.tsx:25,27`, `web/tests/loopPlanDraft.test.tsx:37,39`, `web/tests/loopPlanEdit.test.tsx:26,28`, `web/tests/loopSuggestionApply.test.tsx:26,28`, `web/tests/loopSuggestionDraft.test.tsx:24,26`, `web/tests/loopPlanCard.test.tsx:25,27`. Each file gets the comment line `// Rewritten under human ruling H18 (2026-10-01) for panel i18n.` directly above the fixture's `const`.
- `web/tests/loopPlanCard.test.tsx:51` (`titles the card with the plan, its version and how it was chosen, and lists the server's lines`): `.toEqual(PLAN.summary);` → 
  ```ts
      // Rewritten under human ruling H18 (2026-10-01) for panel i18n: the lines are built by the panel; the text is unchanged.
      .toEqual(["Goal: fix login", "Done when: the login test passes", "Only changes: src/auth/**", "At most 25 files changed (reported by the agent)", "Acceptance: 1 check command, all must pass", "Write a failing test that reproduces the bug, then fix it (checked by a model, not proven mechanically)"]);
  ```
  (the comment line goes above the `expect(` statement of line 51).
- `web/tests/loopPlanCard.test.tsx:75` (`says a plan chosen with no label came from the default`): `loopPlan: { ...PLAN, planId: "standard", planName: "Standard", chosenByLabel: null }` → `loopPlan: { ...PLAN, planId: "standard", chosenByLabel: null }`.

- [ ] **Step 3: Run, expect FAIL**

```bash
./node_modules/.bin/vitest run tests/control/loopPlanViewFields.test.ts tests/control/loopPlanView.test.ts tests/panel/taskLoopApi.test.ts > "$SCRATCH/t3-red-root.txt" 2>&1; echo rc=$?
(cd web && ../node_modules/.bin/vitest run tests/loopSummary.test.tsx tests/loopPlanCard.test.tsx) > "$SCRATCH/t3-red-web.txt" 2>&1; echo rc=$?
```
Expected both `rc=1`: `loopPlanViewFields` both red (the view has no `maxFiles`/`hasDiscipline`; the old schema refuses the new valid view, which lacks `planName` and `summary`), `loopPlanView … shows the plan …` red, `taskLoopApi … mirrors every plan's current version …` red (`version` undefined; `en.loopPlan` undefined); web: `loopSummary` red (no export `loopSummaryLines`), `loopPlanCard` red where the fixture no longer has `planName`/`summary`.

- [ ] **Step 4: Implement**

`src/control/webProtocol.ts:953-967`:
```ts
// Loop plans spec §4.1, panel i18n spec §3.1: a loop task's plan as the fields the panel builds its words from -- the
// effective recipe, the expanded contract's file cap and whether the plan version has a discipline line; no English
// sentence travels. chosenByLabel is the plan file's label that chose it (spec §2.4); loopVersion is what set-task-loop
// must name.
export const loopPlanViewSchema = z
  .object({
    planId: z.enum(LOOP_PLAN_IDS),
    planVersion: positiveSafeInteger,
    chosenBy: z.enum(["explicit", "labels"]),
    chosenByLabel: nonemptyString.nullable(),
    amended: z.boolean(),
    loopVersion: safeInteger,
    inputs: loopInputsSchema,
    maxFiles: positiveSafeInteger,
    hasDiscipline: z.boolean(),
  })
  .strict();
```

`src/panel/controlViews.ts`: line 12 → `import { choosePlanByLabels, loopPlanDefinition } from "../control/loopPlans.js";`. In the doc comment of `taskPlanView` (`:478`), `Loop plans spec §3.3, §4.1 (C7): the task's plan as its card shows it.` → `Loop plans spec §3.3, §4.1; panel i18n spec §3.1: the fields the task's card is built from.`. Lines 492-504:
```ts
  // The recipe re-expanded, so its plan version exists. Panel i18n spec §3.1: the contract's own file cap, and whether the
  // version has a discipline line; the words are the panel's.
  const plan = loopPlanDefinition(task.loop.planId, task.loop.planVersion)!;
  return {
    objective,
    loopPlan: {
      planId: task.loop.planId, planVersion: task.loop.planVersion, chosenBy: task.loop.chosenBy,
      chosenByLabel: task.loop.chosenBy === "labels" ? choosePlanByLabels(task.labels ?? []).label : null,
      // "Changed" means the contract was changed at some point (H12: it stays so after a change back to the imported one),
      // or is not the imported one (an amendment written without the flag). A budget-only change writes the same bytes.
      amended: body.planChanged === true || task.originalContractHash !== importedContractHash, loopVersion: body.loopVersion ?? 0,
      inputs: task.loop.inputs, maxFiles: contract.safetyPolicy.maxFilesTouched, hasDiscipline: plan.discipline !== null,
    },
  };
```

`src/control/loopPlans.ts`: line 22 doc → `/** The plan's name in English, the source of record the panel's English resource must equal (panel i18n spec §6.9). */`; line 29 doc → `/** The discipline line in English with its strength (spec §4.1), the panel's source of record (panel i18n spec §6.9); null when the plan has none. */`; line 168 doc → `/** Spec §2.3: the version's default unless the input says otherwise; investigate always 1. */`; delete lines 244-270 (`countOf` and `describeLoopPlan`, with their doc comments).

`web/src/controlTypes.ts:345-363`:
```ts
/** Loop plans spec §4.1, panel i18n spec §3.1: the fields a loop task's card is built from; no English sentence travels. */
export type LoopPlanViewV1 = {
  planId: LoopPlanIdV1; planVersion: number; chosenBy: "explicit" | "labels"; chosenByLabel: string | null;
  amended: boolean; loopVersion: number; inputs: LoopInputsV1; maxFiles: number; hasDiscipline: boolean;
};
```
(the `SetTaskLoopPayloadV1` block between them is unchanged) and
```ts
/**
 * Loop plans spec §2.2, panel i18n spec §3.1: the plans a person can pick, at their current registry version (the
 * picker's words are keyed by version) -- a mirror of src/control/loopPlans.ts, compared by tests/panel/taskLoopApi.test.ts.
 */
export const WEB_LOOP_PLANS: ReadonlyArray<{ planId: LoopPlanIdV1; version: number }> = [
  { planId: "standard", version: 2 },
  { planId: "bugfix", version: 2 },
  { planId: "refactor", version: 2 },
  { planId: "design", version: 2 },
  { planId: "investigate", version: 2 },
];
```

`web/src/locales/en.ts` — add after `common` (before `enums`):
```ts
  loopPlan: {
    // Panel i18n spec §3.1, §6.9: one entry per registry version, equal to src/control/loopPlans.ts (the English source of
    // record); a version with no discipline has no discipline key.
    plan: {
      standard: { v1: { name: "Standard" }, v2: { name: "Standard" } },
      bugfix: {
        v1: { name: "Bug fix (red first)", discipline: "Write a failing test that reproduces the bug, then fix it (checked by a model, not proven mechanically)" },
        v2: { name: "Bug fix (red first)", discipline: "Write a failing test that reproduces the bug, then fix it (checked by a model, not proven mechanically)" },
      },
      refactor: {
        v1: { name: "Safe refactor", discipline: "No observable behavior change (an instruction to the agent; only the checks are enforced)" },
        v2: { name: "Safe refactor", discipline: "No observable behavior change (an instruction to the agent; only the checks are enforced)" },
      },
      design: {
        v1: { name: "Design / docs first", discipline: "The deliverable is a document, no code changes (checked by a model, not proven mechanically)" },
        v2: { name: "Design / docs first", discipline: "The deliverable is a document, no code changes (checked by a model, not proven mechanically)" },
      },
      investigate: {
        v1: { name: "Investigate only", discipline: "Investigate only; findings go to the report file, nothing else changes (checked by a model, not proven mechanically)" },
        v2: { name: "Investigate only", discipline: "Investigate only; findings go to the report file, nothing else changes (checked by a model, not proven mechanically)" },
      },
    },
    title: { line: "{{name}} · v{{version}} · {{how}}", byHand: "chosen by hand", noLabel: "no label, default", byLabel: "chosen by label `{{label}}`", changed: " · changed" },
    summary: {
      goal: "Goal: {{goal}}",
      doneWhen: "Done when: {{condition}}",
      onlyChanges: "Only changes: {{paths}}",
      mustNotChange: "Must not change: {{paths}} (reported by the agent, not checked in git)",
      files_one: "At most {{count}} file changed (reported by the agent)",
      files_other: "At most {{count}} files changed (reported by the agent)",
      noFileLimit: "No file limit",
      checks_one: "Acceptance: {{count}} check command, all must pass",
      checks_other: "Acceptance: {{count}} check commands, all must pass",
      pathSeparator: ", ",
    },
  },
```

`web/src/locales/zh.ts` — add after `common` (before `enums`), the loop plans spec's Chinese strings (its §2.2, §4.1; the loop plans plan's R-F5 left column):
```ts
  loopPlan: {
    plan: {
      standard: { v1: { name: "标准" }, v2: { name: "标准" } },
      bugfix: {
        v1: { name: "修 bug（先红后绿）", discipline: "先写能复现的失败测试再修（由模型核对，不是机械证明）" },
        v2: { name: "修 bug（先红后绿）", discipline: "先写能复现的失败测试再修（由模型核对，不是机械证明）" },
      },
      refactor: {
        v1: { name: "安全重构", discipline: "不改可观察行为（写给 agent 的约束；只有检查命令是硬的）" },
        v2: { name: "安全重构", discipline: "不改可观察行为（写给 agent 的约束；只有检查命令是硬的）" },
      },
      design: {
        v1: { name: "先写设计／文档", discipline: "交付物是文档，不改代码（由模型核对，不是机械证明）" },
        v2: { name: "先写设计／文档", discipline: "交付物是文档，不改代码（由模型核对，不是机械证明）" },
      },
      investigate: {
        v1: { name: "只调研不改代码", discipline: "只调研，结论写进报告文件，别的都不改（由模型核对，不是机械证明）" },
        v2: { name: "只调研不改代码", discipline: "只调研，结论写进报告文件，别的都不改（由模型核对，不是机械证明）" },
      },
    },
    title: { line: "{{name}} · v{{version}} · {{how}}", byHand: "人指定", noLabel: "无标签，按默认", byLabel: "按标签 `{{label}}` 选择", changed: " · 已修改" },
    summary: {
      goal: "目标：{{goal}}",
      doneWhen: "完成条件：{{condition}}",
      onlyChanges: "只改：{{paths}}",
      mustNotChange: "不许改：{{paths}}（由 agent 自报，不是 git 检查）",
      files_one: "最多改 {{count}} 个文件（由 agent 自报）",
      files_other: "最多改 {{count}} 个文件（由 agent 自报）",
      noFileLimit: "不限文件数",
      checks_one: "验收：运行 {{count}} 条检查命令，全部通过",
      checks_other: "验收：运行 {{count}} 条检查命令，全部通过",
      pathSeparator: "、",
    },
  },
```

`web/src/LoopPlanCard.tsx`:
- header comment, last sentence `Strings are the panel's English (plan ruling R-F5, rulings P1).` → `The plan's words come from the panel's resources, keyed by plan version (panel i18n spec §3.1).`
- imports: add `import { useTranslation } from "react-i18next";` after line 9 and `import i18n from "./i18n.js";` after the `./controlApi.js` import.
- replace lines 16-20 (`loopPlanTitle`) with:
```ts
/**
 * Panel i18n spec §3.1: a plan version's name or discipline line from the panel's resources (the registry is the English
 * source of record, §6.9). A version this panel has no words for (a newer server) shows the plan id, never nothing.
 */
export function planText(planId: LoopPlanIdV1, version: number, part: "name" | "discipline"): string {
  const key = `loopPlan.plan.${planId}.v${version}.${part}`;
  if (i18n.exists(key)) return i18n.t(key as never) as string;
  return part === "name" ? planId : `${planId} v${version}`;
}

/** "Bug fix (red first) · v1 · chosen by label `bug` · changed" (loop plans spec §4.1). */
export function loopPlanTitle(plan: LoopPlanViewV1): string {
  const how = plan.chosenBy === "explicit"
    ? i18n.t("loopPlan.title.byHand")
    : plan.chosenByLabel === null ? i18n.t("loopPlan.title.noLabel") : i18n.t("loopPlan.title.byLabel", { label: plan.chosenByLabel });
  const line = i18n.t("loopPlan.title.line", { name: planText(plan.planId, plan.planVersion, "name"), version: plan.planVersion, how });
  return plan.amended ? `${line}${i18n.t("loopPlan.title.changed")}` : line;
}

/**
 * Loop plans spec §4.1, panel i18n spec §3.1: the card's lines, each stating how hard it is (spec §2.1): the write set is
 * git-checked; protected paths and the file cap are only what the agent reports; the discipline line says who checks it.
 * The check commands' text is never in a line -- the card shows it collapsed. In English these are exactly the lines the
 * server's describeLoopPlan used to send (§6.3).
 */
export function loopSummaryLines(plan: LoopPlanViewV1): string[] {
  const inputs = plan.inputs;
  const separator = i18n.t("loopPlan.summary.pathSeparator");
  return [
    i18n.t("loopPlan.summary.goal", { goal: inputs.goal }),
    i18n.t("loopPlan.summary.doneWhen", { condition: inputs.successCondition }),
    i18n.t("loopPlan.summary.onlyChanges", { paths: inputs.targetPaths.join(separator) }),
    ...(inputs.protectedPaths.length > 0 ? [i18n.t("loopPlan.summary.mustNotChange", { paths: inputs.protectedPaths.join(separator) })] : []),
    plan.maxFiles === Number.MAX_SAFE_INTEGER ? i18n.t("loopPlan.summary.noFileLimit") : i18n.t("loopPlan.summary.files", { count: plan.maxFiles }),
    i18n.t("loopPlan.summary.checks", { count: inputs.checks.length }),
    ...(plan.hasDiscipline ? [planText(plan.planId, plan.planVersion, "discipline")] : []),
  ];
}
```
- line 131: `{WEB_LOOP_PLANS.map((option) => <option key={option.planId} value={option.planId}>{option.name}</option>)}` → `{WEB_LOOP_PLANS.map((option) => <option key={option.planId} value={option.planId}>{planText(option.planId, option.version, "name")}</option>)}`
- `LoopPlanCard` (line 150): first line of the body `useTranslation();` (re-renders the card on a language change); line 172 `{plan.summary.map((line, index) => <li key={index}>{line}</li>)}` → `{loopSummaryLines(plan).map((line, index) => <li key={index}>{line}</li>)}`.

`web/src/ControlGroupView.tsx`: line 20 `import { LabelChips, TaskDetail, progressText } from "./TaskDetail.js";` — add after it `import { planText } from "./LoopPlanCard.js";`; line 132 `{item.loopPlan ? <span className="plan-chip"> {item.loopPlan.planName}</span> : null}` → `{item.loopPlan ? <span className="plan-chip"> {planText(item.loopPlan.planId, item.loopPlan.planVersion, "name")}</span> : null}`.

Then make the existing-criteria rewrites listed above, and `/usr/bin/git rm tests/control/loopPlanSummary.test.ts`.

- [ ] **Step 5: Run, expect PASS**

```bash
./node_modules/.bin/vitest run tests/control/loopPlanViewFields.test.ts tests/control/loopPlanView.test.ts tests/panel/taskLoopApi.test.ts tests/control/loopPlans.test.ts tests/control/loopPlanImport.test.ts tests/control/loopPlanDrift.test.ts tests/control/setTaskLoop.test.ts tests/control/setTaskLoopConfirmed.test.ts tests/control/setTaskLoopVersion.test.ts tests/control/setTaskLoopModel.test.ts tests/control/loopPlanV2Derived.test.ts tests/control/taskAmendments.test.ts tests/control/loopBudgetOwner.test.ts > "$SCRATCH/t3-green-root.txt" 2>&1; echo rc=$?
npm run typecheck > "$SCRATCH/t3-tsc.txt" 2>&1; echo rc=$?
npm run check --workspace web > "$SCRATCH/t3-web-check.txt" 2>&1; echo rc=$?
/usr/bin/git grep -n "describeLoopPlan\|planName\|\.summary\b" -- src web/src > "$SCRATCH/t3-leftovers.txt" 2>&1; echo rc=$?
```
Expected: the first three `rc=0`; the grep `rc=1` (no hit) except lines that are `GroupSummaryV1`'s `summary` (`view.summary.…`) — the grep for `\.summary\b` lists those; read the file and confirm each hit is a group summary, not a loop view field. (The list is `ls tests/control/ | grep -i "loop\|amend\|setTask"` at `ac969bb` minus the deleted summary file and the ccloop-binary E2E; re-measure and run what exists.)

- [ ] **Step 6: Mutations** (`$SCRATCH/mut-t3`; files: every file of this Task, and `tests/control/loopPlanSummary.test.ts` deleted in `$M`; root criterion `./node_modules/.bin/vitest run <file>` from `$M`, web `(cd "$M/web" && ../node_modules/.bin/vitest run tests/<file>)`)
  - MT3-1 the input's cap, not the contract's: in `controlViews.ts`, `maxFiles: contract.safetyPolicy.maxFilesTouched` → `maxFiles: task.loop.inputs.maxFilesTouched ?? 25`. Red: `loopPlanViewFields … > carries exactly the fields …` (standard: 25, not `MAX_SAFE_INTEGER`; investigate: 25).
  - MT3-2 discipline always: `hasDiscipline: plan.discipline !== null` → `hasDiscipline: true`. Red: same test (standard).
  - MT3-3 schema not strict: `loopPlanViewSchema`'s `.strict()` → `.passthrough()`. Red: `loopPlanViewFields … > refuses a view that still carries summary or planName`.
  - MT3-4 protected line always: in `loopSummaryLines`, `...(inputs.protectedPaths.length > 0 ? [ … ] : [])` → `i18n.t("loopPlan.summary.mustNotChange", { paths: inputs.protectedPaths.join(separator) })`. Red: `loopSummary … > standard v1 one-path …` and every row without protected paths.
  - MT3-5 no "No file limit": `plan.maxFiles === Number.MAX_SAFE_INTEGER ? … : …` → the `files` branch alone. Red: `loopSummary … > standard v2 one-path …` (and every v2 row with no cap).
  - MT3-6 discipline dropped: `...(plan.hasDiscipline ? [ … ] : [])` → nothing. Red: `loopSummary … > bugfix v1 one-path …` and the second `it`.
  - MT3-7 no fallback: `planText` body → `return i18n.t(\`loopPlan.plan.${planId}.v${version}.${part}\` as never) as string;`. Red: `loopSummary … > shows a plan version this panel has no words for …`.
  - MT3-8 English drifts from the registry: `en.loopPlan.plan.bugfix.v2.name` → `"Bug fix"`. Red: `taskLoopApi … > mirrors every plan's current version …`.
  - MT3-9 web mirror version wrong: `{ planId: "standard", version: 2 }` → `version: 1`. Red: same test.
  - MT3-10 Chinese _one differs: `zh.loopPlan.summary.files_one` → `"最多改 1 个文件"`. Red: `i18nKeys … > gives each Chinese _one key the text of its _other key` (and `… keeps every placeholder …`, since `{{count}}` is gone).
  - MT3-11 chip shows the id: `planText(item.loopPlan.planId, item.loopPlan.planVersion, "name")` → `item.loopPlan.planId` in `ControlGroupView.tsx`. Red: `loopPlanCard … > puts the plan's name next to the labels in the task list`.
  - MT3-12 separator not the resource's: `inputs.targetPaths.join(separator)` → `inputs.targetPaths.join(", ")`. Red: `loopSummary … > builds the lines … in Chinese …` (`、`).

- [ ] **Step 7: Commit**

```bash
/usr/bin/git add src/control/webProtocol.ts src/panel/controlViews.ts src/control/loopPlans.ts web/src/controlTypes.ts web/src/LoopPlanCard.tsx web/src/ControlGroupView.tsx web/src/locales/en.ts web/src/locales/zh.ts tests/control/loopPlanViewFields.test.ts web/tests/loopSummary.test.tsx tests/control/loopPlanView.test.ts tests/panel/taskLoopApi.test.ts web/tests/loopPlanCard.test.tsx web/tests/loopBudgetRows.test.tsx web/tests/loopPlanDraft.test.tsx web/tests/loopPlanEdit.test.tsx web/tests/loopSuggestionApply.test.tsx web/tests/loopSuggestionDraft.test.tsx
/usr/bin/git commit -F - <<'MSG'
feat(panel): send a loop plan's fields and build its words in the panel

The loop plan view drops planName and summary and carries the contract's file
cap and whether the plan version has a discipline line; the strict schema
refuses the old fields. The panel builds the card's lines, title, picker and
chip from versioned keys; the registry stays the English source of record and
a criterion pins the English resource to it. describeLoopPlan is removed; its
lines are pinned as literals against the panel's builder. Criteria rewritten
under human ruling H18.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GCbsgLfqFPgpeG3gTbBkbh
MSG
```
(`/usr/bin/git rm` already staged the deletion.)

---


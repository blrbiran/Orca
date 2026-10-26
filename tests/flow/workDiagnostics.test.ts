import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runShell } from "../../src/flow/kinds/check.js";
import { childGroupIdOf } from "../../src/flow/kinds/work.js";
import { fakeChildPort } from "./fixtures/childPort.js";
import { flowWorld } from "./fixtures/flowWorld.js";

/**
 * Registered fix F1 (plan 2026-10-26), spec §4.2 `work`/`check`: a work step's `diagnostic` checks are Orca's, not
 * ccloop's. They reach the child's prompt as `- diagnostic: <expanded>` lines, run after the child lands in the check
 * kind's throwaway tree at the landed commit (with `{{base:...}}` read from the composition), are recorded on the step
 * only when they produced a result, and reach the next prompt through the record's projection. They never fail a step:
 * expansion/execution failures become a recorded `orca: diagnostic not run: ...`, and nothing runs for a failed child or
 * a `needs` outcome.
 */
const TPL = (diagnostic: string, skills: string[] = [], diagnosticId: string | null = "after") => ({
  yaml: `format: orca-flow-v1
id: t
params:
  slug: {type: slug, default: tea}
${skills.length === 0 ? "" : `requires:
  skills:
    - {source: src, ref: "${"c".repeat(40)}", path: skills, skills: [${skills.join(", ")}]}
`}workspace: {kind: dir}
steps:
  - id: voice
    kind: work
    prompt: voice.md
${skills.length === 0 ? "" : `    skills: [${skills.join(", ")}]\n`}    acceptance:
      checks:
        - {id: present, run: "test -s '{{param.slug}}.md'", role: gate}
        - {${diagnosticId === null ? "" : `id: ${diagnosticId}, `}run: ${JSON.stringify(diagnostic)}, role: diagnostic}
  - {id: write, kind: draft, prompt: write.md}
`,
  assets: { "voice.md": "Rewrite {{param.slug}}.md.\n", "write.md": "Next.\n" },
});

const contractGoal = (children: ReturnType<typeof fakeChildPort>, id: string): string =>
  (JSON.parse(children.opened.get(id)!.plan.tasks[0]!.originalContractCanonicalJson) as { objective: { goal: string } }).objective.goal;

type Checks = Array<{ id: string; role: string; exitCode: number; output: string; cut: number }>;
const checksOf = (world: Awaited<ReturnType<typeof flowWorld>>, flowRunId: string, stepKey: string): Checks =>
  (world.latest(flowRunId, stepKey)!.body as { record: { checks: Checks } }).record.checks;

/** A world whose runCommand records what it was asked, then runs it for real. */
async function worldWithSeen(diagnostic: string, skills: string[] = [], diagnosticId: string | null = "after") {
  const children = fakeChildPort();
  const seen: Array<{ command: string; cwd: string }> = [];
  const w = await flowWorld({ t: TPL(diagnostic, skills, diagnosticId) }, {
    children: children.port, files: { "tea.md": "before\n" },
    runCommand: async (command, cwd) => { seen.push({ command, cwd }); return runShell(command, cwd); },
  });
  return { children, seen, w };
}

describe("work step diagnostics", () => {
  it("reaches the child's plan, runs at the landed commit and points the next prompt at the result", async () => {
    const { children, seen, w } = await worldWithSeen("cat '{{base:{{param.slug}}.md}}' && cat '{{param.slug}}.md'");
    try {
      const { flowRunId } = await w.start({ templateRef: "builtin/t" });
      await w.advance();
      const childId = childGroupIdOf(flowRunId, "voice", 1);
      const goal = contractGoal(children, childId);
      expect(goal).toContain("- gate: test -s 'tea.md'");
      expect(goal).toContain("- diagnostic: cat '");
      expect(goal).toMatch(/- diagnostic: cat '[^']+voice-1\/1-tea\.md' && cat 'tea\.md'/);
      expect(goal).not.toContain("{{param.");
      expect(goal).not.toContain("{{base:");
      children.land(childId, { "tea.md": "after\n" });
      await w.advance();
      expect(w.latest(flowRunId, "voice")).toMatchObject({ state: "done" });
      // The temp tree is at the landed commit and the base copy is the composition's.
      expect(checksOf(w, flowRunId, "voice")).toEqual([{ id: "after", role: "diagnostic", exitCode: 0, output: "before\nafter\n", cut: 0 }]);
      expect(seen).toHaveLength(1);
      expect(seen[0]!.command).toMatch(/^cat '.*\/base\/1-tea\.md' && cat 'tea\.md'$/);
      // The next step's prompt carries the record's projection after the workspace pointer.
      expect(w.calls).toHaveLength(1);
      expect(w.calls[0]!.prompt).toContain("workspace commit ");
      expect(w.calls[0]!.prompt).toContain("check after (diagnostic) exit 0:\nbefore\nafter");
    } finally { await w.dispose(); }
  });

  it("a diagnostic that exits non-zero is recorded and the step is still done", async () => {
    const { children, w } = await worldWithSeen("exit 3");
    try {
      const { flowRunId } = await w.start({ templateRef: "builtin/t" });
      await w.advance();
      children.land(childGroupIdOf(flowRunId, "voice", 1), { "tea.md": "after\n" });
      await w.advance();
      expect(w.latest(flowRunId, "voice")).toMatchObject({ state: "done" });
      expect(checksOf(w, flowRunId, "voice")[0]).toMatchObject({ id: "after", role: "diagnostic", exitCode: 3, output: "" });
    } finally { await w.dispose(); }
  });

  it("an unknown skill token records not-run output instead of failing the step", async () => {
    // The step declares `nope` (the template validator only allows a declared skill's dir token), but the child landed
    // without a skills dir, so settle has no directory to fill and the expansion is a recorded not-run.
    const { children, w } = await worldWithSeen("cat '{{skill.nope.dir}}/x'", ["nope"]);
    try {
      const { flowRunId } = await w.start({ templateRef: "builtin/t" });
      await w.advance();
      const childId = childGroupIdOf(flowRunId, "voice", 1);
      // work.start leaves the token for the driver (A2) to fill once the child injected the skill.
      expect(contractGoal(children, childId)).toContain("diagnostic: cat '{{skill.nope.dir}}/x'");
      children.land(childId, { "tea.md": "after\n" });
      await w.advance();
      expect(w.latest(flowRunId, "voice")).toMatchObject({ state: "done" });
      const checks = checksOf(w, flowRunId, "voice");
      expect(checks).toHaveLength(1);
      expect(checks[0]).toMatchObject({ id: "after", role: "diagnostic", exitCode: 1 });
      expect(checks[0]!.output.startsWith("orca: diagnostic not run: unknown variable {{skill.nope.dir}}")).toBe(true);
    } finally { await w.dispose(); }
  });

  it("a diagnostic reads the copy of a skill the child actually injected", async () => {
    // The step declares `nope`; the landed child reports it in its lock and the skills dir the driver injected, so
    // settle fills the A2 layout `<dir>/skills/<name>` and the diagnostic reads the injected copy, not a guess.
    const skillsDir = await mkdtemp(join(tmpdir(), "orca-flow-skills-"));
    try {
      await mkdir(join(skillsDir, "skills", "nope"), { recursive: true });
      await writeFile(join(skillsDir, "skills", "nope", "x"), "from the injected copy\n");
      const { children, w } = await worldWithSeen("cat '{{skill.nope.dir}}/x'", ["nope"]);
      try {
        const { flowRunId } = await w.start({ templateRef: "builtin/t" });
        await w.advance();
        children.land(childGroupIdOf(flowRunId, "voice", 1), { "tea.md": "after\n" }, {
          skillsDir,
          skills: [{ name: "nope", source: null, resolved_commit: null, content_md5: "0".repeat(32) }],
        });
        await w.advance();
        expect(w.latest(flowRunId, "voice")).toMatchObject({ state: "done" });
        expect(checksOf(w, flowRunId, "voice")).toEqual([
          { id: "after", role: "diagnostic", exitCode: 0, output: "from the injected copy\n", cut: 0 },
        ]);
      } finally { await w.dispose(); }
    } finally { await rm(skillsDir, { recursive: true, force: true }); }
  });

  it("a diagnostic without an id records its acceptance position", async () => {
    // The gate is acceptance position 1, the unnamed diagnostic position 2: its fallback id is check-2.
    const { children, w } = await worldWithSeen("test -s '{{param.slug}}.md'", [], null);
    try {
      const { flowRunId } = await w.start({ templateRef: "builtin/t" });
      await w.advance();
      children.land(childGroupIdOf(flowRunId, "voice", 1), { "tea.md": "after\n" });
      await w.advance();
      expect(w.latest(flowRunId, "voice")).toMatchObject({ state: "done" });
      expect(checksOf(w, flowRunId, "voice")).toEqual([{ id: "check-2", role: "diagnostic", exitCode: 0, output: "", cut: 0 }]);
    } finally { await w.dispose(); }
  });

  it("a failed child runs no diagnostic", async () => {
    const { children, seen, w } = await worldWithSeen("echo hi");
    try {
      const { flowRunId } = await w.start({ templateRef: "builtin/t" });
      await w.advance();
      children.fail(childGroupIdOf(flowRunId, "voice", 1), "boom");
      await w.advance();
      expect(w.latest(flowRunId, "voice")).toMatchObject({ state: "failed" });
      expect(seen).toEqual([]);
    } finally { await w.dispose(); }
  });

  it("a needs outcome runs no diagnostic", async () => {
    const { children, seen, w } = await worldWithSeen("echo hi");
    try {
      const { flowRunId } = await w.start({ templateRef: "builtin/t" });
      await w.advance();
      children.land(childGroupIdOf(flowRunId, "voice", 1), {}, { flow: { needs: { kind: "input", question: "q?", candidates: [] } } });
      await w.advance();
      expect(w.latest(flowRunId, "voice")).toMatchObject({ state: "needs-person" });
      expect(seen).toEqual([]);
    } finally { await w.dispose(); }
  });
});

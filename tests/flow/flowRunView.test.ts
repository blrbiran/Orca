/**
 * Flow engine spec §14.1, §16.2 (plan Task 16): what the run page reads. Every execution of a step is listed with its
 * state, output and red flags, and a `work` execution carries ccloop's tool-rule report exactly as ccloop gave it --
 * for a landed child from the execution body, for a failed one from its artifact record -- so the page can show each
 * rule's status and flag `detected`, `recorded-only` network and `refused`. The run list names the run's project and
 * folder, which the kanban's flow card is scoped by.
 */
import { describe, expect, it } from "vitest";
import type { ScheduleBody } from "../../src/control/schedules/model.js";
import { insertSchedule } from "../../src/control/schedules/store.js";
import { childGroupIdOf } from "../../src/flow/kinds/work.js";
import { readFlowList, readFlowRun } from "../../src/flow/views.js";
import { fakeChildPort } from "./fixtures/childPort.js";
import { flowWorld } from "./fixtures/flowWorld.js";

const YAML = `format: orca-flow-v1
id: w
workspace: {kind: dir}
steps:
  - {id: write, kind: work, prompt: p.md, tools: {commands: [{exact: "npm test"}], network: false}}
`;
const report = (status: "enforced" | "detected" | "recorded-only" | "refused") => ({ schema: "ccloop-tool-rules-report-v1" as const, agentKind: "claude" as const, baseline: "b", rules: [
  { rule: { kind: "exact" as const, value: "npm test" }, status: "enforced" as const, reason: null, phases: ["execute" as const] },
  { rule: { kind: "network" as const, value: false }, status, reason: status === "refused" ? "not expressible" : null, phases: ["execute" as const] },
] });

type View = { steps: Array<{ stepKey: string; latest: { seq: number; state: string; toolRules: unknown; flags: string[]; output: { kind: string } | null } | null; executions: Array<{ seq: number; state: string; toolRules: unknown; failure: string | null }> }> };

describe("the run page's read (Task 16, §16.2)", () => {
  it("lists every execution with its output, flags and the tool-rule report ccloop gave, landed or failed", async () => {
    const children = fakeChildPort();
    const w = await flowWorld({ w: { yaml: YAML, assets: { "p.md": "Write.\n" } } }, { children: children.port });
    try {
      const { flowRunId } = await w.start({ templateRef: "builtin/w" });
      await w.advance();
      children.fail(childGroupIdOf(flowRunId, "write", 1), "gate-failed", 0, { toolRules: report("refused") });
      await w.advance();
      const failed = readFlowRun(w.store, flowRunId) as View;
      // mutation: drop the artifact record's rules -> toolRules null, red
      expect(failed.steps[0]!.latest!.toolRules).toEqual(report("refused"));
      expect(failed.steps[0]!.latest!.state).toBe("failed");
      expect(failed.steps[0]!.latest!.flags).toEqual(["tool-rule:refused"]);
    } finally { await w.dispose(); }
  });

  it("reads a landed child's report from its body, and keeps earlier executions in the list", async () => {
    const children = fakeChildPort();
    const w = await flowWorld({ w: { yaml: YAML, assets: { "p.md": "Write.\n" } } }, { children: children.port });
    try {
      const { flowRunId } = await w.start({ templateRef: "builtin/w" });
      await w.advance();
      children.land(childGroupIdOf(flowRunId, "write", 1), { "a.md": "a\n" }, { toolRules: report("detected") });
      await w.advance();
      const view = readFlowRun(w.store, flowRunId) as View;
      const step = view.steps[0]!;
      // mutation: read the report from the artifact only -> null for a commit output, red
      expect(step.latest!.toolRules).toEqual(report("detected"));
      expect(step.latest!.output!.kind).toBe("commit");
      expect(step.latest!.flags).toEqual(["tool-rule:detected"]);
      expect(step.executions.map((e) => [e.seq, e.state])).toEqual([[1, "done"]]);
      const list = readFlowList(w.store) as { runs: Array<{ flowRunId: string; projectId: string | null; dir: string | null }> };
      expect(list.runs).toEqual([expect.objectContaining({ flowRunId, projectId: null, dir: w.folder, needsYou: 0 })]);
    } finally { await w.dispose(); }
  });

  it("counts the steps waiting on the person in the run list (the kanban card's needs-you)", async () => {
    const children = fakeChildPort();
    const w = await flowWorld({ w: { yaml: YAML, assets: { "p.md": "Write.\n" } } }, { children: children.port });
    try {
      const { flowRunId } = await w.start({ templateRef: "builtin/w" });
      await w.advance();
      children.land(childGroupIdOf(flowRunId, "write", 1), { "a.md": "a\n" }, { flow: { needs: { kind: "input", question: "Which tone?", candidates: [] } } });
      await w.advance();
      expect(w.latest(flowRunId, "write")!.state).toBe("needs-person");
      // mutation: count nothing -> 0, red
      expect((readFlowList(w.store) as { runs: Array<{ needsYou: number }> }).runs[0]!.needsYou).toBe(1);
    } finally { await w.dispose(); }
  });
});

const SLOT = 1_760_000_000_000;
const scheduleBody = (id: string, name: string): ScheduleBody => ({
  id, projectId: "repo", name, kind: "flow", cron: "0 2 * * *", enabled: true,
  start: { kind: "flow", template: "builtin/w@1", params: {} },
  createdBy: "ann", createdVia: "cli", createdAt: 1, updatedBy: "ann", updatedVia: "cli", updatedAt: 1,
  enabledBy: "ann", enabledVia: "cli", enabledAt: 1,
  state: { lastSlot: null, tz: "UTC", failureStreak: 0, paused: false, pausedReason: null },
});
type ScheduledView = { scheduled: { scheduleId: string; name: string; slot: number } | null };

describe("the schedule a run was started by (spec §13.3)", () => {
  it("names it in the run view and the run list, and leaves a hand start null", async () => {
    const children = fakeChildPort();
    const w = await flowWorld({ w: { yaml: YAML, assets: { "p.md": "Write.\n" } } }, { children: children.port });
    try {
      insertSchedule(w.store, { id: "sch-a", projectId: "repo", kind: "flow", revision: 1, body: scheduleBody("sch-a", "  daily  ") });
      const scheduled = await w.start({ templateRef: "builtin/w", origin: { kind: "schedule", scheduleId: "sch-a", slot: SLOT } });
      const plain = await w.start({ templateRef: "builtin/w" });
      // mutation: drop the name lookup, or the schedule kind check -> red
      expect((readFlowRun(w.store, scheduled.flowRunId) as ScheduledView).scheduled).toEqual({ scheduleId: "sch-a", name: "daily", slot: SLOT });
      const list = (readFlowList(w.store) as { runs: Array<ScheduledView & { flowRunId: string }> }).runs;
      expect(list.find((run) => run.flowRunId === scheduled.flowRunId)!.scheduled).toEqual({ scheduleId: "sch-a", name: "daily", slot: SLOT });
      expect(list.find((run) => run.flowRunId === plain.flowRunId)!.scheduled).toBeNull();
    } finally { await w.dispose(); }
  });

  it("falls back to the schedule's id when its row is missing or unreadable", async () => {
    const children = fakeChildPort();
    const w = await flowWorld({ w: { yaml: YAML, assets: { "p.md": "Write.\n" } } }, { children: children.port });
    try {
      const missing = await w.start({ templateRef: "builtin/w", origin: { kind: "schedule", scheduleId: "sch-missing", slot: SLOT } });
      insertSchedule(w.store, { id: "sch-bad", projectId: "repo", kind: "flow", revision: 1, body: scheduleBody("sch-bad", "Broken") });
      w.store.db.prepare("UPDATE schedules SET body=? WHERE id=?").run("not json", "sch-bad");
      const corrupt = await w.start({ templateRef: "builtin/w", origin: { kind: "schedule", scheduleId: "sch-bad", slot: SLOT + 1 } });
      expect((readFlowRun(w.store, missing.flowRunId) as ScheduledView).scheduled).toEqual({ scheduleId: "sch-missing", name: "sch-missing", slot: SLOT });
      expect((readFlowRun(w.store, corrupt.flowRunId) as ScheduledView).scheduled).toEqual({ scheduleId: "sch-bad", name: "sch-bad", slot: SLOT + 1 });
    } finally { await w.dispose(); }
  });
});

// @vitest-environment jsdom
/**
 * Panel i18n spec §3.5 (final review Minor 3, Task 7 review Minor 2): where a task's labels came from is an enum the
 * server sends. A value this panel has no words for (a newer server) is shown as sent, the way enumText shows every
 * other family -- never as the translation key's path.
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "../src/i18n.js";
import { TaskDetail } from "../src/TaskDetail.js";
import type { Amount, GroupViewV1, WorkItemViewV1 } from "../src/controlTypes.js";

const amount = (tokens: number): Amount => ({ tokens, activeMs: tokens * 10, attempts: 1, sessions: 1 });
const item = (labelsProvenance: string): WorkItemViewV1 => ({
  taskId: "a", status: "ready", dependencyTaskIds: [], targetVersion: 1, configHash: null, originalContractHash: "e".repeat(64),
  derivedContractHash: null, currentRunId: null, pendingRunId: null, lineageRunIds: [], labels: ["bug"],
  labelsProvenance: labelsProvenance as WorkItemViewV1["labelsProvenance"], labelsVersion: 3, progress: null,
});
const view = (workItem: WorkItemViewV1): GroupViewV1 => ({
  schema: "orca-control-group-v1", epoch: "epoch-a", changeSeq: 4,
  summary: { groupId: "g", state: "ready", commandRevision: 6, projectionSeq: 4, stopMode: null, stopState: null, claimBlocked: false, recoveryBlockerCount: 0 },
  graphVersion: 1, plan: { repoId: "orca", planId: "plan-demo", planHash: "a".repeat(64), goal: "Ship", successConditions: ["done"] },
  proposal: { state: "editable", proposalVersion: 2, planHash: "a".repeat(64), budgetMode: "soft", contextPolicy: { handoffAtContextTokens: null }, profiles: null, executionSnapshotHash: null },
  ledger: { groupLimit: amount(100), used: amount(0), committedRemaining: amount(0), explicitUnallocatedReserve: amount(100), budgetDeficit: amount(0), usageUnknown: false },
  allocations: [], workItems: [workItem], estimates: [], runs: [], checkpoints: [], handoffRequests: [], stop: null, recoveryBlockers: [], recentCommandIds: [],
});
/** The task detail's "labels from …" line. */
function labelsLine(labelsProvenance: string): string {
  const workItem = item(labelsProvenance);
  const { container } = render(<TaskDetail view={view(workItem)} item={workItem} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />);
  return container.querySelector("section > p")!.textContent ?? "";
}

afterEach(cleanup);

describe("where a task's labels came from", () => {
  it.each([
    ["en", "labels from imported · version 3", "labels from operator · version 3"],
    ["zh", "标签来自imported · 版本 3", "标签来自操作者 · 版本 3"],
  ])("in %s, shows a source this panel has no words for as sent and one it knows in words", async (language, unknown, known) => {
    await i18n.changeLanguage(language);
    expect(labelsLine("imported")).toBe(unknown);
    cleanup();
    expect(labelsLine("operator")).toBe(known);
  });
});

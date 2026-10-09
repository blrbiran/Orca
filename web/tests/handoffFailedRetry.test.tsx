// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ControlGroupView } from "../src/ControlGroupView.js";
import { TaskDetail } from "../src/TaskDetail.js";
import type { GroupViewV1, RunViewV1 } from "../src/controlTypes.js";
import { config, run, view } from "./usageRecoveryFixture.js";
afterEach(cleanup);
const failed = (state: RunViewV1["state"] = "settled-recoverable") => run({ state, outcome: "failed", stopReason: "Error: codex-event-error", continuable: state === "settled-recoverable" });
const recovery = (r = failed()): GroupViewV1 => ({ ...view([r]), workItems: [{ taskId: "a", status: r.state === "settled-failed" ? "blocked" : "held", currentRunId: r.runId, pendingRunId: null, lineageRunIds: [r.runId], dependencyTaskIds: [], targetVersion: 1, configHash: null, originalContractHash: "hash", derivedContractHash: null }], allocations: ["work", "handoff"].map(bucket => ({ ownerKind: "task", ownerId: "a", bucket, state: r.state === "settled-failed" ? "terminal" : "held", amount: r.remaining, fieldProvenance: Object.fromEntries(["tokens", "activeMs", "attempts", "sessions"].map(dimension => [dimension, { provenance: "human" }])) })) as GroupViewV1["allocations"], checkpoints: [{ checkpointId: "checkpoint", runId: r.runId, taskId: "a", state: "complete", snapshotHash: "hash", evidenceIds: [] }], handoffRequests: [{ requestId: "req", runId: r.runId, state: r.state === "settled-failed" ? "settled-failed" : "settled-recoverable", deadlineAt: "then", phaseAttemptOrdinal: 1, failureCode: null, evidenceIds: [] }] as GroupViewV1["handoffRequests"] });
const show = (v: GroupViewV1) => { const onCommand = vi.fn(); render(<ControlGroupView view={v} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={onCommand} />); return onCommand; };
describe("failed handoff recovery", () => {
  it("keeps failure cause after handoff and offers retry from current group head", () => {
    const onCommand = show(recovery());
    expect(screen.getByText(/reported an error/)).toBeTruthy();
    expect(screen.getByText(/current group branch head/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry task a" }));
    expect(onCommand).toHaveBeenCalledWith({ verb: "retry-task", groupId: "g", expectedRevision: 6, payload: { taskId: "a" } });
    expect(screen.getByText(/checkpoint/)).toBeTruthy();
  });
  it("shows Retry in task detail only for the current failure", () => {
    const v = recovery(); render(<TaskDetail view={v} item={v.workItems[0]!} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Retry task a" })).toBeTruthy();
  });
  it("a released manual failure cannot Continue and can empty-resume before Retry", () => {
    const r = failed("settled-failed"); r.continuable = true; r.unknownUsageSettlement = { generation: 1, highWater: 1, remaining: { work: r.remaining, handoff: r.remaining }, allowed: false, refusalReason: "run-usage-settled", settlement: { method: "remaining-grant", charged: { work: r.remaining, handoff: r.remaining }, principal: "user:owner", at: 1234, reservationDisposition: "released" } as NonNullable<RunViewV1["unknownUsageSettlement"]>["settlement"] };
    const v = recovery(r); v.summary = { ...v.summary, stopMode: "handoff", stopState: "handoff-complete" }; v.stop = { mode: "handoff", state: "handoff-complete", frozenRunIds: [r.runId], acceptedAt: "now", deadlineAt: null };
    const onCommand = show(v);
    expect(screen.getByText(/reported an error/)).toBeTruthy();
    expect(screen.getByText(/user:owner/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Continue/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Retry task/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Resume (no continuation)" }));
    expect(onCommand).toHaveBeenCalledWith({ verb: "resume-from-handoff", groupId: "g", expectedRevision: 6, payload: { selections: [] } });
    cleanup(); show({ ...v, stop: null, summary: { ...v.summary, stopMode: null, stopState: null } });
    expect(screen.getByRole("button", { name: "Retry task a" })).toBeTruthy();
  });
  it.each(["success", "old", "pending", "unknown", "ordinary", "open"])("does not offer inactive Retry for %s", mode => {
    const v = recovery();
    if (mode === "success") v.runs[0]!.outcome = "succeeded";
    if (mode === "old") v.workItems[0]!.currentRunId = "new";
    if (mode === "pending") v.workItems[0]!.pendingRunId = "new";
    if (mode === "unknown") v.ledger.usageUnknown = true;
    if (mode === "ordinary") v.runs[0]!.outcome = null;
    if (mode === "open") v.handoffRequests[0]!.state = "collecting";
    show(v); expect(screen.queryByRole("button", { name: /^Retry task/ })).toBeNull();
  });
  it("does not imply the whole group recovered while another run still blocks handoff", () => {
    const v = recovery(); v.summary = { ...v.summary, stopMode: "handoff", stopState: "handoff-partial" }; v.stop = { mode: "handoff", state: "handoff-partial", frozenRunIds: ["run-a", "run-b"], acceptedAt: "now", deadlineAt: null }; v.runs.push(run({ runId: "run-b", taskId: "b", state: "unknown", blockedReason: "usage-unsettled" }));
    show(v); expect(screen.queryByRole("button", { name: "Resume (no continuation)" })).toBeNull(); expect(screen.queryByRole("button", { name: /^Retry task/ })).toBeNull();
  });
});

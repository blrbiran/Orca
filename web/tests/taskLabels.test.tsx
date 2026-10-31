// @vitest-environment jsdom
/**
 * Labels and progress spec §4.2 and §5.3 (Orca plan 2026-09-29 Task 7): the work item table's labels and progress
 * columns, the label filter, the task detail panel (label editor, progress, runs and their evidence), the group nav's
 * completion, and the two label styles. The plan's Mutation lines name the production line each `it` goes red on.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { labelCustom, labelCustomClass, labelRemove, labelSystem, labelSystemClass } from "../src/ui/classes.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ControlGroupView } from "../src/ControlGroupView.js";
import { ControlPanel } from "../src/ControlPanel.js";
import { controlCommandPath, type ControlAction } from "../src/controlApi.js";
import type {
  Amount, ControlConfigV1, ControlSummaryV1, EvidenceManifestV1, GroupViewV1, RecoveryViewV1, RunViewV1, WorkItemViewV1,
} from "../src/controlTypes.js";
import { progressText } from "../src/TaskDetail.js";
import { WEB_SYSTEM_LABELS } from "../src/controlTypes.js";

const amount = (tokens: number): Amount => ({ tokens, activeMs: tokens * 10, attempts: 1, sessions: 1 });
const capability = { usageObservation: "phase-end", budgetEnforcement: "soft", contextObservation: "unavailable", handoffControl: "durable", handoffExecution: "mechanical-in-run-v1", contextWindowTokens: null, requestBoundProof: null } as const;
const config: ControlConfigV1 = {
  schema: "orca-control-config-v1", epoch: "epoch-a", repositories: [{ repoId: "orca", displayName: "Orca" }],
  plans: [{ planId: "plan-demo", repoId: "orca", displayName: "Demo plan" }],
  profiles: [{ profileId: "all", profileHash: "b".repeat(64), allowedWorkKinds: ["task", "budget-estimate", "handoff", "goal-review"], contextTokenizer: null, workMaxOutputTokens: 1000, declared: capability, observed: capability, observedAt: "2026-09-29T00:00:00.000Z", probeFailureCode: null }],
  defaults: { estimatorProfileId: "all", estimatorProfileHash: "b".repeat(64), estimateMode: "soft" }, executionPort: "configured", errorCatalog: [],
};
const workItem = (over: Partial<WorkItemViewV1>): WorkItemViewV1 => ({
  taskId: "a", status: "active", dependencyTaskIds: [], targetVersion: 1, configHash: "d".repeat(64), originalContractHash: "e".repeat(64),
  derivedContractHash: "f".repeat(64), currentRunId: null, pendingRunId: null, lineageRunIds: [], ...over,
});
const run = (over: Partial<RunViewV1>): RunViewV1 => ({
  runId: "run-a", taskId: "a", estimateId: null, generation: 1, state: "running", phase: "work", claimOrdinal: 1, providerAttemptOrdinal: 1,
  profile: { profileId: "all", profileHash: "b".repeat(64) }, used: amount(10), remaining: amount(90), failureCode: null, evidenceIds: [], ...over,
});
const view = (workItems: WorkItemViewV1[], runs: RunViewV1[] = []): GroupViewV1 => ({
  schema: "orca-control-group-v1", epoch: "epoch-a", changeSeq: 4,
  summary: { groupId: "g", repoId: "orca", state: "running", commandRevision: 6, projectionSeq: 4, stopMode: null, stopState: null, claimBlocked: false, recoveryBlockerCount: 0 },
  graphVersion: 1, plan: { repoId: "orca", planId: "plan-demo", planHash: "a".repeat(64), goal: "Ship", successConditions: ["done"] },
  proposal: { state: "confirmed", proposalVersion: 2, planHash: "a".repeat(64), budgetMode: "soft", contextPolicy: { handoffAtContextTokens: null }, profiles: {
    estimator: { profileId: "all", profileHash: "b".repeat(64) }, worker: { profileId: "all", profileHash: "b".repeat(64) },
    handoff: { profileId: "all", profileHash: "b".repeat(64) }, goalReview: { profileId: "all", profileHash: "b".repeat(64) } }, executionSnapshotHash: "c".repeat(64) },
  ledger: { groupLimit: amount(9_000_000), used: amount(10), committedRemaining: amount(3_000_000), explicitUnallocatedReserve: amount(5_999_990), budgetDeficit: amount(0), usageUnknown: false, unmeteredRuns: 0 },
  allocations: [], workItems, estimates: [], runs, checkpoints: [], handoffRequests: [], stop: null, recoveryBlockers: [], recentCommandIds: [],
});

/** ControlGroupView over the page's own draft store, so a criterion sees drafts the way App keeps them. */
function Stateful(props: { view: GroupViewV1; onCommand: (action: ControlAction) => void }) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const onDraft = (key: string, text: string): void => setDrafts((current) => {
    const next = { ...current };
    if (text === "") delete next[key]; else next[key] = text;
    return next;
  });
  return <ControlGroupView view={props.view} config={config} uncertain={[]} drafts={drafts} onDraft={onDraft} onCommand={props.onCommand} />;
}
/** The task ids of the work-items table's rows (each row's task cell is its detail toggle). */
const rows = (): Array<string | null> => {
  const table = screen.getByRole("table");
  return within(table).getAllByRole("button", { expanded: false }).map((button) => button.textContent);
};

afterEach(cleanup);

describe("labels and progress in the work item table (spec §4.2)", () => {
  it("shows a system label and a custom label with different classes", () => {
    render(<Stateful view={view([workItem({ labels: ["bug", "custom:前端"] })])} onCommand={vi.fn()} />);
    const chips = [...document.querySelectorAll("td span.label")].map((chip) => [chip.textContent, chip.className]);
    // Ruling: human 「这次批准改写所有必要的判据」 (tester round 2026-10-28, controller session a9f9d6de; Tailwind batch 3): the two kinds keep their hook class and add the utility strings of ui/classes.ts.
    // mutation: both kinds wear labelSystem -> red
    expect(chips).toEqual([["bug", labelSystemClass], ["custom:前端", labelCustomClass]]);
  });

  it("filters work items by label, any of the checked ones", () => {
    render(<Stateful view={view([workItem({ taskId: "a", labels: ["bug"] }), workItem({ taskId: "b", labels: ["custom:x"] }), workItem({ taskId: "c", labels: [] })])} onCommand={vi.fn()} />);
    expect(rows()).toEqual(["a", "b", "c"]);
    fireEvent.click(screen.getByRole("checkbox", { name: "bug" }));
    expect(rows()).toEqual(["a"]);
    fireEvent.click(screen.getByRole("checkbox", { name: "custom:x" }));
    expect(rows()).toEqual(["a", "b"]);
  });

  it("drops a checked label that no task carries any more, so the table does not stay empty", () => {
    const { rerender } = render(<Stateful view={view([workItem({ taskId: "a", labels: ["bug"] }), workItem({ taskId: "b", labels: ["perf"] })])} onCommand={vi.fn()} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "bug" }));
    expect(rows()).toEqual(["a"]);
    // The person removed "bug" from its last task: the next read carries it on no task, so its checkbox is gone.
    rerender(<Stateful view={view([workItem({ taskId: "a", labels: [] }), workItem({ taskId: "b", labels: ["perf"] })])} onCommand={vi.fn()} />);
    expect(screen.queryByRole("checkbox", { name: "bug" })).toBeNull();
    expect(rows()).toEqual(["a", "b"]);
  });

  it("says unknown when the run's usage is unknown -- never a percentage -- and notes that usage arrives at phase end", () => {
    expect(progressText({ runId: "r", step: "execute", attempt: { current: 1, max: 3 }, tokens: null, lastTransitionAt: null })).toBe("execute · attempt 1/3 · tokens unknown");
    expect(progressText({ runId: "r", step: null, attempt: null, tokens: { used: 0, grant: 200 }, lastTransitionAt: null })).toBe("not reported yet · attempt unknown · tokens 0% (reported at phase end)");
    expect(progressText({ runId: "r", step: "verify", attempt: { current: 2, max: 2 }, tokens: { used: 50, grant: 200 }, lastTransitionAt: null })).toBe("verify · attempt 2/2 · tokens 25% (reported at phase end)");
    expect(progressText(null)).toBe("no run");
    render(<Stateful view={view([workItem({ progress: { runId: "run-a", step: "execute", attempt: { current: 1, max: 3 }, tokens: null, lastTransitionAt: null } })])} onCommand={vi.fn()} />);
    expect(screen.getByText("execute · attempt 1/3 · tokens unknown")).toBeTruthy();
  });
});

describe("the task detail panel (spec §4.2)", () => {
  // Ruling: human 「这次批准改写所有必要的判据」 (tester #114): labels save as they change; the two pickers, Save and Discard are gone.
  describe("the label row saves each change at once (tester #114)", () => {
    const open = (item: Partial<WorkItemViewV1>): ReturnType<typeof vi.fn> => {
      const onCommand = vi.fn();
      render(<Stateful view={view([workItem(item)])} onCommand={onCommand} />);
      fireEvent.click(screen.getByRole("button", { name: "a" }));
      return onCommand;
    };
    const field = (): HTMLInputElement => screen.getByRole("combobox", { name: "Add label" });
    const type = (word: string): void => { fireEvent.change(field(), { target: { value: word } }); };
    const sent = (labels: string[] | null, baseLabelsVersion = 4) => ({ verb: "set-task-labels", groupId: "g", taskId: "a", expectedRevision: 6, payload: { labels, baseLabelsVersion } });

    // mutation: the system-word test is dropped from add -> "perf" goes out as custom:perf, a label no filter or system chip knows -> red
    it("adds a system word as it is on Enter, sorted the way the server shows it back, and empties the field", () => {
      const onCommand = open({ labels: ["security"], labelsProvenance: "plan", labelsVersion: 4 });
      type("perf");
      fireEvent.keyDown(field(), { key: "Enter" });
      expect(onCommand.mock.calls).toEqual([[sent(["perf", "security"])]]);
      expect(controlCommandPath(onCommand.mock.calls[0]![0] as ControlAction)).toBe("/api/control/groups/g/tasks/a/labels");
      expect(field().value).toBe("");
    });

    // mutation: the prefix is dropped -> the server refuses a bare word that is no system label -> red
    it("gives any other word the custom prefix, once", () => {
      const onCommand = open({ labels: [], labelsVersion: 4 });
      type(" 前端 ");
      fireEvent.keyDown(field(), { key: "Enter" });
      type("custom:ui");
      fireEvent.keyDown(field(), { key: "Enter" });
      expect(onCommand.mock.calls).toEqual([[sent(["custom:前端"])], [sent(["custom:ui"])]]);
    });

    // mutation: the includes guard is dropped -> a repeat spends a labels version on no change -> red
    it("sends nothing for a label the task already has", () => {
      const onCommand = open({ labels: ["bug"], labelsVersion: 4 });
      type("bug");
      fireEvent.keyDown(field(), { key: "Enter" });
      expect(onCommand).not.toHaveBeenCalled();
      expect(field().value).toBe("");
    });

    // mutation: the isComposing guard is dropped -> a Chinese word is sent half composed -> red
    it("does not add on the Enter that ends an IME composition", () => {
      const onCommand = open({ labels: [], labelsVersion: 4 });
      type("qian");
      fireEvent.keyDown(field(), { key: "Enter", isComposing: true });
      expect(onCommand).not.toHaveBeenCalled();
      expect(field().value).toBe("qian");
    });

    it("suggests the system labels in the field's list", () => {
      open({ labels: [], labelsVersion: 4 });
      const list = document.getElementById(field().getAttribute("list")!)!;
      expect([...list.querySelectorAll("option")].map((option) => option.value)).toEqual([...WEB_SYSTEM_LABELS]);
    });

    // mutation: the remove click sends the list unfiltered -> red
    it("removes a label through the × inside its chip, at once", () => {
      const onCommand = open({ labels: ["bug", "custom:x"], labelsVersion: 4 });
      const remove = screen.getByRole("button", { name: "Remove custom:x" });
      expect(remove.closest("span.label")!.textContent).toBe("custom:x×");
      fireEvent.click(remove);
      expect(onCommand.mock.calls).toEqual([[sent(["bug"])]]);
    });

    // A person on a touch screen has no hover: the × must be visible at rest, and only stronger on hover or focus.
    it("keeps the × visible at rest and fully opaque on hover and focus", () => {
      const classes = labelRemove.split(" ");
      expect(classes).toEqual(expect.arrayContaining(["opacity-60", "hover:opacity-100", "focus-visible:opacity-100"]));
      expect(classes).not.toContain("opacity-0");
      expect(classes).not.toContain("hidden");
    });

    // mutation: the provenance test is dropped -> Restore offered on labels that are already the plan's -> red
    it("offers Restore only when the labels are not the plan's, and restores with null", () => {
      const onCommand = open({ labels: ["bug"], labelsProvenance: "operator", labelsVersion: 4 });
      fireEvent.click(screen.getByRole("button", { name: "Restore plan labels" }));
      expect(onCommand.mock.calls).toEqual([[sent(null)]]);
      cleanup();
      open({ labels: ["bug"], labelsProvenance: "plan", labelsVersion: 4 });
      expect(screen.queryByRole("button", { name: "Restore plan labels" })).toBeNull();
      cleanup();
      open({ labels: ["bug"], labelsVersion: 4 });
      expect(screen.queryByRole("button", { name: "Restore plan labels" })).toBeNull();
    });
  });

  describe("a run's evidence, piece by piece", () => {
    const manifest: EvidenceManifestV1 = {
      schema: "orca-run-evidence-v1", runId: "run-a",
      entries: [
        { evidenceId: "ev-1", kind: "usage", sha256: "9".repeat(64), byteLength: 12, downloadUrl: "/api/control/runs/run-a/evidence/ev-1" },
        { evidenceId: "ev-2", kind: "handoff", sha256: "8".repeat(64), byteLength: 7, downloadUrl: "/api/control/runs/run-a/evidence/ev-2" },
      ],
    };
    let requests: Array<{ url: string; headers: unknown }>;
    let downloads: string[];
    beforeEach(() => {
      requests = []; downloads = [];
      URL.createObjectURL = vi.fn(() => "blob:evidence");
      URL.revokeObjectURL = vi.fn();
      vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement): void {
        downloads.push(this.getAttribute("download") ?? "");
      });
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url = String(input);
        requests.push({ url, headers: init?.headers });
        if (url === "/api/control/runs/run-a/activity") return new Response(JSON.stringify({ schema: "orca-run-activity-v1", runId: "run-a", entries: [] }), { status: 200, headers: { "content-type": "application/json" } });
        if (url === "/api/control/runs/run-a/evidence") return new Response(JSON.stringify(manifest), { status: 200, headers: { "content-type": "application/json" } });
        return new Response("bytes", { status: 200, headers: { "content-type": "application/octet-stream" } });
      }) as typeof fetch;
    });
    afterEach(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      vi.restoreAllMocks();
      Reflect.deleteProperty(URL, "createObjectURL");
      Reflect.deleteProperty(URL, "revokeObjectURL");
    });

    it("lists the manifest's entries and downloads one with the session alone", async () => {
      render(<Stateful view={view([workItem({ currentRunId: "run-a", lineageRunIds: ["run-a"] })], [run({})])} onCommand={vi.fn()} />);
      fireEvent.click(screen.getByRole("button", { name: "a" }));
      fireEvent.click(screen.getByRole("button", { name: "List evidence of run-a" }));
      const list = await screen.findByRole("list", { name: "Evidence of run-a" });
      expect(within(list).getAllByRole("listitem").map((entry) => entry.textContent)).toEqual(["ev-1 · usage · 12 bytes Download ev-1", "ev-2 · handoff · 7 bytes Download ev-2"]);
      fireEvent.click(within(list).getByRole("button", { name: "Download ev-2" }));
      await vi.waitFor(() => expect(downloads).toEqual(["ev-2"]));
      // Accounts spec §3.4: both GETs carry no header of the page's own; the browser sends the session cookie.
      expect(requests).toEqual([{ url: "/api/control/runs/run-a/activity", headers: undefined }, { url: "/api/control/runs/run-a/evidence", headers: undefined }, { url: "/api/control/runs/run-a/evidence/ev-2", headers: undefined }]);
    });
  });
});

describe("the group nav's completion (spec §4.2)", () => {
  it("shows each group's done/total", () => {
    const summary: ControlSummaryV1 = {
      schema: "orca-control-summary-v1", epoch: "epoch-a", changeSeq: 4, resetRequired: false, dispatchBlocked: false,
      groups: [{ groupId: "g", repoId: "orca", state: "running", commandRevision: 6, projectionSeq: 4, stopMode: null, stopState: null, claimBlocked: false, recoveryBlockerCount: 0, completion: { done: 1, total: 2 } }],
    };
    const recovery: RecoveryViewV1 = { schema: "orca-control-recovery-v1", epoch: "epoch-a", dispatchBlocked: false, blockers: [] };
    render(<ControlPanel config={config} summary={summary} recovery={recovery} groups={{}} selected={null} drafts={{}} uncertain={[]} refusal={null} refetchRequired={false} onSelect={vi.fn()} onDraft={vi.fn()} onCommand={vi.fn()} />);
    expect(screen.getByRole("button", { name: "g · running · 1/2 done" })).toBeTruthy();
  });
});

describe("the label classes tell the two label kinds apart (spec §4.2)", () => {
  // Ruling: human 「这次批准改写所有必要的判据」 (tester round 2026-10-28, controller session a9f9d6de; Tailwind batch 3): the two looks are the utility strings of ui/classes.ts (were the .label-system / .label-custom rules).
  // mutation: labelCustom loses its dashed edge, then labelSystem loses its tint -> red
  it("gives system and custom labels different looks", () => {
    expect(labelSystem.split(" ")).toContain("bg-accent-subtle");
    expect(labelCustom.split(" ")).toEqual(expect.arrayContaining(["border", "border-dashed", "border-line-strong"]));
    expect(labelSystem).not.toBe(labelCustom);
  });
});


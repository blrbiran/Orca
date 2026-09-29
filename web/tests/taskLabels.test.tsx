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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ControlGroupView } from "../src/ControlGroupView.js";
import { ControlPanel } from "../src/ControlPanel.js";
import { controlCommandPath, type ControlAction } from "../src/controlApi.js";
import type {
  Amount, ControlConfigV1, ControlSummaryV1, EvidenceManifestV1, GroupViewV1, RecoveryViewV1, RunViewV1, WorkItemViewV1,
} from "../src/controlTypes.js";
import { progressText } from "../src/TaskDetail.js";

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
  summary: { groupId: "g", state: "running", commandRevision: 6, projectionSeq: 4, stopMode: null, stopState: null, claimBlocked: false, recoveryBlockerCount: 0 },
  graphVersion: 1, plan: { repoId: "orca", planId: "plan-demo", planHash: "a".repeat(64), goal: "Ship", successConditions: ["done"] },
  proposal: { state: "confirmed", proposalVersion: 2, planHash: "a".repeat(64), budgetMode: "soft", contextPolicy: { handoffAtContextTokens: null }, profiles: {
    estimator: { profileId: "all", profileHash: "b".repeat(64) }, worker: { profileId: "all", profileHash: "b".repeat(64) },
    handoff: { profileId: "all", profileHash: "b".repeat(64) }, goalReview: { profileId: "all", profileHash: "b".repeat(64) } }, executionSnapshotHash: "c".repeat(64) },
  ledger: { groupLimit: amount(9_000_000), used: amount(10), committedRemaining: amount(3_000_000), explicitUnallocatedReserve: amount(5_999_990), budgetDeficit: amount(0), usageUnknown: false },
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
/** The task ids of the rows on screen (each row's task cell is its detail toggle). */
const rows = (): Array<string | null> => screen.getAllByRole("button", { expanded: false }).map((button) => button.textContent);

afterEach(cleanup);

describe("labels and progress in the work item table (spec §4.2)", () => {
  it("shows a system label and a custom label with different classes", () => {
    render(<Stateful view={view([workItem({ labels: ["bug", "custom:前端"] })])} onCommand={vi.fn()} />);
    const chips = [...document.querySelectorAll("td span.label")].map((chip) => [chip.textContent, chip.className]);
    expect(chips).toEqual([["bug", "label label-system"], ["custom:前端", "label label-custom"]]);
  });

  it("filters work items by label, any of the checked ones", () => {
    render(<Stateful view={view([workItem({ taskId: "a", labels: ["bug"] }), workItem({ taskId: "b", labels: ["custom:x"] }), workItem({ taskId: "c", labels: [] })])} onCommand={vi.fn()} />);
    expect(rows()).toEqual(["a", "b", "c"]);
    fireEvent.click(screen.getByRole("checkbox", { name: "bug" }));
    expect(rows()).toEqual(["a"]);
    fireEvent.click(screen.getByRole("checkbox", { name: "custom:x" }));
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
  it("sends the draft labels with the labelsVersion they were read at, and restores the plan's labels with null", () => {
    const onCommand = vi.fn();
    render(<Stateful view={view([workItem({ labels: ["bug"], labelsProvenance: "plan", labelsVersion: 4 })])} onCommand={onCommand} />);
    fireEvent.click(screen.getByRole("button", { name: "a" }));
    fireEvent.change(screen.getByRole("combobox", { name: "System label" }), { target: { value: "perf" } });
    fireEvent.click(screen.getByRole("button", { name: "Add system label" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Custom label" }), { target: { value: "前端" } });
    fireEvent.click(screen.getByRole("button", { name: "Add custom label" }));
    fireEvent.click(screen.getByRole("button", { name: "Save labels" }));
    expect(onCommand).toHaveBeenLastCalledWith({ verb: "set-task-labels", groupId: "g", taskId: "a", expectedRevision: 6, payload: { labels: ["bug", "custom:前端", "perf"], baseLabelsVersion: 4 } });
    fireEvent.click(screen.getByRole("button", { name: "Restore plan labels" }));
    expect(onCommand).toHaveBeenLastCalledWith({ verb: "set-task-labels", groupId: "g", taskId: "a", expectedRevision: 6, payload: { labels: null, baseLabelsVersion: 4 } });
    expect(controlCommandPath(onCommand.mock.calls[0]![0] as ControlAction)).toBe("/api/control/groups/g/tasks/a/labels");
  });

  describe("a run's evidence, piece by piece", () => {
    const TOKEN = "token-injected-by-staticFiles";
    const manifest: EvidenceManifestV1 = {
      schema: "orca-run-evidence-v1", runId: "run-a",
      entries: [
        { evidenceId: "ev-1", kind: "usage", sha256: "9".repeat(64), byteLength: 12, downloadUrl: "/api/control/runs/run-a/evidence/ev-1" },
        { evidenceId: "ev-2", kind: "handoff", sha256: "8".repeat(64), byteLength: 7, downloadUrl: "/api/control/runs/run-a/evidence/ev-2" },
      ],
    };
    let requests: Array<{ url: string; token: string | undefined }>;
    let downloads: string[];
    beforeEach(() => {
      requests = []; downloads = [];
      window.__ORCA_TOKEN__ = TOKEN;
      URL.createObjectURL = vi.fn(() => "blob:evidence");
      URL.revokeObjectURL = vi.fn();
      vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement): void {
        downloads.push(this.getAttribute("download") ?? "");
      });
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url = String(input);
        requests.push({ url, token: (init?.headers as Record<string, string> | undefined)?.["x-orca-token"] });
        if (url === "/api/control/runs/run-a/evidence") return new Response(JSON.stringify(manifest), { status: 200, headers: { "content-type": "application/json" } });
        return new Response("bytes", { status: 200, headers: { "content-type": "application/octet-stream" } });
      }) as typeof fetch;
    });
    afterEach(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      vi.restoreAllMocks();
      Reflect.deleteProperty(URL, "createObjectURL");
      Reflect.deleteProperty(URL, "revokeObjectURL");
      Reflect.deleteProperty(window, "__ORCA_TOKEN__");
    });

    it("lists the manifest's entries and downloads one through the panel token", async () => {
      render(<Stateful view={view([workItem({ currentRunId: "run-a", lineageRunIds: ["run-a"] })], [run({})])} onCommand={vi.fn()} />);
      fireEvent.click(screen.getByRole("button", { name: "a" }));
      fireEvent.click(screen.getByRole("button", { name: "List evidence of run-a" }));
      const list = await screen.findByRole("list", { name: "Evidence of run-a" });
      expect(within(list).getAllByRole("listitem").map((entry) => entry.textContent)).toEqual(["ev-1 · usage · 12 bytes Download ev-1", "ev-2 · handoff · 7 bytes Download ev-2"]);
      fireEvent.click(within(list).getByRole("button", { name: "Download ev-2" }));
      await vi.waitFor(() => expect(downloads).toEqual(["ev-2"]));
      expect(requests).toEqual([{ url: "/api/control/runs/run-a/evidence", token: TOKEN }, { url: "/api/control/runs/run-a/evidence/ev-2", token: TOKEN }]);
    });
  });
});

describe("the group nav's completion (spec §4.2)", () => {
  it("shows each group's done/total", () => {
    const summary: ControlSummaryV1 = {
      schema: "orca-control-summary-v1", epoch: "epoch-a", changeSeq: 4, resetRequired: false, dispatchBlocked: false,
      groups: [{ groupId: "g", state: "running", commandRevision: 6, projectionSeq: 4, stopMode: null, stopState: null, claimBlocked: false, recoveryBlockerCount: 0, completion: { done: 1, total: 2 } }],
    };
    const recovery: RecoveryViewV1 = { schema: "orca-control-recovery-v1", epoch: "epoch-a", dispatchBlocked: false, blockers: [] };
    render(<ControlPanel config={config} summary={summary} recovery={recovery} groups={{}} selected={null} drafts={{}} uncertain={[]} refusal={null} refetchRequired={false} onSelect={vi.fn()} onDraft={vi.fn()} onCommand={vi.fn()} />);
    expect(screen.getByRole("button", { name: "g · running · 1/2 done" })).toBeTruthy();
  });
});

describe("styles.css tells the two label kinds apart (spec §4.2)", () => {
  it("gives system and custom labels different rules", () => {
    // Resolved without the global URL: this file runs under jsdom, whose URL node's fileURLToPath refuses.
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../src/styles.css"), "utf8");
    const rule = (selector: string): string => {
      const at = css.indexOf(`${selector} {`);
      if (at === -1) throw new Error(`no rule for ${selector}`);
      return css.slice(at, css.indexOf("}", at));
    };
    expect(rule(".label-system")).toContain("background: var(--accent-subtle)");
    expect(rule(".label-custom")).toContain("border: 1px dashed var(--border-strong)");
  });
});

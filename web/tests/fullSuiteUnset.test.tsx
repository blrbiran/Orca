// @vitest-environment jsdom
/**
 * Tester follow-up K, item 2 (human ruling ①: 「还是觉得 ① 就好，这是人不设测试命令的结果，不应该替人决定必须跑pass」): Orca
 * runs no full suite the person did not adopt; it says so instead. A group acceptance from before the full suite existed
 * warns like one with none set; Overview lists the warning as a row after the problems (it is not one); and the confirm
 * view, while the project has no command but Orca detected one, shows the suggestion with the same Adopt action.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AccountContext } from "../src/AuthGate.js";
import type { Me } from "../src/auth.js";
import { BudgetEditor } from "../src/BudgetEditor.js";
import { GroupFullSuiteWarning } from "../src/GroupFullSuiteWarning.js";
import { Overview } from "../src/Overview.js";
import { deriveOverview } from "../src/overviewModel.js";
import type { ChecksReadV1, CheckTriggerV1, GroupViewV1, OverviewStepV1, OverviewV1 } from "../src/controlTypes.js";
import { amount, config, view as boardView } from "./fixtures/board.js";
import "../src/i18n.js";

const owner: Me = { user: { id: "u1", name: "olga", roles: ["owner"], mustChangePassword: false }, expiresAt: 0, sessionDays: 15 };
const jsonResponse = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const TRIGGER: CheckTriggerV1 = { all: [{ any: [{ kind: "queue-idle" }] }] };
const S = <T,>(value: T) => ({ value, source: "builtin" as const, lockedBy: null });
const read = (suggestedCommand: string | null): ChecksReadV1 => ({
  schema: "orca-checks-v1", repoId: "repo",
  kinds: {
    "integration-check": { enabled: S(false), trigger: S(TRIGGER), command: S<string | null>(null) },
    "model-review": { enabled: S(true), trigger: S(TRIGGER), budgetTokens: S(1_000_000), maxGroupsPerReview: S(12) },
  },
  scheduled: [], locks: [], state: [], revision: 5, nextSlots: {}, suggestedCommand,
});

let posts: Array<{ url: string; body: { expectedRevision: number; payload: unknown } }>;
let suggestion: string | null;
beforeEach(() => {
  posts = []; suggestion = "npm test";
  document.cookie = "orca_csrf=t";
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if ((init?.method ?? "GET") === "POST") { posts.push({ url: String(input), body: JSON.parse(String(init!.body)) }); return jsonResponse({ schema: "orca-command-success-v1" }); }
    return String(input).includes("/checks") ? jsonResponse(read(suggestion)) : jsonResponse({}, 404);
  }) as typeof fetch;
});
afterEach(cleanup);

const draft = (): GroupViewV1 => {
  const base = boardView([]);
  return {
    ...base, summary: { ...base.summary, state: "draft" },
    proposal: { ...base.proposal, state: "editable", profiles: null, budgetMode: null, executionSnapshotHash: null },
    ledger: { ...base.ledger, groupLimit: amount(9_000_000), budgetDeficit: { tokens: 0, activeMs: 0, attempts: 0, sessions: 0 } },
  };
};
const editor = (v: GroupViewV1) => render(<AccountContext.Provider value={owner}>
  <BudgetEditor view={v} config={config} drafts={{}} onDraft={() => {}} onCommand={() => {}} selectionsHash={"9".repeat(64)} />
</AccountContext.Provider>);

describe("no adopted full suite (item 2)", () => {
  it("the confirm view shows the detected command with Adopt, which sets the project's command", async () => {
    editor(draft());
    expect(await screen.findByText(/this project has no full-suite command, so group acceptance will run only the tasks' own checks/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Adopt npm test" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]!.url).toBe("/api/control/repositories/orca/checks/settings");
    expect(posts[0]!.body).toMatchObject({ expectedRevision: 5, payload: { kind: "integration-check", set: { command: "npm test" } } });
  });

  it("the confirm view says nothing when Orca detected no command (or one is set)", async () => {
    suggestion = null;
    editor(draft());
    await screen.findByRole("button", { name: "Confirm task plan" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByText(/no full-suite command/i)).toBeNull();
  });

  it("an old passed acceptance with no fullSuite field warns in Problems like one with none set", () => {
    render(<GroupFullSuiteWarning repoId="repo" archived={false}
      acceptance={{ tip: "a".repeat(40), result: "passed", commands: [], at: 1, warning: "full-suite-not-set", passedWithoutFullSuite: true }} />);
    expect(screen.getByText(/No full test suite ran at acceptance/)).toBeTruthy();
  });

  it("Overview lists the warning as its own row, after the problems", () => {
    const step = (kind: OverviewStepV1["kind"], reason: string): OverviewStepV1 => ({ key: `${kind}:g1`, kind, groupId: "g1", repoId: "repo", taskId: null, runId: null, reason, ownerRequired: false,
      destination: { kind: "group", groupId: "g1", region: "problem", taskId: null, runId: null } });
    const projection = { schema: "orca-control-overview-v1", epoch: "e", changeSeq: 1, groups: [], issues: [],
      steps: [step("acceptance-warning", "full-suite-not-set"), step("task-attention", "task-blocked")] } as unknown as OverviewV1;
    const model = deriveOverview({ projection: { status: "available", data: projection, error: null }, todo: { status: "available", data: [], error: null },
      recovery: { status: "available", data: null, error: null }, uncertain: [], scope: { kind: "all" } as never, projectKey: null, projects: [], roles: ["owner"] });
    expect(model.queue.map((row) => row.kind)).toEqual(["task-attention", "acceptance-warning"]);
    render(<Overview model={model} onOpen={() => {}} onImport={() => {}} onRequirement={() => {}} />);
    expect(screen.getByRole("button", { name: /Check full suite · g1/ })).toBeTruthy();
  });
});

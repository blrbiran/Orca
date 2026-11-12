// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "../src/i18n.js";
import { ControlGroupView } from "../src/ControlGroupView.js";
import { commandEnvelope, controlCommandPath } from "../src/controlApi.js";
import type { ControlRefusal } from "../src/controlState.js";
import type { RunViewV1, WorkItemViewV1 } from "../src/controlTypes.js";
import { config, run, view } from "./usageRecoveryFixture.js";
import { workItem } from "./fixtures/board.js";

/**
 * Reviewed acceptance (spec 2026-11-11 §7, #227), the Web half: on the task detail's run list, an owner may ask Orca to land
 * the last attempt of a terminal, settled, failed run after re-running the task's setup and required checks on the merged
 * tree. Only an owner is offered it, only where the server could accept it, the note is required, and the sent payload is
 * exactly the server's `{taskId, runId, note}`. Where an acceptance stands (pending, landed, refused) is said to everyone.
 * Named mutations (each seen red, Rule 9): offer it to any role -> "a member is not offered it" red; drop the
 * settled-failed / failure-outcome gate -> "not offered for a succeeded or running run" red; drop the empty-note disable ->
 * "an empty note cannot be sent" red; send an extra payload key -> "sends exactly" red; drop the state line -> "says where
 * an acceptance stands" red; delete the en catalog words of accept-attempt-run-not-current -> "a refusal shows its words" red.
 */
afterEach(cleanup);
const OPEN = "Accept this attempt after checks";
const SEND = "Send acceptance";
const NOTE = "Note for the record (required)";
const settledFailed = (over: Partial<RunViewV1> = {}) => run({ state: "settled-failed", outcome: "failed", terminalClosed: true, endedAt: 2000, ...over });
const blockedOn = (over: Partial<WorkItemViewV1> = {}) => workItem({ taskId: "a", status: "blocked", currentRunId: "run-a", ...over });
const show = (roles: ("owner" | "member")[], r: RunViewV1 = settledFailed(), item = blockedOn(), refusal: ControlRefusal | null = null) => {
  const onCommand = vi.fn();
  const result = render(<ControlGroupView focus={{ kind: "group", groupId: "g", region: "progress", taskId: "a", runId: null }} view={{ ...view([r]), workItems: [item] }}
    config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={onCommand} roles={roles} refusal={refusal} />);
  return { ...result, onCommand, task: document.querySelector<HTMLElement>('section[data-task-id="a"]')! };
};

describe("accept a failed attempt after checks (#227)", () => {
  it("an owner is offered it on a settled, failed run; the form says what Orca will do and lists the task's checks", () => {
    const loopPlan = { planId: "bugfix" as const, planVersion: 1, chosenBy: "labels" as const, chosenByLabel: "bug", amended: false, loopVersion: 0, maxFiles: 25, hasDiscipline: true,
      inputs: { goal: "fix login", successCondition: "the login test passes", targetPaths: ["src/auth/**"], checks: ["npm test -- --run auth", "npm run lint"], nonGoals: [], relevantDocs: [], protectedPaths: [], maxFilesTouched: null } };
    const { task } = show(["owner"], settledFailed(), blockedOn({ loopPlan }));
    fireEvent.click(within(task).getByRole("button", { name: OPEN }));
    const form = within(task).getByRole("group", { name: OPEN });
    expect(within(form).getByText("Orca will merge this attempt onto the group branch, run the task's setup and required checks on the merged tree, and land it only if they all pass. Nothing is charged again.")).toBeTruthy();
    expect(within(within(form).getByRole("list", { name: "The task's checks" })).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["npm test -- --run auth", "npm run lint"]);
    // The action is a secondary button: the view keeps its one primary elsewhere (web/DESIGN.md).
    expect(within(task).getByRole("button", { name: SEND }).classList.contains("btn-primary")).toBe(false);
  });

  it.each([[["member"]], [[]]] as ("owner" | "member")[][][])("a member or an absent account is not offered it: %j", (roles) => {
    const { task } = show(roles);
    expect(within(task).queryByRole("button", { name: OPEN })).toBeNull();
  });

  it.each([
    ["a succeeded run", run({ state: "landed", outcome: "succeeded" }), blockedOn({ status: "completed" })],
    ["a running run", run({ state: "running", outcome: null }), blockedOn({ status: "active" })],
    ["a blocked run whose accounting is open", run({ state: "blocked", outcome: "failed" }), blockedOn()],
    ["an older run the task moved on from", settledFailed(), blockedOn({ currentRunId: "run-b" })],
  ])("is not offered for %s", (_name, r, item) => {
    const { task } = show(["owner"], r, item);
    expect(within(task).queryByRole("button", { name: OPEN })).toBeNull();
  });

  it("an empty note (or one over 2048 characters) cannot be sent", () => {
    const { task, onCommand } = show(["owner"]);
    fireEvent.click(within(task).getByRole("button", { name: OPEN }));
    const send = within(task).getByRole("button", { name: SEND }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.change(within(task).getByRole("textbox", { name: NOTE }), { target: { value: "   " } });
    expect(send.disabled).toBe(true);
    fireEvent.change(within(task).getByRole("textbox", { name: NOTE }), { target: { value: "x".repeat(2049) } });
    expect(send.disabled).toBe(true);
    fireEvent.click(send);
    expect(onCommand).not.toHaveBeenCalled();
  });

  it("sends exactly the server's payload, on the accept-attempt route, under the visible revision", () => {
    const { task, onCommand } = show(["owner"]);
    fireEvent.click(within(task).getByRole("button", { name: OPEN }));
    fireEvent.change(within(task).getByRole("textbox", { name: NOTE }), { target: { value: "read the diff; the checks are what matter" } });
    fireEvent.click(within(task).getByRole("button", { name: SEND }));
    expect(onCommand).toHaveBeenCalledExactlyOnceWith({ verb: "accept-attempt", groupId: "g", expectedRevision: 6, payload: { taskId: "a", runId: "run-a", note: "read the diff; the checks are what matter" } });
    const action = onCommand.mock.calls[0]![0];
    expect(controlCommandPath(action)).toBe("/api/control/groups/g/accept-attempt");
    expect(commandEnvelope("intent", action)).toEqual({ commandId: "intent", expectedRevision: 6, payload: { taskId: "a", runId: "run-a", note: "read the diff; the checks are what matter" } });
  });

  it("says where an acceptance stands, to everyone; only a refused one may be sent again", () => {
    const acceptance = { note: "looks right", principal: "user:owner", at: 1234, reason: null, landedCommit: null };
    let shown = show(["member"], settledFailed({ operatorAcceptance: { ...acceptance, state: "pending" } }));
    expect(within(shown.task).getByText("user:owner asked to accept this attempt: Orca is re-running the task's checks on the merged tree. Note: looks right").getAttribute("data-tone")).toBe("info");
    cleanup(); shown = show(["owner"], settledFailed({ operatorAcceptance: { ...acceptance, state: "pending" } }));
    expect(within(shown.task).queryByRole("button", { name: OPEN })).toBeNull();
    cleanup(); shown = show(["owner"], settledFailed({ operatorAcceptance: { ...acceptance, state: "landed", landedCommit: "abc1234" } }));
    expect(within(shown.task).getByText("Accepted by user:owner; the checks passed and it landed as abc1234. Note: looks right").getAttribute("data-tone")).toBe("ok");
    expect(within(shown.task).queryByRole("button", { name: OPEN })).toBeNull();
    cleanup(); shown = show(["owner"], settledFailed({ operatorAcceptance: { ...acceptance, state: "refused", reason: "check: npm test exited 1" } }));
    expect(within(shown.task).getByText("The acceptance user:owner asked for was refused: check: npm test exited 1. Note: looks right").getAttribute("data-tone")).toBe("danger");
    expect(within(shown.task).getByRole("button", { name: OPEN })).toBeTruthy();
  });

  it("a refusal shows its words in the group's refusal notice", () => {
    show(["owner"], settledFailed(), blockedOn(), { status: 409, code: "accept-attempt-run-not-current", message: "accept-attempt-run-not-current", commandRevision: 6 });
    expect(screen.getByTestId("group-refusal").textContent).toContain("Only the task's latest run, while the task is blocked on it, can have its attempt accepted.");
  });

  it("renders in Chinese", async () => {
    await i18n.changeLanguage("zh");
    try {
      const { task } = show(["owner"]);
      fireEvent.click(within(task).getByRole("button", { name: "检查通过后接受这次尝试" }));
      expect(within(task).getByRole("textbox", { name: "记录备注（必填）" })).toBeTruthy();
      expect(within(task).getByRole("button", { name: "发送接受" })).toBeTruthy();
    } finally { await i18n.changeLanguage("en"); }
  });
});

/**
 * #227 residual: the form listed only a loop task's checks and showed nothing of what the attempt changed. The server's
 * `attemptReview` (src/panel/attemptReview.ts) names the setup and required checks the driver will run for any task, and
 * the attempt's diff stat once read; a task with none is told the driver refuses it (no-required-checks).
 */
describe("what the accept form shows from the server's review (#227 residual)", () => {
  const STAT = [" a        | 1 +", " base.txt | 1 -", " 2 files changed, 1 insertion(+), 1 deletion(-)"];
  const open = (review: RunViewV1["attemptReview"], item = blockedOn()) => {
    const { task } = show(["owner"], settledFailed({ attemptReview: review }), item);
    fireEvent.click(within(task).getByRole("button", { name: OPEN }));
    return within(task).getByRole("group", { name: OPEN });
  };

  // mutation: the form reads item.loopPlan's checks only -> a non-loop task lists none -> red
  // mutation: the setup list is not rendered -> red
  it("lists a non-loop task's setup and required checks, and the attempt's diff stat", () => {
    const form = open({ requiredChecks: ["npm test"], setupCommands: ["npm ci"], diff: { shortstat: "2 files changed, 1 insertion(+), 1 deletion(-)", stat: STAT } });
    expect(within(within(form).getByRole("list", { name: "The task's checks" })).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["npm test"]);
    expect(within(within(form).getByRole("list", { name: "The task's setup commands" })).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["npm ci"]);
    const diff = within(form).getByTestId("accept-attempt-diff");
    expect(diff.textContent).toContain("2 files changed, 1 insertion(+), 1 deletion(-)");
    expect(diff.querySelector("pre")!.textContent).toBe(STAT.join("\n"));
  });

  // mutation: a null diff renders an empty stat instead of saying it is being read -> red
  it("says the diff is being read until the server has it", () => {
    const form = open({ requiredChecks: ["npm test"], setupCommands: [], diff: null });
    expect(within(form).getByTestId("accept-attempt-diff").textContent).toContain("Reading what the attempt changed");
  });

  // mutation: the no-checks note is dropped -> red
  it("tells a task with no required checks that Orca will refuse to land it", () => {
    const form = open({ requiredChecks: [], setupCommands: [], diff: null });
    expect(within(form).getByRole("note").textContent).toContain("no-required-checks");
  });
});

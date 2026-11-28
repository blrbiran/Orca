// @vitest-environment jsdom
/**
 * Tester follow-up E §5 (#241): a group whose acceptance failed on its final tip is not done; the Problems region names it
 * by its code `group-acceptance-failed:<command>` with the output tail, offers Recheck to anyone (a flaky check) and Waive
 * to an owner (with a note saying why). Nothing shows for an acceptance that did not fail.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GroupAcceptanceProblem } from "../src/GroupAcceptanceProblem.js";
import i18n from "../src/i18n.js";
import type { GroupAcceptanceV1 } from "../src/controlTypes.js";

const FAILED: GroupAcceptanceV1 = { tip: "c".repeat(40), result: "failed", commands: [{ command: "npm test", exit: "1", ms: 5 }], tail: "FAIL a.test.ts", at: 1, problem: "group-acceptance-failed:npm test" };
afterEach(async () => { cleanup(); await i18n.changeLanguage("en"); });

const show = (acceptance: GroupAcceptanceV1 | undefined, roles: Array<"owner" | "member"> = ["member"], archived = false) => {
  const onCommand = vi.fn();
  const view = render(<GroupAcceptanceProblem groupId="g" acceptance={acceptance} roles={roles} archived={archived} revision={7} onCommand={onCommand} />);
  return { onCommand, view };
};

describe("the Problems row of a failed group acceptance (tester follow-up E §5)", () => {
  it("names the problem by its code, says what failed, and shows the output tail", () => {
    const { view } = show(FAILED);
    expect(view.container.querySelector("code")?.textContent).toBe("group-acceptance-failed:npm test");
    expect(screen.getByText("The group's final tree failed npm test (exit 1) at cccccccccccc; the group is not done.")).toBeTruthy();
    expect(view.container.querySelector("pre")?.textContent).toBe("FAIL a.test.ts");
  });

  it("shows the comparison reason and shortfall, and does not offer a waiver for a shortfall", () => {
    const acceptance: GroupAcceptanceV1 = { ...FAILED,
      commands: [{ command: "npm test || npm test", exit: "0", ms: 5 }],
      identityComparisons: [
        { command: "npm test || npm test", base: "b".repeat(40), setupDigest: "s".repeat(64), reporter: "node-test-tap-v1", baselineSource: "stored",
          tipAttempts: [
            { exit: "1", failureIdentityStatus: "complete", failureIdentities: [], reportedFailures: 1, blockCount: 1, tests: 79, tail: "red" },
            { exit: "0", reportedFailures: 0, blockCount: 1, tests: 79, tail: "green" },
          ], baseIdentities: [], tipIdentities: [], reason: "new-failure" },
        ...(["non-comparable", "baseline-unavailable", "base-green"] as const).map((reason, index) => ({
          command: ["pytest -q", "npx vitest run", "go test ./..."][index]!, base: "b".repeat(40), setupDigest: "s".repeat(64),
          reporter: "node-test-tap-v1" as const, baselineSource: "unavailable" as const,
          tipAttempts: [{ exit: "1", failureIdentityStatus: "ambiguous" as const, failureIdentities: [], reportedFailures: 1, blockCount: 1, tests: 1, tail: "red" }],
          baseIdentities: [], tipIdentities: [], reason,
        })),
      ],
      evidence: { cwd: null, head: "c".repeat(40), trackedFiles: 4, testFiles: 2, tests: 79, suiteTests: [79, 79], baselineTests: 552,
        baselineCount: { state: "counted", tests: 552, source: "base-suite" }, shortfall: { tests: 79, baselineTests: 552 } },
    };
    show(acceptance, ["owner"]);
    expect(screen.getByText("The group's final tree failed npm test || npm test (exit 1) at cccccccccccc; the group is not done.")).toBeTruthy();
    const diagnostics = screen.getByTestId("group-acceptance-diagnostics").textContent ?? "";
    expect(diagnostics).toContain("The tip introduced a failing test identity in npm test || npm test.");
    expect(diagnostics).toContain("The red output from pytest -q could not be compared with the base.");
    expect(diagnostics).toContain("No base result is available to compare npx vitest run.");
    expect(diagnostics).toContain("go test ./... passed on the base; the tip's failure is new.");
    expect(diagnostics).toContain("npm test || npm test invocation exits: 1, 0");
    expect(diagnostics).toContain("Suite counts: 79 tests on the tip; 552 on the base.");
    expect(diagnostics).toContain("A measured test-count shortfall cannot be waived.");
    expect(screen.getByRole("button", { name: "Recheck" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Waive…" })).toBeNull();
  });

  it("offers Recheck to a member, which sends recheck-acceptance; no Waive", () => {
    const { onCommand } = show(FAILED, ["member"]);
    expect(screen.queryByRole("button", { name: "Waive…" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Recheck" }));
    expect(onCommand).toHaveBeenCalledWith({ verb: "recheck-acceptance", groupId: "g", expectedRevision: 7, payload: {} });
  });

  it("offers Waive to an owner, which sends waive-acceptance with the note, and only with a note", () => {
    const { onCommand } = show(FAILED, ["owner"]);
    fireEvent.click(screen.getByRole("button", { name: "Waive…" }));
    const send = screen.getByRole("button", { name: "Accept this tip anyway" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Why you accept the failed tip"), { target: { value: "known flake" } });
    fireEvent.click(send);
    expect(onCommand).toHaveBeenCalledWith({ verb: "waive-acceptance", groupId: "g", expectedRevision: 7, payload: { note: "known flake" } });
  });

  it("an archived group shows the problem and no buttons", () => {
    show(FAILED, ["owner"], true);
    expect(screen.queryAllByRole("button")).toEqual([]);
  });

  it.each([["passed"], ["waived"], ["not-needed"]] as const)("shows nothing for a %s acceptance", (result) => {
    const { view } = show({ ...FAILED, result, problem: undefined });
    expect(view.container.textContent).toBe("");
  });

  it("says it in Chinese", async () => {
    await i18n.changeLanguage("zh");
    show(FAILED, ["owner"]);
    expect(screen.getByText("组的最终树没有通过 npm test（退出码 1），位置 cccccccccccc；这个组还没有完成。")).toBeTruthy();
    expect(screen.getByRole("button", { name: "重新检查" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "豁免…" })).toBeTruthy();
  });
});

// Tester #278: a work branch that no longer exists is recorded as `not-run: work-branch-missing`, not retried every round;
// the group says so (a fact, no tone, no buttons: nothing here answers it but a new landing), in both languages.
describe("a group acceptance not run because the work branch is gone (tester #278)", () => {
  const MISSING: GroupAcceptanceV1 = { tip: null, result: "not-run", why: "work-branch-missing", landings: 2, commands: [], at: 1 };

  it("names the missing branch and offers nothing to press", () => {
    const { view } = show(MISSING, ["owner"]);
    expect(view.container.textContent).toBe("Group acceptance did not run: the work branch orca/g no longer exists. A later landing checks it again.");
    expect(screen.queryAllByRole("button")).toEqual([]);
  });

  it("shows nothing for another not-run reason", () => {
    const { view } = show({ ...MISSING, why: "multi-repo", landings: undefined });
    expect(view.container.textContent).toBe("");
  });

  it("says it in Chinese", async () => {
    await i18n.changeLanguage("zh");
    const { view } = show(MISSING);
    expect(view.container.textContent).toBe("组验收没有运行：工作分支 orca/g 已不存在。之后有新的落地时会重新检查。");
  });
});

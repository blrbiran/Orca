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

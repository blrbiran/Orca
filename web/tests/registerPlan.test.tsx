// @vitest-environment jsdom
// In-repo plan path spec 2026-10-21 §2.5 (#65): the import form registers a plan file of the chosen repository (file
// mode only), so a person no longer restarts the panel with --plan to import a plan that lives in their repository.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ControlPanel, type RegisterPlan } from "../src/ControlPanel.js";
import i18n from "../src/i18n.js";
import { explainRefusal } from "../src/refusalExplain.js";
import type { ControlConfigV1, ControlSummaryV1, RecoveryViewV1 } from "../src/controlTypes.js";

afterEach(() => { cleanup(); void i18n.changeLanguage("en"); });

const config: ControlConfigV1 = {
  schema: "orca-control-config-v1", epoch: "epoch-a",
  repositories: [{ repoId: "repo", displayName: "Repository" }],
  plans: [], profiles: [], defaults: null, executionPort: "unconfigured", errorCatalog: [],
};
const summary: ControlSummaryV1 = { schema: "orca-control-summary-v1", epoch: "epoch-a", changeSeq: 0, resetRequired: false, dispatchBlocked: false, groups: [] };
const recovery: RecoveryViewV1 = { schema: "orca-control-recovery-v1", epoch: "epoch-a", dispatchBlocked: false, blockers: [] };
const mount = (onRegisterPlan?: RegisterPlan) => render(<ControlPanel config={config} summary={summary} recovery={recovery} groups={{}} selected={null}
  drafts={{}} uncertain={[]} refusal={null} refetchRequired={false} onSelect={vi.fn()} onCommand={vi.fn()} onDraft={vi.fn()}
  {...(onRegisterPlan === undefined ? {} : { onRegisterPlan })} />);

describe("registering a plan file from the import form (spec 2026-10-21)", () => {
  it("sends the chosen repository and the trimmed path, and says it was registered", async () => {
    const onRegister = vi.fn<RegisterPlan>(async () => ({ ok: true }));
    mount(onRegister);
    const form = screen.getByRole("region", { name: "Import plan" });
    fireEvent.change(within(form).getByRole("textbox"), { target: { value: "  plans/ship.json " } });
    fireEvent.click(within(form).getByRole("button", { name: "Register plan" }));
    expect(onRegister).toHaveBeenCalledWith("repo", "plans/ship.json");
    await waitFor(() => expect(within(form).getByRole("status").textContent).toContain("Registered plans/ship.json"));
  });

  it("shows a refusal by its code and message", async () => {
    mount(async () => ({ ok: false, code: "plan-not-tracked", message: "plans/x.json is not tracked by git in repo" }));
    const form = screen.getByRole("region", { name: "Import plan" });
    fireEvent.change(within(form).getByRole("textbox"), { target: { value: "plans/x.json" } });
    fireEvent.click(within(form).getByRole("button", { name: "Register plan" }));
    await waitFor(() => expect(within(form).getByRole("alert").textContent).toBe("Not registered (plan-not-tracked): plans/x.json is not tracked by git in repo"));
  });

  it("offers nothing in command-line mode (no callback)", () => {
    mount();
    expect(within(screen.getByRole("region", { name: "Import plan" })).queryByRole("button", { name: "Register plan" })).toBeNull();
  });

  it("explains an import refused because the registered plan changed, in both languages", async () => {
    const refusal = { status: 422, code: "control-plan-rejected", message: "control-plan-rejected:plan-changed-since-registration", detail: "plan-changed-since-registration" } as never;
    expect(explainRefusal(refusal).items).toEqual(["The plan file changed after it was registered. Register it again to trust the new content, then import."]);
    await i18n.changeLanguage("zh");
    expect(explainRefusal(refusal).items).toEqual(["计划文件在登记之后被改过。请再登记一次以信任新内容，然后再导入。"]);
  });
});

// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ControlPanel } from "../src/ControlPanel.js";
import i18n from "../src/i18n.js";
import type { ControlConfigV1, ControlSummaryV1, RecoveryViewV1 } from "../src/controlTypes.js";

afterEach(() => { cleanup(); void i18n.changeLanguage("en"); });

const config: ControlConfigV1 = {
  schema: "orca-control-config-v1", epoch: "epoch-a",
  repositories: [{ repoId: "repo", displayName: "Repository" }],
  plans: [{ planId: "plan", repoId: "repo", displayName: "Plan" }],
  profiles: [], defaults: null, executionPort: "unconfigured", errorCatalog: [],
};
const summary: ControlSummaryV1 = { schema: "orca-control-summary-v1", epoch: "epoch-a", changeSeq: 0, resetRequired: false, dispatchBlocked: false, groups: [] };
const recovery: RecoveryViewV1 = { schema: "orca-control-recovery-v1", epoch: "epoch-a", dispatchBlocked: false, blockers: [] };
const mount = (onCommand = vi.fn(), shownConfig = config) => render(<ControlPanel config={shownConfig} summary={summary} recovery={recovery} groups={{}} selected={null}
  drafts={{}} uncertain={[]} refusal={null} refetchRequired={false} onSelect={vi.fn()} onCommand={onCommand} onDraft={vi.fn()} />);

describe("plan import with no estimator configured", () => {
  it("keeps the configured estimator fields on an ordinary import", () => {
    const onCommand = vi.fn();
    mount(onCommand, { ...config, defaults: { estimatorProfileId: "all", estimatorProfileHash: "b".repeat(64), estimateMode: "soft" } });
    fireEvent.click(within(screen.getByRole("region", { name: "Import plan" })).getByRole("button", { name: "Import plan" }));
    expect(onCommand.mock.calls[0]![0].payload).toMatchObject({ estimatorProfileId: "all", estimatorProfileHash: "b".repeat(64), estimateMode: "soft" });
  });
  it("submits a real import intent with only group, repository and plan fields", () => {
    const onCommand = vi.fn();
    mount(onCommand);
    const form = screen.getByRole("region", { name: "Import plan" });
    expect(within(form).getByText(/without an estimate/i)).toBeTruthy();
    fireEvent.click(within(form).getByRole("button", { name: "Import plan" }));
    expect(onCommand).toHaveBeenCalledTimes(1);
    const action = onCommand.mock.calls[0]![0];
    expect(action).toMatchObject({ verb: "import-plan", expectedRevision: 0, payload: { repoId: "repo", planId: "plan" } });
    expect(action.payload.groupId).toBe(action.groupId);
    expect(Object.keys(action.payload).sort()).toEqual(["groupId", "planId", "repoId"]);
  });

  it("explains in Chinese that import can proceed and estimation stays unavailable", async () => {
    await i18n.changeLanguage("zh");
    mount();
    const form = screen.getByRole("region", { name: "导入计划" });
    expect(within(form).getByText(/可以导入计划/)).toBeTruthy();
    expect(within(form).getByRole("button", { name: "导入计划" })).toBeTruthy();
  });
});

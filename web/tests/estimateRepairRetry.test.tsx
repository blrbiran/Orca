// @vitest-environment jsdom
/**
 * Estimate-usable-answer spec §4.4: an estimate row names its repairs, the retry it came from, the retry made from it
 * and why a retry was skipped, in both locales. Old rows (no such fields) show none of it.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "../src/i18n.js";
import { ControlGroupView } from "../src/ControlGroupView.js";
import type { Amount, ControlConfigV1, EstimateViewV1, GroupViewV1 } from "../src/controlTypes.js";

const amount = (tokens: number): Amount => ({ tokens, activeMs: 1_000, attempts: 1, sessions: 1 });
const profile = { profileId: "p1", profileHash: "b".repeat(64) };
const config: ControlConfigV1 = {
  schema: "orca-control-config-v1", epoch: "epoch-a", repositories: [{ repoId: "orca", displayName: "Repo X" }],
  plans: [{ planId: "plan-demo", repoId: "orca", displayName: "Demo P" }], profiles: [], defaults: null, executionPort: "unconfigured", errorCatalog: [],
};
const est = (id: string, version: number, extra: Partial<EstimateViewV1>): EstimateViewV1 => ({
  estimateId: id, estimateVersion: version, state: "failed", profile, mode: "soft", requestHash: null, outputHash: null, output: null, reasonCode: null, ...extra,
});
const view = (estimates: EstimateViewV1[]): GroupViewV1 => ({
  schema: "orca-control-group-v1", epoch: "epoch-a", changeSeq: 1,
  summary: { groupId: "g", repoId: "orca", state: "draft", commandRevision: 1, projectionSeq: 1, stopMode: null, stopState: null, claimBlocked: false, recoveryBlockerCount: 0 },
  graphVersion: 1, plan: { repoId: "orca", planId: "plan-demo", planHash: "a".repeat(64), goal: "g", successConditions: [] },
  proposal: { state: "editable", proposalVersion: 1, planHash: "a".repeat(64), budgetMode: null, contextPolicy: { handoffAtContextTokens: null }, profiles: null, executionSnapshotHash: null },
  ledger: { groupLimit: amount(100), used: amount(0), committedRemaining: amount(0), explicitUnallocatedReserve: amount(100), budgetDeficit: amount(0), usageUnknown: false, unmeteredRuns: 0 },
  allocations: [], workItems: [], estimates, runs: [], checkpoints: [], handoffRequests: [], stop: null, recoveryBlockers: [], recentCommandIds: [],
});
const rows = [
  est("e1", 1, { repairs: ["duplicate-task-dropped:a"], retriedAs: "e2", retrySkipped: "proposal-changed" }),
  est("e2", 2, { origin: { kind: "auto-retry", of: "e1", problems: ["x"] } }),
];
const show = async (lang: string, estimates: EstimateViewV1[]): Promise<string> => {
  await i18n.changeLanguage(lang);
  const { container } = render(<ControlGroupView view={view(estimates)} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />);
  fireEvent.click(screen.getByRole("tab", { name: lang === "zh" ? "技术详情" : "Technical details" }));
  return container.textContent ?? "";
};

afterEach(async () => { cleanup(); await i18n.changeLanguage("en"); });

describe("an estimate's repairs and automatic retry (spec §4.4)", () => {
  it("shows them in English", async () => {
    const text = await show("en", rows);
    for (const expected of ["repaired: duplicate-task-dropped:a", "retried as v2", "retry skipped: proposal-changed", "retry of v1"]) expect(text, expected).toContain(expected);
  });
  it("shows them in Chinese", async () => {
    const text = await show("zh", rows);
    for (const expected of ["已修复", "duplicate-task-dropped:a", "已重试为第 2 版", "未重试：proposal-changed", "第 1 版的重试"]) expect(text, expected).toContain(expected);
  });
  it("shows nothing extra for an old row or an empty repairs list", async () => {
    const text = await show("en", [est("e1", 1, {}), est("e2", 2, { repairs: [] })]);
    for (const absent of ["repaired", "retry of", "retried as", "retry skipped"]) expect(text, absent).not.toContain(absent);
  });
});

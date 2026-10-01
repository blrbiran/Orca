import { describe, expect, it } from "vitest";
import { applyPanelShutdown } from "../../src/panel/controlLifecycle.js";
import { CLARIFY_JSON_SCHEMA } from "../../src/control/requirementClarify.js";
import { readRequirementGroup } from "../../src/control/requirementRecords.js";
import { groupStopState } from "../../src/control/stopIntent.js";
import { requirementHarness } from "./fixtures/requirementHarness.js";
import { ROUND_ONE } from "./fixtures/requirementOutputs.js";

// N1 spec §5.2, §6, §7 and H7: a round is one single call on the generalised chain; code retries twice, then fails it.
describe("the clarify purpose on the single-call chain (N1 spec §7)", () => {
  it("drives round 1 from its wake to awaiting-answers through one single call, the overview fenced as data", async () => {
    const x = await requirementHarness({ answers: [{ purpose: "clarify", output: ROUND_ONE }] });
    try {
      await x.until(() => x.round(1).state !== "drafting");
      expect(x.round(1)).toMatchObject({ state: "awaiting-answers", retries: 0, result: { slug: "markdown-export", questions: [{ id: "R1.Q1" }, { id: "R1.Q2", dependsOn: ["R1.Q1"] }] } });
      expect(readRequirementGroup(x.store, "r").requirement.slug).toBe("markdown-export");
      expect(x.fake.calls.accept).toHaveLength(1);
      const sent = x.fake.calls.accept[0]!;
      expect(sent).toMatchObject({ protocol: 3, inputCheckpoint: null, claim: { taskId: null, workItemId: "round-1" }, work: { kind: "single-call", responseSchema: CLARIFY_JSON_SCHEMA, maxOutputTokens: 64_000 } });
      expect(sent.work.kind === "single-call" && sent.work.prompt).toContain("<<<ORCA-DATA repository-overview ");
      expect(sent.work.kind === "single-call" && sent.work.prompt).toContain("A note-taking tool.");
      const [run] = x.runs();
      expect(run).toMatchObject({ phase: "single-call", purpose: "clarify", state: "settled-restartable", active: 0, drive: { workspacePath: null } });
      expect(x.group()).toMatchObject({ status: "clarifying", used: { tokens: 777 }, reserved: { tokens: 0 } });
      expect(x.round(1).calls).toEqual([{ runId: run.runId, overviewHash: expect.stringMatching(/^[a-f0-9]{64}$/), commit: x.head(), usage: { tokens: 777, activeMs: 5, attempts: 1, sessions: 1 }, outcome: "valid", reason: null }]);
    } finally { await x.dispose(); }
  });

  it("retries an invalid output twice, telling the model what was wrong, then fails the round as clarify-output-invalid", async () => {
    const bad = { ...ROUND_ONE, questions: [], frontierEmpty: false };
    const x = await requirementHarness({ answers: [1, 2, 3].map(() => ({ purpose: "clarify" as const, output: bad })) });
    try {
      await x.until(() => x.round(1).state === "failed");
      expect(x.round(1)).toMatchObject({ state: "failed", retries: 2, reasonCode: "clarify-output-invalid", lastInvalidReason: "frontier-not-empty-without-questions" });
      expect(x.round(1).calls.map((call) => call.outcome)).toEqual(["invalid", "invalid", "invalid"]);
      const second = x.fake.calls.accept[1]!;
      expect(second.work.kind === "single-call" && second.work.prompt).toContain("<<<ORCA-DATA retry ");
      expect(x.group()).toMatchObject({ used: { tokens: 3 * 777 }, reserved: { tokens: 0 } });
    } finally { await x.dispose(); }
  });

  it("waits with requirement-budget-exhausted while the grant does not fit, and claims once set-limit raises the limit", async () => {
    const x = await requirementHarness({ answers: [{ purpose: "clarify", output: ROUND_ONE }], limit: { tokens: 999_999, activeMs: 14_400_000, attempts: 40, sessions: 40 } });
    try {
      await x.until(() => x.round(1).waiting !== null);
      expect(x.round(1)).toMatchObject({ state: "drafting", waiting: "requirement-budget-exhausted" });
      expect(x.runs()).toEqual([]);
      expect(x.service.setLimit(x.command("set-limit", { limit: { tokens: 10_000_000, activeMs: 14_400_000, attempts: 40, sessions: 40 } }))).toMatchObject({ result: { kind: "limit-set" } });
      await x.until(() => x.round(1).state === "awaiting-answers");
      expect(x.round(1).waiting).toBeNull();
    } finally { await x.dispose(); }
  });

  it("a handoff-stop interrupts the call in flight, books its usage, returns the unused grant, and completes the stop", async () => {
    const x = await requirementHarness({ answers: [{ purpose: "clarify", output: ROUND_ONE }], stoppable: true });
    try {
      await x.until(() => x.runs()[0]?.state === "accepted" && x.fake.calls.collect > 0);
      expect(await x.service.handoffStop(x.command("handoff-stop", {}))).toMatchObject({ result: { kind: "handoff-stopped" } });
      await x.until(() => x.round(1).state === "interrupted");
      expect(x.round(1).calls).toEqual([expect.objectContaining({ outcome: "interrupted", usage: { tokens: 777, activeMs: 5, attempts: 1, sessions: 1 } })]);
      expect(x.group()).toMatchObject({ used: { tokens: 777 }, reserved: { tokens: 0 } });
      expect(groupStopState(x.store, "r")).toBe("handoff-complete");
    } finally { await x.dispose(); }
  });

  it("a panel shutdown leaves a call in flight to the driver (DR17)", async () => {
    const x = await requirementHarness({ answers: [{ purpose: "clarify", output: ROUND_ONE }], stoppable: true });
    try {
      await x.until(() => x.runs()[0]?.state === "accepted");
      const shut = await applyPanelShutdown({ store: x.store, profileRouter: x.deps.router, epoch: "epoch-1", shutdownGraceMs: 1_000, exemptDriverRuns: true });
      expect((shut.result as { groups: Array<{ groupId: string; disposition: string }> }).groups).toEqual([expect.objectContaining({ groupId: "r", disposition: "skipped-driver-owned" })]);
      expect(x.store.db.prepare("SELECT COUNT(*) AS n FROM stop_intents").get()!.n).toBe(0);
    } finally { await x.dispose(); }
  });
});

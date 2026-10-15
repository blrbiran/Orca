import { describe, expect, it, vi } from "vitest";
import { ControlError } from "../../src/control/errors.js";
import { readRequirementGroup } from "../../src/control/requirementRecords.js";
import { requirementHarness } from "./fixtures/requirementHarness.js";
import { ROUND_ONE } from "./fixtures/requirementOutputs.js";

// ccloop error codes spec (2026-10-15) §4.8, criterion 7: a call refused for its frozen output bound is not retried
// automatically (§4.5); a person's group retry recomputes that requirement's bound from the current catalog -- for the
// selection its calls run (plan correction K5) -- and if the agent cannot be asked, the retry behaves exactly as before.
const CAP_REFUSED = { purpose: "clarify" as const, output: null, outcome: "failed" as const, tokens: 0, errorCode: "omp-single-call-cap-exceeded" };

describe("a human group retry recomputes the output bound (spec A §4.8)", () => {
  it("stores the bound recomputed from the frozen selection's current cap, and the next call is sent with it", async () => {
    const x = await requirementHarness({ answers: [CAP_REFUSED, { purpose: "clarify", output: ROUND_ONE }] });
    try {
      await x.until(() => x.round(1).state === "failed");
      const asked: unknown[] = [];
      x.fake.setResolveAgent(async (partial) => { asked.push(partial); return { ...(await x.fake.baseResolveAgent(partial)), singleCallOutputCap: 100_000 }; });
      expect(await x.service.recoveryRetry(x.command("recovery-retry", { scope: "group", groupId: "r" }))).toMatchObject({ result: { kind: "recovery-observed", resolved: true } });
      expect(readRequirementGroup(x.store, "r").requirement.maxOutputTokens).toBe(100_000);
      expect(asked).toEqual([{ agent: "codex", model: "fixture-model", contextWindow: "agent-default" }]);
      await x.until(() => x.round(1).state === "awaiting-answers");
      expect(x.fake.calls.accept.map((sent) => (sent.work.kind === "single-call" ? sent.work.maxOutputTokens : null))).toEqual([64_000, 100_000]);
    } finally { await x.dispose(); }
  });

  it("with a failing probe the retry re-queues under the frozen bound and one log line names why", async () => {
    const x = await requirementHarness({ answers: [CAP_REFUSED, { purpose: "clarify", output: ROUND_ONE }] });
    const lines: string[] = [];
    const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => { lines.push(String(chunk)); return true; });
    try {
      await x.until(() => x.round(1).state === "failed");
      x.fake.setResolveAgent(async () => { throw new ControlError("control-peer-exit", "2:omp-model-catalog-unavailable: spawn ENOENT"); });
      expect(await x.service.recoveryRetry(x.command("recovery-retry", { scope: "group", groupId: "r" }))).toMatchObject({ result: { kind: "recovery-observed", resolved: true } });
      expect([readRequirementGroup(x.store, "r").requirement.maxOutputTokens, x.round(1).state]).toEqual([64_000, "drafting"]);
      expect(lines.filter((line) => line.startsWith("orca-control: recovery-retry r:"))).toEqual(["orca-control: recovery-retry r: output bound kept at 64000: omp-model-catalog-unavailable\n"]);
    } finally { spy.mockRestore(); await x.dispose(); }
  });

  it("when the requirement's profile no longer resolves the retry re-queues under the frozen bound and one log line names why", async () => {
    // §4.8's other fallback ("if the profile no longer resolves"): the router refuses the frozen profile hash with
    // profile-changed; the retry must still re-queue exactly as before rather than become a new refusal.
    const x = await requirementHarness({ answers: [CAP_REFUSED, { purpose: "clarify", output: ROUND_ONE }] });
    const lines: string[] = [];
    const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => { lines.push(String(chunk)); return true; });
    try {
      await x.until(() => x.round(1).state === "failed");
      const row = x.store.db.prepare("SELECT body FROM groups WHERE id=?").get("r") as { body: string };
      const body = JSON.parse(String(row.body)) as { requirement: { profile: { profileHash: string } } };
      body.requirement.profile.profileHash = "0".repeat(64);
      x.store.db.prepare("UPDATE groups SET body=? WHERE id=?").run(JSON.stringify(body), "r");
      expect(await x.service.recoveryRetry(x.command("recovery-retry", { scope: "group", groupId: "r" }))).toMatchObject({ result: { kind: "recovery-observed", resolved: true } });
      expect([readRequirementGroup(x.store, "r").requirement.maxOutputTokens, x.round(1).state]).toEqual([64_000, "drafting"]);
      expect(lines.filter((line) => line.startsWith("orca-control: recovery-retry r:"))).toEqual(["orca-control: recovery-retry r: output bound kept at 64000: profile-changed\n"]);
    } finally { spy.mockRestore(); await x.dispose(); }
  });
});

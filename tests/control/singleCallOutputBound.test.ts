import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ControlError } from "../../src/control/errors.js";
import { readDraft } from "../../src/control/requirementRecords.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { estimateHarness } from "./fixtures/estimateHarness.js";
import { requirementHarness } from "./fixtures/requirementHarness.js";
import { VALID_SPLIT } from "./fixtures/requirementOutputs.js";

// Spec 2026-10-15 §6.2, criterion 5 (R2): a single call is booked at its observed usage; its run view carries the bound it
// was sent with (64000 here: the fixture profile's estimatorPreflight.maxOutputTokens, no agent cap) and, when the observed
// output (sum of byModel[].output) is over it, by how much. Computed at read time from the stored usage event: no schema
// change. The event's tokens are input 100 + output, so it reconciles with its byModel; 100 + 64_100 = 64_200 is under
// ESTIMATE_GRANT.tokens (250_000), so the settlement books it as observed.
type Harness = Awaited<ReturnType<typeof estimateHarness>>;
const run = async (output: number, after?: (x: Harness) => void) => {
  const x = await estimateHarness({ tokens: 100 + output, byModel: [{ model: "gpt-6-sol", input: 100, output, cacheRead: 0, cacheWrite: 0 }] });
  try {
    await x.rounds(() => x.estimate().state !== "running");
    after?.(x);
    return readControlGroup(x.h.store, "epoch", "g").runs.find((view) => view.runId === x.runId)!;
  } finally { await x.h.dispose(); }
};

describe("output bound on a single call's run view (spec §6.2)", () => {
  it("over the bound: booked as observed, overrun shown", async () => {
    expect(await run(64_100)).toMatchObject({ outputBound: 64000, outputBoundExceededBy: 100, used: { tokens: 64_200 } });
  });
  it("at the bound and under it: no overrun", async () => {
    const at = await run(64_000), under = await run(10);
    expect([at.outputBound, Object.hasOwn(at, "outputBoundExceededBy"), under.outputBound, Object.hasOwn(under, "outputBoundExceededBy")]).toEqual([64000, false, 64000, false]);
  });

  // Task 12 review fix 2: byModel is cumulative, so the newest work event decides. A later event with no breakdown (as a
  // ccloop that stops reporting one would send; booked unattributed) leaves no observed output -- the older event's
  // over-bound breakdown is not reused. The second event is written straight into usage_events, the table the view reads.
  it("the newest work event decides: a later event without byModel shows no overrun", async () => {
    const view = await run(64_100, (x) => {
      const first = JSON.parse(String(x.h.store.db.prepare("SELECT body FROM usage_events WHERE run_id=? AND seq=1").get(x.runId)!.body));
      const body = JSON.stringify({ ...first, eventSeq: 2, cumulative: { ...first.cumulative, tokens: 64_300 }, byModel: null });
      x.h.store.db.prepare("INSERT INTO usage_events(run_id,seq,payload_hash,body) VALUES (?,2,?,?)").run(x.runId, createHash("sha256").update(body).digest("hex"), body);
    });
    expect([view.outputBound, Object.hasOwn(view, "outputBoundExceededBy")]).toEqual([64000, false]);
  });

  // Task 12 review fix 1 (Rule 12): every dispatched estimate run has a contract; one that cannot be read is missing evidence,
  // and the group read refuses naming the run -- it does not silently drop the overrun.
  it("an estimate run whose contract is missing refuses the group read", async () => {
    let runId = "";
    const refusal = await run(64_100, (x) => {
      runId = x.runId;
      x.h.store.db.prepare("DELETE FROM outbox WHERE id=?").run(`estimate-contract:g:${x.h.estimateId}`);
    }).then(() => null, (error: unknown) => error);
    expect(refusal instanceof ControlError ? [refusal.code, refusal.detail] : refusal).toEqual(["recovery-blocked", `run-estimate-contract:${runId}`]);
  });

  // Plan issue 11: a requirement's single call (here the split call, whose group is then accepted into a plan group so the
  // group view lists it) carries the requirement's frozen bound (64000: requirementHarness's maxOutputTokens). Its usage
  // event has no byModel, so there is no observed output to compare and no overrun.
  it("a requirement's single call carries the requirement's bound", async () => {
    const x = await requirementHarness({ answers: [{ purpose: "split", output: VALID_SPLIT }], startAt: "split" });
    try {
      await x.until(() => readDraft(x.store, "r", 1).state === "awaiting-review");
      await x.service.acceptRequirementDraft(x.command("requirement-draft-accept", { draftNo: 1, draftHash: readDraft(x.store, "r", 1).draftHash! }));
      const calls = readControlGroup(x.store, "epoch", "r").runs.filter((view) => view.phase === "single-call");
      expect(calls.map((view) => [view.outputBound, Object.hasOwn(view, "outputBoundExceededBy")])).toEqual([[64000, false]]);
    } finally { await x.dispose(); }
  });
});

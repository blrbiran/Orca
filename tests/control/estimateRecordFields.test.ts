import { describe, expect, it } from "vitest";
import { canonicalBytes } from "../../src/control/canonicalJson.js";
import { readEstimateRecord } from "../../src/control/queries.js";
import { readEstimateContract } from "../../src/control/estimator.js";
import { WebControlService } from "../../src/control/webService.js";
import { estimateExecutionContractSchema, estimateViewSchema } from "../../src/control/webProtocol.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { webFixture } from "./fixtures/web.js";

/**
 * Estimate-usable-answer spec §4.3/§4.4: the record, contract and view learn five optional fields, written only when
 * they apply. A row written before the change must still decode (canonical bytes unchanged) and show none of them.
 */
const FIELDS = ["proposalVersion", "repairs", "origin", "retriedAs", "retrySkipped"] as const;
const rewrite = (h: Awaited<ReturnType<typeof webFixture>>, edit: (body: Record<string, unknown>) => void) => {
  const row = h.store.db.prepare("SELECT body FROM estimates WHERE group_id=? AND id=?").get("g", h.estimateId)!;
  const body = JSON.parse(String(row.body)) as Record<string, unknown>;
  edit(body);
  h.store.db.prepare("UPDATE estimates SET body=? WHERE group_id=? AND id=?").run(canonicalBytes(body).toString("utf8"), "g", h.estimateId);
};
const viewOf = (h: Awaited<ReturnType<typeof webFixture>>) => readControlGroup(h.store, "epoch", "g").estimates.find((e) => e.estimateId === h.estimateId)!;

describe("estimate record, contract and view fields", () => {
  it("decodes a record written before the change and its view carries none of the new fields", async () => {
    const h = await webFixture(undefined, [{ taskId: "a" }]);
    try {
      rewrite(h, (body) => { for (const key of FIELDS) delete body[key]; });
      const record = readEstimateRecord(h.store, "g", h.estimateId);
      const view = viewOf(h);
      for (const key of FIELDS) { expect(record).not.toHaveProperty(key); expect(view).not.toHaveProperty(key); }
    } finally { await h.dispose(); }
  });

  it("decodes a record carrying all five fields and passes them to the view", async () => {
    const h = await webFixture(undefined, [{ taskId: "a" }]);
    try {
      const origin = { kind: "auto-retry", of: "estimate-failed", problems: ["task-missing:a"] };
      rewrite(h, (body) => Object.assign(body, { proposalVersion: 1, repairs: [], origin, retriedAs: "estimate-next", retrySkipped: "budget-deficit" }));
      expect(readEstimateRecord(h.store, "g", h.estimateId)).toMatchObject({ proposalVersion: 1, repairs: [], origin, retriedAs: "estimate-next", retrySkipped: "budget-deficit" });
      expect(viewOf(h)).toMatchObject({ proposalVersion: 1, repairs: [], origin, retriedAs: "estimate-next", retrySkipped: "budget-deficit" });
      expect(estimateViewSchema.safeParse(viewOf(h)).success).toBe(true);
    } finally { await h.dispose(); }
  });

  it("refuses a record with an empty origin.problems list", async () => {
    const h = await webFixture(undefined, [{ taskId: "a" }]);
    try {
      rewrite(h, (body) => { body.origin = { kind: "auto-retry", of: "estimate-failed", problems: [] }; });
      expect(() => readEstimateRecord(h.store, "g", h.estimateId)).toThrow();
    } finally { await h.dispose(); }
  });

  it("stamps proposalVersion 1 on a fresh import's estimate and 2 on a re-estimate after one proposal edit", async () => {
    const h = await webFixture(undefined, [{ taskId: "a" }]);
    try {
      expect(readEstimateRecord(h.store, "g", h.estimateId).proposalVersion).toBe(1);
      expect(viewOf(h).proposalVersion).toBe(1);
      const service = new WebControlService(h.deps);
      const edited = await service.proposalSetAgent(h.command("proposal-set-agent", { baseProposalVersion: 1, scope: { kind: "group", slot: "estimator" }, partial: { model: "panel-estimator" } }));
      expect(edited).toMatchObject({ result: { kind: "proposal-edited", proposalVersion: 2 } });
      const created = await service.createEstimate(h.command("estimate", { proposalVersion: 2, estimatorProfileId: "all", estimatorProfileHash: h.frozen.profileHash, estimateMode: "soft" }));
      if ("error" in created || created.result.kind !== "estimate-created") throw new Error(JSON.stringify(created));
      expect(readEstimateRecord(h.store, "g", created.result.estimateId).proposalVersion).toBe(2);
    } finally { await h.dispose(); }
  });

  it("accepts a contract with retryProblems and refuses an empty list or more than 20", async () => {
    const h = await webFixture(undefined, [{ taskId: "a" }]);
    try {
      const contract = readEstimateContract(h.store, "g", h.estimateId);
      expect(contract).not.toHaveProperty("retryProblems");
      expect(estimateExecutionContractSchema.safeParse({ ...contract, retryProblems: ["no-json-object"] }).success).toBe(true);
      expect(estimateExecutionContractSchema.safeParse({ ...contract, retryProblems: [] }).success).toBe(false);
      expect(estimateExecutionContractSchema.safeParse({ ...contract, retryProblems: Array.from({ length: 21 }, (_, i) => `p${i}`) }).success).toBe(false);
    } finally { await h.dispose(); }
  });
});

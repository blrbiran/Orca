// Checks spec 2026-10-22 §6.5 / §7 (plan Task 9's read route, `orca check findings`): a model review's record -- range,
// groups, valid findings, dropped findings with reasons, routing -- read by the review group's id. Only that record is
// served: another canonical record of the same group (a frozen document, a snapshot) is not a review's record.
import { afterAll, describe, expect, it } from "vitest";
import { canonicalBytes, sha256Canonical } from "../../src/control/canonicalJson.js";
import { flagDecision, ratifyFlag } from "../../src/control/flaggedDecisions.js";
import { writeCanonicalRecord } from "../../src/control/snapshot.js";
import { command, createHarness, get, GROUP, json } from "./fixtures/controlPanel.js";

const h = createHarness();
afterAll(() => h.dispose());

const put = (store: Parameters<typeof writeCanonicalRecord>[0], record: Record<string, unknown>) =>
  store.transaction(() => writeCanonicalRecord(store, GROUP, sha256Canonical(record), canonicalBytes(record).toString("utf8")));

describe("GET /api/control/checks/reviews/:reviewGroupId", () => {
  it("answers the review's record; a group without one, or an unknown group, is 404", async () => {
    const panel = await h.boot("reviews-epoch", await h.workspace());
    await command(panel, "/api/control/groups/import-plan", { commandId: "import", expectedRevision: 0, payload: { groupId: GROUP, repoId: "repo", planId: "plan" } });
    put(panel.store, { schema: "orca-requirement-document-v1", text: "not a review" });
    const none = await get(panel, `/api/control/checks/reviews/${GROUP}`);
    expect([none.status, ((await json(none)) as { error: { code: string } }).error.code]).toEqual([404, "group-not-found"]);

    const record = { schema: "orca-model-review-record-v1", reviewGroupId: GROUP, runId: "run-1", range: { target: "main", from: "a", to: "b" }, groups: ["g1", "g2"], valid: [], dropped: [{ findingId: "f1", reason: "one-sided" }], routed: [] };
    put(panel.store, record);
    const found = await get(panel, `/api/control/checks/reviews/${GROUP}`);
    expect(found.status).toBe(200);
    // Spec §6.5, §7: the dismissals (ratified findings with the person's note) are served with the record, so the
    // detail view and later learning read one place. None yet.
    expect(await json(found)).toEqual({ ...record, dismissals: [] });
    panel.store.transaction(() => {
      for (const id of ["f2", "f3"]) flagDecision(panel.store, { decisionId: `model-review:${GROUP}:${id}`, groupId: GROUP, runId: null, source: "model-review", reason: `duplication: ${id}`, evidence: [], by: "orca-auto", at: "t0", severity: "minor", involvedGroupIds: ["g1", "g2"] });
      ratifyFlag(panel.store, GROUP, `model-review:${GROUP}:f2`, { actorId: "owner", commandId: "c-1", at: "t1", note: "intended: two stores on purpose" });
    });
    // mutation: list every flag of the review group (drop the ratified filter) -> f3 listed too, red
    expect(((await json(await get(panel, `/api/control/checks/reviews/${GROUP}`))) as { dismissals: unknown }).dismissals)
      .toEqual([{ decisionId: `model-review:${GROUP}:f2`, by: "owner", at: "t1", note: "intended: two stores on purpose" }]);

    const unknown = await get(panel, "/api/control/checks/reviews/sysreview-nope");
    expect([unknown.status, ((await json(unknown)) as { error: { code: string } }).error.code]).toEqual([404, "group-not-found"]);
    expect((await get(panel, `/api/control/checks/reviews/${GROUP}`, "none")).status).toBe(401);
  });
});

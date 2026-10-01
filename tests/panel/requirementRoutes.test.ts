/**
 * N1 spec §11.1 (Task 9): the four requirement routes reach their verbs over a real Panel -- open names its group in the
 * payload, the other three take it from the path -- and each answer is the ledger's booked result.
 */
import { afterAll, describe, expect, it } from "vitest";
import { commandSuccessSchema } from "../../src/control/webProtocol.js";
import { command, createHarness } from "./fixtures/controlPanel.js";

const h = createHarness();
afterAll(async () => {
  await h.dispose();
});

describe("requirement routes (N1 spec §11.1)", () => {
  it("opens a requirement and routes answer, consensus and feedback to their verbs", async () => {
    const panel = await h.boot("epoch-requirement", await h.workspace());
    const opened = await command(panel, "/api/control/requirements", {
      commandId: "open-n", expectedRevision: 0, payload: { groupId: "n", repoId: "repo", idea: "Let people export their notes as Markdown." },
    });
    expect(opened.status).toBe(201);
    expect(commandSuccessSchema.parse(opened.body)).toMatchObject({ verb: "requirement-open", target: { kind: "group", groupId: "n" }, result: { kind: "requirement-opened", groupId: "n", roundNo: 1 } });
    // Round 1 is still drafting, so each of the three is refused by its own verb's rule, booked under the group.
    // The group view of a clarifying group is Task 12's; the revision is read from the store.
    const at = Number(panel.store.db.prepare("SELECT revision FROM groups WHERE id='n'").get()!.revision);
    for (const [path, verb, payload] of [
      ["answer", "requirement-answer", { roundNo: 1, answers: [], glossaryDecisions: [], adrDecisions: [] }],
      ["consensus", "requirement-consensus", { roundNo: 1 }],
      ["feedback", "requirement-draft-feedback", { draftNo: 1, feedback: "Merge them." }],
    ] as const) {
      const refused = await command(panel, `/api/control/groups/n/requirement/${path}`, { commandId: `${path}-n`, expectedRevision: at, payload });
      expect([path, refused.status, refused.body]).toMatchObject([path, 422, { error: { code: "group-state-invalid" } }]);
      expect(panel.store.db.prepare("SELECT verb FROM commands WHERE group_id='n' AND id=?").get(`${path}-n`)).toEqual({ verb });
    }
  });
});

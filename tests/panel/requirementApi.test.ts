import { createServer } from "node:http";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import express from "express";
import { describe, expect, it } from "vitest";
import { exportPendingRequirements } from "../../src/control/requirementExport.js";
import { readDraft } from "../../src/control/requirementRecords.js";
import { registerControlReadRoutes } from "../../src/panel/controlApi.js";
import { readControlGroup, readRequirementView } from "../../src/panel/controlViews.js";
import { requirementHarness } from "../control/fixtures/requirementHarness.js";
import { ROUND_ONE, VALID_SPLIT } from "../control/fixtures/requirementOutputs.js";

type Harness = Awaited<ReturnType<typeof requirementHarness>>;

/** Task 10's path to an accepted requirement: draft 1 split, then accepted at its hash. */
async function accepted(): Promise<Harness> {
  const x = await requirementHarness({ answers: [{ purpose: "split", output: VALID_SPLIT }], startAt: "split" });
  await x.until(() => readDraft(x.store, "r", 1).state === "awaiting-review");
  await x.service.acceptRequirementDraft(x.command("requirement-draft-accept", { draftNo: 1, draftHash: readDraft(x.store, "r", 1).draftHash! }));
  return x;
}

// N1 spec §11.2: details come from GET /api/control/groups/:id/requirement; the summary line rides the changeSeq pull.
describe("the requirement view (N1 spec §11.2)", () => {
  it("shows the rounds, the ledger, the summary line and the live document of a clarifying group", async () => {
    const x = await requirementHarness({ answers: [{ purpose: "clarify", output: ROUND_ONE }] });
    try {
      await x.until(() => x.round(1).state === "awaiting-answers");
      const view = readRequirementView(x.store, "epoch", "r");
      expect(view).toMatchObject({ schema: "orca-requirement-view-v1", summary: { state: "clarifying", requirement: { roundNo: 1, roundState: "awaiting-answers", openQuestions: 2 } },
        requirement: { slug: "markdown-export", consensus: null, document: null, export: { state: "not-due" } }, ledger: { used: { tokens: 777 }, reserved: { tokens: 0 } } });
      expect(view.rounds).toHaveLength(1);
      expect(view.document).toContain("# markdown-export");
    } finally { await x.dispose(); }
  });

  it("drops the stored plan from drafts, serves the frozen text after accept, and renders the accepted group's requirement runs", async () => {
    const x = await requirementHarness({ answers: [{ purpose: "split", output: VALID_SPLIT }], startAt: "split" });
    try {
      await x.until(() => readDraft(x.store, "r", 1).state === "awaiting-review");
      expect(readRequirementView(x.store, "epoch", "r").drafts[0]).not.toHaveProperty("plan");
      await x.service.acceptRequirementDraft(x.command("requirement-draft-accept", { draftNo: 1, draftHash: readDraft(x.store, "r", 1).draftHash! }));
      const view = readRequirementView(x.store, "epoch", "r");
      expect(view.requirement.document).toMatchObject({ sha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
      expect(view.document).toContain("## Split");
      const group = readControlGroup(x.store, "epoch", "r");
      expect(group.runs.filter((run) => run.phase === "single-call")).toEqual([expect.objectContaining({ purpose: "split", state: "settled-restartable", taskId: null, estimateId: null })]);
    } finally { await x.dispose(); }
  });

  it("refuses a group that never was a requirement", async () => {
    const x = await requirementHarness({ answers: [], startAt: "none" });
    try {
      x.store.db.prepare("INSERT INTO groups(id,revision,graph_version,projection_seq,body) VALUES ('plain',0,1,0,'{\"groupId\":\"plain\"}')").run();
      expect(() => readRequirementView(x.store, "epoch", "plain")).toThrow("group-state-invalid");
      expect(() => readRequirementView(x.store, "epoch", "absent")).toThrow("group-not-found");
    } finally { await x.dispose(); }
  });

  // Task 11 ruling: a path-blocked export reuses state "conflict"; the view tells the two apart by the summary's
  // reasonCode and keeps the export's own detail beside it.
  for (const [blocker, reasonCode] of [["path", "requirement-export-path-blocked"], ["branch", "requirement-export-conflict"]] as const) {
    it(`carries a blocked export's state, detail and reasonCode (${blocker})`, async () => {
      const x = await accepted();
      try {
        if (blocker === "path") {
          await writeFile(join(x.repo, ".orca"), "a file\n");
          x.git("add", "-A"); x.git("commit", "-qm", "a .orca file");
        } else x.git("branch", "orca/r");
        expect(await exportPendingRequirements({ store: x.store, resolveRepository: () => x.repo })).toBe(true);
        const view = readRequirementView(x.store, "epoch", "r");
        expect(view.requirement.export).toMatchObject({ state: "conflict", detail: expect.stringMatching(new RegExp(`^${reasonCode}:`)) });
        expect(view.summary.requirement).toMatchObject({ exportState: "conflict", reasonCode });
      } finally { await x.dispose(); }
    });
  }
});

// N1 DR26: a clarify or split run in the group view is held to the requirement's frozen profile and agent.
describe("a requirement's runs in the group view (N1 DR26)", () => {
  const tamper = (x: Harness, edit: (run: Record<string, unknown>) => void) => {
    const row = x.store.db.prepare("SELECT id,body FROM runs WHERE group_id='r' AND work_item_id='draft-1'").get()!;
    const run = JSON.parse(String(row.body)) as Record<string, unknown>;
    edit(run);
    x.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify(run), String(row.id));
    return String(row.id);
  };

  it("refuses a single-call run that names no purpose", async () => {
    const x = await accepted();
    try {
      const runId = tamper(x, (run) => { delete run.purpose; });
      expect(() => readControlGroup(x.store, "epoch", "r")).toThrow(`run-requirement-identity:${runId}`);
    } finally { await x.dispose(); }
  });

  it("refuses a single-call run whose agent is not the requirement's frozen agent", async () => {
    const x = await accepted();
    try {
      const runId = tamper(x, (run) => { run.agent = { ...(run.agent as Record<string, unknown>), model: "another-model" }; });
      expect(() => readControlGroup(x.store, "epoch", "r")).toThrow(`run-requirement-agent:${runId}`);
    } finally { await x.dispose(); }
  });
});

describe("GET /api/control/groups/:groupId/requirement (N1 spec §11.2, DR25)", () => {
  it("answers the requirement view, while the group view of a clarifying group is refused", async () => {
    const x = await requirementHarness({ answers: [{ purpose: "clarify", output: ROUND_ONE }] });
    const app = express();
    app.use(express.json());
    registerControlReadRoutes(app, { store: x.store, epoch: "epoch", config: { readView: async () => ({}) } as never });
    const server = createServer(app);
    try {
      await x.until(() => x.round(1).state === "awaiting-answers");
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("address");
      const get = async (path: string) => {
        const response = await fetch(`http://127.0.0.1:${address.port}${path}`);
        return { status: response.status, body: await response.json() as Record<string, unknown> };
      };
      expect(await get("/api/control/groups/r/requirement")).toMatchObject({ status: 200, body: { schema: "orca-requirement-view-v1" } });
      expect(await get("/api/control/groups/r")).toMatchObject({ status: 422, body: { error: { code: "requirement-not-split" } } });
      expect(await get("/api/control/groups/absent/requirement")).toMatchObject({ status: 404, body: { error: { code: "group-not-found" } } });
    } finally {
      if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
      await x.dispose();
    }
  });
});

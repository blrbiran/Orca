import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { withCommandContext } from "../../src/control/commandClient.js";
import { ControlError } from "../../src/control/errors.js";
import { applyPlanLibraryCommand, type PlanLibraryCommand } from "../../src/control/planLibrary/commands.js";
import { importControlPlanAsync, type ImportCommand } from "../../src/control/planImport.js";
import { readDraft } from "../../src/control/requirementRecords.js";
import { REQUIREMENT_LIMIT_DEFAULT } from "../../src/control/requirementSchemas.js";
import type { ControlStore } from "../../src/control/store.js";
import { commandSuccessSchema } from "../../src/control/webProtocol.js";
import { profileSnapshot, webFixture } from "./fixtures/web.js";
import { requirementHarness } from "./fixtures/requirementHarness.js";
import { VALID_SPLIT } from "./fixtures/requirementOutputs.js";

/**
 * Session 3cfc2e73 D3 (spec 2026-11-05 §3.3, §4 criteria 14-15): a group with no token limit is imported -- by
 * import-plan, a schedule's fire, or a requirement's accept -- with no automatic estimate (the deferred path); its result
 * says so with `estimateId: null, estimateState: "none"`, which the strict result schema accepts. A limited group keeps
 * its import-time estimate.
 */
const estimates = (store: ControlStore, groupId: string) => Number(store.db.prepare("SELECT COUNT(*) AS n FROM estimates WHERE group_id=?").get(groupId)!.n);
const estimateWakes = (store: ControlStore, groupId: string) => Number(store.db.prepare("SELECT COUNT(*) AS n FROM scheduler_wakes WHERE group_id=? AND kind='budget-estimate'").get(groupId)!.n);
type Answer = { result?: { kind: string; estimateId?: string | null; estimateState?: string; entryId?: string; sha256?: string }; error?: { code: string } };
const PERSON = { client: "web", principal: "web", attribution: { by: "ana", via: "web" } };

/** The fixture's group g saved to the plan library, and import-plan from that entry (the path a schedule's fire takes). */
async function libraryWorld() {
  const f = await webFixture(profileSnapshot(), [{ taskId: "a" }], { tokenPolicy: "optional-v1" });
  const repo = join(f.root, "repo");
  const deps = { store: f.store, resolveRepository: (repoId: string) => { if (repoId !== "repo") throw new ControlError("control-target-not-allowed"); return repo; } };
  const saved = withCommandContext("save-1", PERSON, () => applyPlanLibraryCommand(deps, { schema: "orca-raw-command-v1", commandId: "save-1", actorId: "human", expectedRevision: 0,
    verb: "plan-library-save", target: { kind: "plan-library" }, payload: { source: { kind: "group", groupId: "g" }, name: "weekly" } } as PlanLibraryCommand)) as Answer;
  const libraryEntry = { entryId: saved.result!.entryId!, sha256: saved.result!.sha256! };
  const importFrom = (groupId: string, extra: Record<string, unknown>, opts: Parameters<typeof importControlPlanAsync>[2] = {}) =>
    importControlPlanAsync({ ...f.deps, resolveRepository: deps.resolveRepository } as never, {
      schema: "orca-raw-command-v1", commandId: `import-${groupId}`, actorId: "human", expectedRevision: 0, verb: "import-plan",
      target: { kind: "group", groupId }, payload: { groupId, repoId: "repo", libraryEntry, ...extra },
    } as ImportCommand, opts) as Promise<Answer>;
  return { f, importFrom };
}
const parses = (answer: unknown) => commandSuccessSchema.safeParse(answer).success;

describe("criterion 14: import-plan", () => {
  it("importing into an unlimited group queues no estimate and the result parses with estimateId null, estimateState none", async () => {
    const w = await libraryWorld(); try {
      // The fixture's own planId import (no token limit) already went this way.
      expect(w.f.imported).toMatchObject({ result: { kind: "imported", estimateId: null, estimateState: "none" } });
      expect(estimates(w.f.store, "g")).toBe(0);
      const answer = await w.importFrom("g2", {});
      expect(answer.result).toMatchObject({ kind: "imported", estimateId: null, estimateState: "none" });
      expect(parses(answer)).toBe(true);
      expect(estimates(w.f.store, "g2")).toBe(0);
      expect(estimateWakes(w.f.store, "g2")).toBe(0);
    } finally { await w.f.dispose(); }
  });

  it("a limited group still gets one", async () => {
    const w = await libraryWorld(); try {
      const answer = await w.importFrom("g3", { tokenLimit: 50_000_000 });
      expect(answer.result).toMatchObject({ kind: "imported", estimateState: "queued" });
      expect(typeof answer.result!.estimateId).toBe("string");
      expect(parses(answer)).toBe(true);
      expect(estimates(w.f.store, "g3")).toBe(1);
      expect(estimateWakes(w.f.store, "g3")).toBe(1);
    } finally { await w.f.dispose(); }
  });
});

describe("criterion 15: requirement-accept and a schedule's fire", () => {
  it("a schedule-fired unlimited import queues none; a limited one does", async () => {
    const w = await libraryWorld(); try {
      const origin = { origin: { kind: "schedule" as const, scheduleId: "sch-x", slot: 1234 } };
      expect((await w.importFrom("s1", {}, origin)).result).toMatchObject({ estimateId: null, estimateState: "none" });
      expect(estimates(w.f.store, "s1")).toBe(0);
      expect((await w.importFrom("s2", { tokenLimit: 50_000_000 }, origin)).result).toMatchObject({ estimateState: "queued" });
      expect(estimates(w.f.store, "s2")).toBe(1);
    } finally { await w.f.dispose(); }
  });

  for (const [name, tokens, expected] of [["an unlimited requirement's accept queues none", null, 0], ["a limited requirement's accept still queues one", 10_000_000, 1]] as const) {
    it(name, async () => {
      const x = await requirementHarness({ answers: [{ purpose: "split", output: VALID_SPLIT }], startAt: "split", limit: { ...REQUIREMENT_LIMIT_DEFAULT, tokens } as never });
      try {
        await x.until(() => readDraft(x.store, "r", 1).state === "awaiting-review");
        // The harness seeds the historical finite-legacy authority; a requirement opened today carries an optional policy.
        x.store.db.prepare("UPDATE token_policies SET mode='optional-v1' WHERE group_id='r'").run();
        const answer = await x.service.acceptRequirementDraft(x.command("requirement-draft-accept", { draftNo: 1, draftHash: readDraft(x.store, "r", 1).draftHash! }));
        expect(parses(answer)).toBe(true);
        expect((answer as Answer).result).toMatchObject(expected === 0 ? { kind: "requirement-draft-accepted", estimateId: null, estimateState: "none" } : { kind: "requirement-draft-accepted", estimateState: "queued" });
        expect(estimates(x.store, "r")).toBe(expected);
      } finally { await x.dispose(); }
    });
  }
});

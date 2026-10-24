// Scheduled flows and groups spec 2026-10-24 §5 (plan Tasks 2-3), criteria C8 and C10 (version rows): the `orca-plan-v1`
// codec, the library's single writer, and (Task 3) its verbs and `import-plan` from a library entry. Temp stores only
// (Rule 17): every store is the fixtures' mkdtemp store.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { canonicalBytes, sha256Canonical } from "../../src/control/canonicalJson.js";
import { ControlError } from "../../src/control/errors.js";
import { canonicalPlanDoc, PLAN_DOC_MAX_BYTES } from "../../src/control/planLibrary/codec.js";
import { appendVersion, archiveEntry, insertEntry, listEntries, listVersions, pinningSchedules, readVersion } from "../../src/control/planLibrary/store.js";
import { openControlStore, type ControlStore } from "../../src/control/store.js";

const REPO = "/repos/proj";
const contract = (taskId: string) => ({
  objective: { taskId, goal: "ship", successCondition: "passes", nonGoals: [] },
  context: { repoPath: REPO, targetPaths: [taskId], relevantDocs: [], buildTestCommands: ["true"], constraints: [] },
  executionPolicy: { autonomyLevel: "L2", maxAttempts: 9, perAttemptTimeoutMs: 60_000, totalRuntimeBudgetMs: 90_000, tokenBudget: 99_000, worktreeRequired: true, partialOutcomeRecoveryWindowMs: 30_000 },
  safetyPolicy: { allowlistPaths: [], denylistPaths: [], maxFilesTouched: 1, humanGateConditions: [] },
  verification: { verifierType: "command", requiredChecks: ["true"], rejectOn: ["failure"], evidenceRequired: [] },
  escalationAndExit: { escalationTargets: [], pauseOn: [], stopOn: [], terminalStates: ["succeeded", "blocked_waiting_human", "exhausted", "cancelled", "failed"] },
});
const doc = (tasks: Array<Record<string, unknown>> = [{ taskId: "a", dependsOn: [], targetVersion: 1, contract: contract("a") }]) =>
  ({ schema: "orca-plan-v1", goal: "ship", successConditions: ["passes"], tasks });

const refusal = (fn: () => unknown): { code: string; detail: string | undefined } => {
  try { fn(); } catch (error) { if (error instanceof ControlError) return { code: error.code, detail: error.detail }; throw error; }
  throw new Error("not refused");
};

const roots: string[] = [];
afterEach(async () => { while (roots.length) await rm(roots.pop()!, { recursive: true, force: true }); });
async function store(): Promise<ControlStore> {
  const root = await mkdtemp(join(tmpdir(), "planlib-"));
  roots.push(root);
  return openControlStore({ stateDir: join(root, "s") });
}

describe("orca-plan-v1 codec (§5.2, C8)", () => {
  it("accepts a contract task and a loop task, and names the bytes by their sha256", () => {
    const loop = { schema: "orca-loop-recipe-v1", planId: "standard", planVersion: 3, chosenBy: "explicit",
      inputs: { goal: "g", successCondition: "s", targetPaths: ["src/**"], checks: ["true"], nonGoals: [], relevantDocs: [], protectedPaths: [], maxFilesTouched: null } };
    const out = canonicalPlanDoc(doc([{ taskId: "a", dependsOn: [], targetVersion: 1, contract: contract("a") }, { taskId: "b", dependsOn: ["a"], targetVersion: 1, loop }]), REPO);
    expect(out.sha256).toBe(sha256Canonical(out.doc));
    expect(out.bytes).toBe(canonicalBytes(out.doc).toString("utf8"));
    expect(out.source.tasks.map((t) => t.taskId)).toEqual(["a", "b"]);
    expect(out.source.tasks[1]!.loop?.planId).toBe("standard");
  });

  it.each([
    ["an unknown key", { ...doc(), extra: 1 }, "malformed:"],
    ["an unknown task key", doc([{ taskId: "a", dependsOn: [], targetVersion: 1, contract: contract("a"), path: "/x" }]), "malformed:"],
    ["both contract and loop missing", doc([{ taskId: "a", dependsOn: [], targetVersion: 1 }]), "malformed:"],
    ["a dangling dependency", doc([{ taskId: "a", dependsOn: ["zz"], targetVersion: 1, contract: contract("a") }]), "dangling-dependency:a"],
    ["a cycle", doc([{ taskId: "a", dependsOn: ["b"], targetVersion: 1, contract: contract("a") }, { taskId: "b", dependsOn: ["a"], targetVersion: 1, contract: contract("b") }]), "graph-cycle"],
    ["a contract whose objective.taskId differs", doc([{ taskId: "a", dependsOn: [], targetVersion: 1, contract: contract("other") }]), "contract-shape:a"],
    ["a contract that is not a task contract", doc([{ taskId: "a", dependsOn: [], targetVersion: 1, contract: { objective: {} } }]), "contract-shape:a"],
  ])("refuses %s (control-plan-rejected, today's item)", (_name, raw, item) => {
    const refused = refusal(() => canonicalPlanDoc(raw, REPO));
    expect(refused.code).toBe("control-plan-rejected");
    expect(refused.detail).toContain(item);
  });

  it("refuses a document over 2 MiB canonical (plan-library-doc-too-large)", () => {
    const big = { ...contract("a"), context: { ...contract("a").context, constraints: ["x".repeat(PLAN_DOC_MAX_BYTES)] } };
    expect(refusal(() => canonicalPlanDoc(doc([{ taskId: "a", dependsOn: [], targetVersion: 1, contract: big }]), REPO)).code).toBe("plan-library-doc-too-large");
  });
});

describe("the library's single writer (§5.6, C8, C10 version rows)", () => {
  const ORIGIN = { kind: "import" as const, fileName: "p.json", fileSha256: "f".repeat(64), format: "orca-plan-v1" as const };

  it("appending version 2 leaves version 1 byte-identical; the same bytes again are that version, not a new one", async () => {
    const s = await store();
    try {
      const one = canonicalPlanDoc(doc(), REPO), two = canonicalPlanDoc({ ...doc(), goal: "ship more" }, REPO);
      s.transaction(() => insertEntry(s, { id: "pl-1", projectId: "repo", name: "p", by: "ana", via: "web", at: 1 }));
      expect(s.transaction(() => appendVersion(s, { entryId: "pl-1", doc: one.bytes, origin: ORIGIN, by: "ana", via: "web", at: 1 }))).toEqual({ version: 1, sha256: one.sha256, appended: true });
      const before = s.db.prepare("SELECT * FROM plan_library_versions WHERE entry_id='pl-1' AND version=1").get();
      expect(s.transaction(() => appendVersion(s, { entryId: "pl-1", doc: two.bytes, origin: ORIGIN, by: "bo", via: "cli:claude", at: 2 }))).toEqual({ version: 2, sha256: two.sha256, appended: true });
      expect(s.db.prepare("SELECT * FROM plan_library_versions WHERE entry_id='pl-1' AND version=1").get()).toEqual(before);
      expect(s.transaction(() => appendVersion(s, { entryId: "pl-1", doc: one.bytes, origin: ORIGIN, by: "bo", via: "web", at: 3 }))).toEqual({ version: 1, sha256: one.sha256, appended: false });
      expect(listVersions(s, "pl-1").map((v) => [v.version, v.sha256, v.by, v.via, v.at])).toEqual([[1, one.sha256, "ana", "web", 1], [2, two.sha256, "bo", "cli:claude", 2]]);
      expect(readVersion(s, "pl-1", one.sha256)!.doc).toBe(one.bytes);
    } finally { s.close(); }
  });

  it("a version whose stored bytes no longer hash to its sha256 is refused on read (plan-library-hash-mismatch)", async () => {
    const s = await store();
    try {
      const one = canonicalPlanDoc(doc(), REPO);
      s.transaction(() => { insertEntry(s, { id: "pl-1", projectId: "repo", name: "p", by: "ana", via: "web", at: 1 }); appendVersion(s, { entryId: "pl-1", doc: one.bytes, origin: ORIGIN, by: "ana", via: "web", at: 1 }); });
      s.db.prepare("UPDATE plan_library_versions SET doc=? WHERE entry_id='pl-1'").run(one.bytes.replace("ship", "sh1p"));
      expect(refusal(() => readVersion(s, "pl-1", one.sha256)).code).toBe("plan-library-hash-mismatch");
    } finally { s.close(); }
  });

  it("archive is refused while a schedule (enabled or not) pins the entry, and allowed once it is removed", async () => {
    const s = await store();
    try {
      s.transaction(() => insertEntry(s, { id: "pl-1", projectId: "repo", name: "p", by: "ana", via: "web", at: 1 }));
      // A schedule row inserted directly until P2 builds the schedule writer (plan Task 3).
      const body = (entryId: string) => JSON.stringify({ enabled: false, start: { kind: "group", entryId, sha256: "a".repeat(64), tokenLimit: null, integration: null } });
      s.db.prepare("INSERT INTO schedules(id,project_id,kind,revision,removed,body) VALUES ('sch-a','repo','group',1,0,?)").run(body("pl-1"));
      s.db.prepare("INSERT INTO schedules(id,project_id,kind,revision,removed,body) VALUES ('sch-b','repo','group',1,0,?)").run(body("pl-other"));
      expect(pinningSchedules(s, "pl-1")).toEqual(["sch-a"]);
      expect(refusal(() => s.transaction(() => archiveEntry(s, "pl-1", { by: "ana", via: "web", at: 2 })))).toEqual({ code: "plan-library-entry-in-use", detail: "sch-a" });
      expect(listEntries(s, "repo", false).map((e) => e.id)).toEqual(["pl-1"]);
      s.db.prepare("UPDATE schedules SET removed=1 WHERE id='sch-a'").run();
      s.transaction(() => archiveEntry(s, "pl-1", { by: "ana", via: "web", at: 2 }));
      expect(listEntries(s, "repo", false)).toEqual([]);
      expect(listEntries(s, "repo", true).map((e) => [e.id, e.state, e.body.archivedBy])).toEqual([["pl-1", "archived", "ana"]]);
    } finally { s.close(); }
  });
});

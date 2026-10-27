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
import { planLibraryEntryView, planLibraryListView } from "../../src/control/planLibrary/views.js";
import { openControlStore, type ControlStore } from "../../src/control/store.js";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { withCommandContext } from "../../src/control/commandClient.js";
import { applyPlanLibraryCommand, libraryEntryId, type PlanLibraryCommand } from "../../src/control/planLibrary/commands.js";
import { importControlPlanAsync, type ImportCommand } from "../../src/control/planImport.js";
import { readArchivedPlan } from "../../src/control/queries.js";
import { readDraft } from "../../src/control/requirementRecords.js";
import { idSchema } from "../../src/control/schema.js";
import { rawAuthorityCommandSchema } from "../../src/control/webProtocol.js";
import { registerControlReadRoutes } from "../../src/panel/controlApi.js";
import { profileSnapshot, webFixture } from "./fixtures/web.js";
import { requirementHarness } from "./fixtures/requirementHarness.js";
import { VALID_SPLIT } from "./fixtures/requirementOutputs.js";

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

  // Review finding 4 (session 7753e97d): one schedule body that does not parse must not turn every library read into a
  // raw SyntaxError, and an archive cannot tell whether that schedule pins the entry -- so it refuses, by name.
  it.each([["not json"], ["null"]])("a schedule body %s: the library still lists, usedBy names the readable pin, archive refuses it as unreadable", async (bad) => {
    const s = await store();
    try {
      s.transaction(() => insertEntry(s, { id: "pl-1", projectId: "repo", name: "p", by: "ana", via: "web", at: 1 }));
      const body = JSON.stringify({ enabled: false, start: { kind: "group", entryId: "pl-1", sha256: "a".repeat(64), tokenLimit: null, integration: null } });
      s.db.prepare("INSERT INTO schedules(id,project_id,kind,revision,removed,body) VALUES ('sch-a','repo','group',1,0,?)").run(body);
      s.db.prepare("INSERT INTO schedules(id,project_id,kind,revision,removed,body) VALUES ('sch-b','repo','group',1,0,?)").run(bad);
      expect(planLibraryListView(s, "repo", false).entries.map((entry) => [entry.entryId, entry.usedBy])).toEqual([["pl-1", ["sch-a"]]]);
      expect(planLibraryEntryView(s, "pl-1").usedBy).toEqual(["sch-a"]);
      s.db.prepare("UPDATE schedules SET removed=1 WHERE id='sch-a'").run();
      expect(refusal(() => s.transaction(() => archiveEntry(s, "pl-1", { by: "ana", via: "web", at: 2 }))))
        .toEqual({ code: "plan-library-entry-in-use", detail: "sch-b:unreadable" });
      expect(listEntries(s, "repo", false).map((e) => e.id)).toEqual(["pl-1"]);
      // Once the person removes the unreadable row, nothing can pin the entry and the archive goes through.
      s.db.prepare("UPDATE schedules SET removed=1 WHERE id='sch-b'").run();
      s.transaction(() => archiveEntry(s, "pl-1", { by: "ana", via: "web", at: 2 }));
      expect(listEntries(s, "repo", false)).toEqual([]);
    } finally { s.close(); }
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Plan Task 3: the library verbs and `import-plan` from an entry (§5.3, §5.5, §5.6, §9.1's import fields), C8.
// ---------------------------------------------------------------------------------------------------------------------
const LOOP = { plan: "standard", goal: "loop goal", successCondition: "loop done", targetPaths: ["src/**"], checks: ["true"] };
const lib = <V extends PlanLibraryCommand["verb"]>(commandId: string, verb: V, payload: Extract<PlanLibraryCommand, { verb: V }>["payload"]) =>
  ({ schema: "orca-raw-command-v1", commandId, actorId: "human", expectedRevision: 0, verb, target: { kind: "plan-library" }, payload }) as PlanLibraryCommand;
const PERSON = { client: "web", principal: "web", attribution: { by: "ana", via: "web" } };
type Answer = { result?: { kind: string; entryId?: string; version?: number; sha256?: string; appended?: boolean }; error?: { code: string; message: string } };
const libraryRows = (store: ControlStore) => ({
  entries: Number(store.db.prepare("SELECT COUNT(*) AS n FROM plan_library").get()!.n),
  versions: Number(store.db.prepare("SELECT COUNT(*) AS n FROM plan_library_versions").get()!.n),
});

async function groupWorld() {
  const f = await webFixture(profileSnapshot(), [{ taskId: "a" }, { taskId: "b", dependsOn: ["a"], loop: LOOP, labels: ["feature"] }]);
  const repo = join(f.root, "repo");
  const deps = { store: f.store, resolveRepository: (repoId: string) => { if (repoId !== "repo") throw new ControlError("control-target-not-allowed"); return repo; } };
  const run = (command: PlanLibraryCommand): Answer => withCommandContext(command.commandId, PERSON, () => applyPlanLibraryCommand(deps, command)) as Answer;
  const importFrom = (groupId: string, extra: Record<string, unknown>, opts: Parameters<typeof importControlPlanAsync>[2] = {}) =>
    importControlPlanAsync({ ...f.deps, resolveRepository: deps.resolveRepository } as never, {
      schema: "orca-raw-command-v1", commandId: `import-${groupId}`, actorId: "human", expectedRevision: 0, verb: "import-plan",
      target: { kind: "group", groupId }, payload: { groupId, repoId: "repo", ...extra },
    } as ImportCommand, opts) as Promise<Answer>;
  return { f, repo, deps, run, importFrom };
}

describe("plan-library-save from a group, then import-plan from the entry (§5.3 (b), §5.5, C8 round trip)", () => {
  it("the new group has the source's task ids, dependencies, contract hashes and loop recipes, under lib-<entry>-<sha[:12]>", async () => {
    const w = await groupWorld();
    try {
      // The planId import the fixture made works as before.
      expect(w.f.imported).toMatchObject({ result: { kind: "imported", groupId: "g" } });
      const saved = w.run(lib("save-1", "plan-library-save", { source: { kind: "group", groupId: "g" }, name: "weekly" }));
      expect(saved.result).toMatchObject({ kind: "plan-library-saved", entryId: libraryEntryId("save-1"), version: 1, appended: true });
      const entryId = saved.result!.entryId!, sha256 = saved.result!.sha256!;
      expect(entryId).toMatch(/^pl-[0-9a-f]{16}$/);
      expect(idSchema.safeParse(entryId).success).toBe(true);
      // The version records the person and channel, and where it came from.
      const version = readVersion(w.f.store, entryId, sha256)!;
      expect([version.by, version.via, version.origin]).toEqual(["ana", "web", { kind: "group", groupId: "g", planHash: readArchivedPlan(w.f.store, "g").planHash }]);
      const imported = await w.importFrom("g2", { libraryEntry: { entryId, sha256 } });
      expect(imported.result).toMatchObject({ kind: "imported", groupId: "g2" });
      const shape = (groupId: string) => readArchivedPlan(w.f.store, groupId).plan.tasks.map((t) => ({ taskId: t.taskId, deps: t.dependencyTaskIds, hash: t.originalContractHash, loop: t.loop ?? null, labels: t.labels ?? null }));
      expect(shape("g2")).toEqual(shape("g"));
      expect(shape("g").find((t) => t.taskId === "b")!.loop).not.toBeNull();
      expect(readArchivedPlan(w.f.store, "g2").plan.planId).toBe(`lib-${entryId}-${sha256.slice(0, 12)}`);
    } finally { await w.f.dispose(); }
  });

  it("an import with the fields adds them; without them the group body has no origin, an unlimited limit and the project default", async () => {
    const w = await groupWorld();
    try {
      const saved = w.run(lib("save-1", "plan-library-save", { source: { kind: "group", groupId: "g" }, name: "weekly" }));
      const libraryEntry = { entryId: saved.result!.entryId!, sha256: saved.result!.sha256! };
      const body = (groupId: string) => JSON.parse(String(w.f.store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId)!.body));
      await w.importFrom("g2", { libraryEntry });
      expect(body("g2").limit.tokens).toBeNull();
      expect(Object.hasOwn(body("g2"), "origin")).toBe(false);
      expect(Object.hasOwn(body("g2"), "integration")).toBe(false);
      const local = { delivery: "local", trigger: "group", method: "merge", target: "main" };
      const answer = await w.importFrom("g3", { libraryEntry, tokenLimit: 5_000_000, integration: local }, { origin: { kind: "schedule", scheduleId: "sch-x", slot: 1234 } });
      expect(answer.result).toMatchObject({ kind: "imported" });
      expect(body("g3").limit.tokens).toBe(5_000_000);
      expect(body("g3").integration.scheme).toEqual(local);
      expect(body("g3").origin).toEqual({ kind: "schedule", scheduleId: "sch-x", slot: 1234 });
      expect(w.f.store.db.prepare("SELECT tokens FROM token_policies WHERE group_id='g3' AND work_item_id=''").get()).toEqual({ tokens: 5_000_000 });
      // A limit the import's own commitments do not fit is refused, and no group is written.
      expect((await w.importFrom("g4", { libraryEntry, tokenLimit: 1 })).error?.code).toBe("group-budget-unavailable");
      expect(w.f.store.db.prepare("SELECT id FROM groups WHERE id='g4'").get()).toBeUndefined();
    } finally { await w.f.dispose(); }
  });

  it("refuses a version whose stored bytes were altered (plan-library-hash-mismatch) and another project's entry", async () => {
    const w = await groupWorld();
    try {
      const saved = w.run(lib("save-1", "plan-library-save", { source: { kind: "group", groupId: "g" }, name: "weekly" }));
      const libraryEntry = { entryId: saved.result!.entryId!, sha256: saved.result!.sha256! };
      w.f.store.db.prepare("UPDATE plan_library SET project_id='other' WHERE id=?").run(libraryEntry.entryId);
      expect((await w.importFrom("g2", { libraryEntry })).error?.code).toBe("plan-library-project-mismatch");
      w.f.store.db.prepare("UPDATE plan_library SET project_id='repo' WHERE id=?").run(libraryEntry.entryId);
      w.f.store.db.prepare("UPDATE plan_library_versions SET doc=replace(doc,'ship','sh1p') WHERE entry_id=?").run(libraryEntry.entryId);
      expect((await w.importFrom("g3", { libraryEntry })).error?.code).toBe("plan-library-hash-mismatch");
    } finally { await w.f.dispose(); }
  });

  it("import-plan takes exactly one of planId and libraryEntry; tokenLimit and integration only with libraryEntry", () => {
    const command = (payload: Record<string, unknown>) => ({ schema: "orca-raw-command-v1", commandId: "c", actorId: "human", expectedRevision: 0, verb: "import-plan",
      target: { kind: "group", groupId: "g" }, payload: { groupId: "g", repoId: "repo", ...payload } });
    const libraryEntry = { entryId: "pl-0123456789abcdef", sha256: "a".repeat(64) };
    expect(rawAuthorityCommandSchema.safeParse(command({ planId: "plan" })).success).toBe(true);
    expect(rawAuthorityCommandSchema.safeParse(command({ libraryEntry })).success).toBe(true);
    expect(rawAuthorityCommandSchema.safeParse(command({ libraryEntry, tokenLimit: null, integration: null })).success).toBe(true);
    expect(rawAuthorityCommandSchema.safeParse(command({ planId: "plan", libraryEntry })).success).toBe(false);
    expect(rawAuthorityCommandSchema.safeParse(command({})).success).toBe(false);
    expect(rawAuthorityCommandSchema.safeParse(command({ planId: "plan", tokenLimit: 5 })).success).toBe(false);
    expect(rawAuthorityCommandSchema.safeParse(command({ planId: "plan", integration: { delivery: "keep" } })).success).toBe(false);
  });
});

describe("plan-library-save from a requirement split (§5.3 (a), C8)", () => {
  async function reviewed() {
    const x = await requirementHarness({ answers: [{ purpose: "split", output: VALID_SPLIT }], startAt: "split" });
    await x.until(() => readDraft(x.store, "r", 1).state === "awaiting-review");
    const run = (command: PlanLibraryCommand): Answer => withCommandContext(command.commandId, PERSON, () => applyPlanLibraryCommand({ store: x.store, resolveRepository: () => x.repo }, command)) as Answer;
    return { x, run };
  }

  it("saves the stored split with its draftHash; the draft stays awaiting review", async () => {
    const { x, run } = await reviewed();
    try {
      const draftHash = readDraft(x.store, "r", 1).draftHash!;
      const saved = run(lib("save-r", "plan-library-save", { source: { kind: "requirement-draft", groupId: "r", draftNo: 1, draftHash }, name: "split" }));
      expect(saved.result).toMatchObject({ kind: "plan-library-saved", version: 1 });
      expect(readDraft(x.store, "r", 1).state).toBe("awaiting-review");
      const version = readVersion(x.store, saved.result!.entryId!, saved.result!.sha256!)!;
      expect(version.origin).toEqual({ kind: "requirement-draft", groupId: "r", draftNo: 1, draftHash });
      expect(listEntries(x.store, "repo", false).map((e) => e.id)).toEqual([saved.result!.entryId]);
      expect((JSON.parse(version.doc) as { tasks: Array<{ loop?: unknown }> }).tasks.every((t) => t.loop !== undefined)).toBe(true);
    } finally { await x.dispose(); }
  });

  it("refuses a wrong draftHash (plan-version-conflict) and stores nothing", async () => {
    const { x, run } = await reviewed();
    try {
      const answer = run(lib("save-r", "plan-library-save", { source: { kind: "requirement-draft", groupId: "r", draftNo: 1, draftHash: "0".repeat(64) }, name: "split" }));
      expect(answer.error?.code).toBe("plan-version-conflict");
      expect(libraryRows(x.store)).toEqual({ entries: 0, versions: 0 });
    } finally { await x.dispose(); }
  });
});

describe("plan-library-import and -archive (§5.3 (c), §5.6, C8)", () => {
  const PROVENANCE = { fileName: "plan.json", fileSha256: "f".repeat(64), format: "orca-plan-v1" as const };

  it("an upload with an unknown key, a dangling dependency, a cycle, a mismatched objective.taskId or over 2 MiB is refused and nothing is stored", async () => {
    const w = await groupWorld();
    try {
      const big = { ...contract("a"), context: { ...contract("a").context, constraints: ["x".repeat(PLAN_DOC_MAX_BYTES)] } };
      const bad: Array<[unknown, string]> = [
        [{ ...doc(), extra: 1 }, "control-plan-rejected"],
        [doc([{ taskId: "a", dependsOn: ["zz"], targetVersion: 1, contract: contract("a") }]), "control-plan-rejected"],
        [doc([{ taskId: "a", dependsOn: ["b"], targetVersion: 1, contract: contract("a") }, { taskId: "b", dependsOn: ["a"], targetVersion: 1, contract: contract("b") }]), "control-plan-rejected"],
        [doc([{ taskId: "a", dependsOn: [], targetVersion: 1, contract: contract("other") }]), "control-plan-rejected"],
        [doc([{ taskId: "a", dependsOn: [], targetVersion: 1, contract: big }]), "plan-library-doc-too-large"],
      ];
      for (const [i, [raw, code]] of bad.entries()) {
        expect(w.run(lib(`imp-${i}`, "plan-library-import", { projectId: "repo", name: "p", doc: raw, provenance: PROVENANCE })).error?.code, String(i)).toBe(code);
      }
      expect(libraryRows(w.f.store)).toEqual({ entries: 0, versions: 0 });
      // An unknown project is refused; a good document is stored with its file provenance.
      expect(w.run(lib("imp-x", "plan-library-import", { projectId: "nope", name: "p", doc: doc(), provenance: PROVENANCE })).error?.code).toBe("control-target-not-allowed");
      const ok = w.run(lib("imp-ok", "plan-library-import", { projectId: "repo", name: "p", doc: doc(), provenance: PROVENANCE }));
      expect(ok.result).toMatchObject({ kind: "plan-library-saved", version: 1 });
      expect(readVersion(w.f.store, ok.result!.entryId!, ok.result!.sha256!)!.origin).toEqual({ kind: "import", ...PROVENANCE });
    } finally { await w.f.dispose(); }
  });

  it("a second save with entryId appends version 2 and leaves version 1 byte-identical; another project's entry is refused", async () => {
    const w = await groupWorld();
    try {
      const first = w.run(lib("imp-1", "plan-library-import", { projectId: "repo", name: "p", doc: doc(), provenance: PROVENANCE }));
      const entryId = first.result!.entryId!;
      const v1 = w.f.store.db.prepare("SELECT * FROM plan_library_versions WHERE entry_id=? AND version=1").get(entryId);
      const second = w.run(lib("save-2", "plan-library-save", { source: { kind: "group", groupId: "g" }, name: "p", entryId }));
      expect(second.result).toMatchObject({ kind: "plan-library-saved", entryId, version: 2, appended: true });
      expect(w.f.store.db.prepare("SELECT * FROM plan_library_versions WHERE entry_id=? AND version=1").get(entryId)).toEqual(v1);
      w.f.store.db.prepare("UPDATE plan_library SET project_id='other' WHERE id=?").run(entryId);
      expect(w.run(lib("save-3", "plan-library-save", { source: { kind: "group", groupId: "g" }, name: "p", entryId })).error?.code).toBe("plan-library-project-mismatch");
    } finally { await w.f.dispose(); }
  });

  it("archive is refused while a disabled schedule pins the entry (plan-library-entry-in-use)", async () => {
    const w = await groupWorld();
    try {
      const saved = w.run(lib("imp-1", "plan-library-import", { projectId: "repo", name: "p", doc: doc(), provenance: PROVENANCE }));
      const entryId = saved.result!.entryId!;
      // A schedule row inserted directly until P2 builds the schedule writer (plan Task 3).
      w.f.store.db.prepare("INSERT INTO schedules(id,project_id,kind,revision,removed,body) VALUES ('sch-a','repo','group',1,0,?)")
        .run(JSON.stringify({ enabled: false, start: { kind: "group", entryId, sha256: saved.result!.sha256, tokenLimit: null, integration: null } }));
      expect(w.run(lib("arc-1", "plan-library-archive", { entryId })).error?.code).toBe("plan-library-entry-in-use");
      expect(listEntries(w.f.store, "repo", false).map((e) => e.state)).toEqual(["active"]);
      w.f.store.db.prepare("UPDATE schedules SET removed=1").run();
      expect(w.run(lib("arc-2", "plan-library-archive", { entryId })).result).toEqual({ kind: "plan-library-archived", entryId });
      expect(listEntries(w.f.store, "repo", false)).toEqual([]);
    } finally { await w.f.dispose(); }
  });
});

describe("the library reads (§13.3 API)", () => {
  it("lists a project's entries, shows an entry's versions with provenance, and downloads a version's canonical bytes as an attachment", async () => {
    const w = await groupWorld();
    const server = createServer((() => {
      const app = express();
      app.use((_req, res, next) => { res.locals.orcaPrincipal = { kind: "user", userId: "u2", name: "m", roles: ["member"] }; next(); });
      registerControlReadRoutes(app, { store: w.f.store, epoch: "epoch", config: { readView: async () => ({}) } as never }, "web");
      return app;
    })());
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const saved = w.run(lib("save-1", "plan-library-save", { source: { kind: "group", groupId: "g" }, name: "weekly" }));
      const { entryId, sha256 } = saved.result as { entryId: string; sha256: string };
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/control/plan-library`;
      const list = await (await fetch(`${base}?repoId=repo`)).json() as { entries: Array<{ entryId: string; name: string; head: { sha256: string; by: string; via: string } }> };
      expect(list.entries.map((e) => [e.entryId, e.name, e.head.sha256, e.head.by, e.head.via])).toEqual([[entryId, "weekly", sha256, "ana", "web"]]);
      const entry = await (await fetch(`${base}/${entryId}`)).json() as { versions: Array<{ version: number; origin: { kind: string } }> };
      expect(entry.versions.map((v) => [v.version, v.origin.kind])).toEqual([[1, "group"]]);
      const download = await fetch(`${base}/${entryId}/versions/${sha256}`);
      expect(download.headers.get("content-disposition")).toContain("attachment");
      const bytes = await download.text();
      expect(bytes).toBe(readVersion(w.f.store, entryId, sha256)!.doc);
      expect(sha256Canonical(JSON.parse(bytes))).toBe(sha256);
      expect((await fetch(`${base}/${entryId}/versions/${"0".repeat(64)}`)).status).toBe(404);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await w.f.dispose();
    }
  });
});

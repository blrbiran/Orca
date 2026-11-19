import { mkdirSync, realpathSync } from "node:fs";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { replenishStartWakes } from "../../src/control/executionDriver.js";
import { readConfirmedTaskExecution } from "../../src/control/executionSnapshot.js";
import { classifyReviewOutput, multiFixPaths } from "../../src/control/requirementReview.js";
import { taskWrites } from "../../src/control/requirementRecords.js";
import { deliverScheduledStart } from "../../src/control/webDispatch.js";
import type { LoopWork } from "../../src/control/executionPort.js";
import { flowVaultRepoId } from "../../src/flow/groups.js";
import { vaultKeyOf } from "../../src/flow/vault/paths.js";
import { git } from "./fixtures/driverHarness.js";
import { editGroup, reviewActivities } from "./fixtures/folderReviewWorld.js";
import { reviewWorld, type ReviewWorld } from "./fixtures/reviewWorld.js";
import type { SingleCallAnswer, SingleCallSeen } from "./fixtures/singleCallAnswers.js";

/**
 * #337 (spec 2026-11-19 §4.2, §5.3-§5.4, §7, criterion C2; human ruling 2 「同意」): a multi-directory group -- here a
 * repository member `main` and a folder member `docs` -- is reviewed in one call with a labelled section per member, each
 * against its own base, the tips on the call's identity; evidence names its member (`<key>:<path>`). A not-met finding
 * opens a fix task built from stored records only: per-member `writes` on its work item, the primary's paths and checks,
 * one additionalRepos entry per other member -- and its run prepares at A2.
 *
 * World: reviewWorld (synthetic ccloop) with the folder's vault a second real repository resolved by its vault repo id.
 */
const docsFolder = (root: string): string => { const dir = join(root, "docs-folder"); mkdirSync(dir, { recursive: true }); return realpathSync(dir).normalize("NFC"); };
const withVault = async (root: string): Promise<Record<string, string>> => {
  const vault = join(root, "docs-vault");
  await mkdir(vault);
  git(vault, "init", "-q", "-b", "main");
  await writeFile(join(vault, "intro.md"), "intro\n");
  git(vault, "add", "intro.md");
  git(vault, "commit", "-qm", "the folder's import");
  // The export makes every member's work branch (multi spec §6.4).
  git(vault, "branch", "orca/g");
  return { [flowVaultRepoId(vaultKeyOf(docsFolder(root)))]: await realpath(vault) };
};

/** The registry freeze and the split's writes, where requirement-open and an accepted split leave them. */
function makeMulti(w: ReviewWorld, keys: { primary?: string } = {}): void {
  const dir = docsFolder(w.t.h.root);
  editGroup(w, (body) => {
    body.multiDir = { project: "multi", landing: null, dirs: [{ key: keys.primary ?? "main", repoId: "repo", kind: "repo" },
      { key: "docs", repoId: "docs-project", kind: "dir", dirWorkspace: { dir, vaultId: vaultKeyOf(dir) } }] };
  });
  for (const [taskId, write] of [["a", { dir: keys.primary ?? "main", targetPaths: ["a"], checks: ["true"] }], ["b", { dir: "docs", targetPaths: ["guide.md"], checks: ["test -f guide.md"] }]] as const) {
    const row = w.t.h.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id=?").get(taskId)!;
    w.t.h.store.db.prepare("UPDATE work_items SET body=? WHERE group_id='g' AND id=?").run(JSON.stringify({ ...JSON.parse(String(row.body)), writes: [write] }), taskId);
  }
}

const multiWorld = (answer: (call: SingleCallSeen) => SingleCallAnswer, files: (id: string) => Record<string, string | null> = (id): Record<string, string | null> => (id === "a" ? { a: "a\n" } : { "guide.md": "guide\n" })) =>
  reviewWorld({ tasks: [{ taskId: "a", targetPaths: ["a"] }, { taskId: "b", targetPaths: ["guide.md"] }], answer, harness: { repositories: withVault, files } });
const reviewRuns = (w: ReviewWorld) => w.t.h.store.db.prepare("SELECT id, body FROM runs WHERE group_id='g' AND json_extract(body,'$.purpose')='requirement-review' ORDER BY rowid").all()
  .map((row) => JSON.parse(String(row.body)) as { requirementReview: { roundNo: number; tip: string; tips?: Record<string, string> } });
const workBase = (w: ReviewWorld, taskId: string, key: string): string => {
  const row = w.t.h.store.db.prepare("SELECT body FROM runs WHERE group_id='g' AND work_item_id=? ORDER BY rowid LIMIT 1").get(taskId)!;
  return (JSON.parse(String(row.body)) as { drive: { dirs: Array<{ key: string; base: string }> } }).drive.dirs.find((d) => d.key === key)!.base;
};
const notMetFinding = (): SingleCallAnswer => ({ outcome: "complete", output: {
  criteria: [{ id: "AC1", verdict: "not-met", evidence: [{ path: "main:a", line: 1 }], missing: "`docs:guide.md` must say how a.txt is used", fixableBy: "work" },
    { id: "AC2", verdict: "met", evidence: [{ path: "docs:guide.md", line: 1 }], missing: null, fixableBy: "work" }], summary: "the guide is short" } });

let stderr: string[] = [];
beforeEach(() => { stderr = []; const write = process.stderr.write.bind(process.stderr); vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array, ...rest: unknown[]) => { stderr.push(String(chunk)); return write(chunk as never, ...rest as never[]); }); });
afterEach(() => { vi.restoreAllMocks(); });

describe("a multi-directory group's requirement review (#337 C2)", () => {
  it("makes one call with a section per member on its own base, and opens a fix task that prepares with per-member writes", async () => {
    const w = await multiWorld(notMetFinding);
    try {
      makeMulti(w);
      await w.runAll();
      await w.t.until(w.driver, () => w.review()?.state === "fixing" || w.review()?.state === "noted", 120);
      expect(w.calls).toHaveLength(1);
      const prompt = w.calls[0]!.prompt;
      const tips = { main: git(w.t.repo, "rev-parse", "orca/g"), docs: git(w.t.repositories[flowVaultRepoId(vaultKeyOf(docsFolder(w.t.h.root)))]!, "rev-parse", "orca/g") };
      // mutation M3: base_k = the primary's base for every member -> the docs section's base (and its diff) is wrong, red
      expect(prompt).toContain(`Directory main (repository): files changed and diff, before = ${workBase(w, "a", "main").slice(0, 12)}, after = ${tips.main.slice(0, 12)}:\n- A a 2 `);
      expect(prompt).toContain(`Directory docs (folder): files changed and diff, before = ${workBase(w, "b", "docs").slice(0, 12)}, after = ${tips.docs.slice(0, 12)}:\n- A guide.md 6 `);
      expect(prompt).toContain("+++ b/guide.md");
      expect(prompt).toContain("Directory docs (folder): Orca's copy of the folder leaves out: any file over 50 MiB");
      expect(prompt).toContain("- In this group a file's path is always written <key>:<path>");
      expect(prompt).not.toContain("The group's diff against its base:");
      expect(reviewRuns(w)[0]!.requirementReview).toEqual({ roundNo: 1, tip: tips.main, tips });
      // mutation M15: wait on deliverySettled for a multi group -> groupRepoId throws, logged, no call at all, red above
      expect(stderr.filter((line) => line.includes("multi-dir-group-no-single-repo"))).toEqual([]);

      expect(w.review()).toMatchObject({ state: "fixing", rounds: [expect.objectContaining({ result: "not-met", fixTaskId: "review-fix-1" })] });
      // mutation M4: omit writes -> null here (and the run blocks multi-dir-writes-missing), red
      expect(taskWrites(w.t.h.store, "g", "review-fix-1")).toEqual([
        { dir: "main", targetPaths: ["a"], checks: ["true"] }, { dir: "docs", targetPaths: ["guide.md"], checks: ["test -f guide.md"] }]);
      const contract = readConfirmedTaskExecution(w.t.h.store, "g", "review-fix-1").contract as unknown as {
        context: { targetPaths: string[]; repoKey?: string; additionalRepos?: Array<{ key: string; targetPaths: string[]; requiredChecks?: string[] }> }; verification: { requiredChecks: string[] } };
      expect(contract.context).toMatchObject({ targetPaths: ["a"], repoKey: "main", additionalRepos: [expect.objectContaining({ key: "docs", targetPaths: ["guide.md"], requiredChecks: ["test -f guide.md"] })] });
      expect(contract.verification.requiredChecks).toEqual(["true"]);

      // The fix run reaches A2's prepared state with both members. mutation M16: keep the source's context -> multi-dir-contract:docs, red
      replenishStartWakes({ store: w.t.h.store, admissionGate: w.t.h.deps.admissionGate });
      const delivered = await deliverScheduledStart(w.t.dispatch, "g");
      if (delivered.kind !== "claimed") throw new Error(`fix not claimed: ${JSON.stringify(delivered)}`);
      await w.t.until(w.driver, () => w.t.fake.calls.accept.some((e) => e.claim.runId === delivered.runId) || w.t.body(delivered.runId).drive?.blockedReason != null, 30);
      expect(w.t.body(delivered.runId).drive).toMatchObject({ prepared: true });
      expect(w.t.body(delivered.runId).drive.dirs.map((d: { key: string }) => d.key)).toEqual(["main", "docs"]);
      const envelope = w.t.fake.calls.accept.find((e) => e.claim.runId === delivered.runId)!;
      expect((envelope.work as LoopWork).additionalRepos?.map((r) => r.key)).toEqual(["docs"]);
    } finally { await w.t.h.dispose(); }
  }, 400000);

  it("asks a shape failure again on the same tips", async () => {
    let n = 0;
    const w = await multiWorld(() => (++n === 1 ? { outcome: "failed", errorCode: "single-call-output-invalid" } : { outcome: "complete", output: {
      criteria: [{ id: "AC1", verdict: "met", evidence: [{ path: "main:a", line: 1 }], missing: null, fixableBy: "work" },
        { id: "AC2", verdict: "met", evidence: [{ path: "docs:guide.md", line: 1 }], missing: null, fixableBy: "work" }], summary: "fine" } }));
    try {
      makeMulti(w);
      await w.runAll();
      await w.t.until(w.driver, () => w.review()?.state === "passed" || w.review()?.state === "noted", 120);
      const runs = reviewRuns(w);
      expect(runs).toHaveLength(2);
      expect(runs[0]!.requirementReview.tips).toBeDefined();
      // mutation M12: drop tips from the re-ask -> undefined, red
      expect(runs[1]!.requirementReview).toEqual(runs[0]!.requirementReview);
      expect(reviewActivities(w).map((row) => row.result)).toEqual(["asked-again", "passed"]);
    } finally { await w.t.h.dispose(); }
  }, 400000);

  it("gives each changed member an equal part of the diff bound, with a cut line each", async () => {
    const big = (fill: string) => `${fill.repeat(63)}\n`.repeat(2_400);
    const w = await multiWorld(() => ({ outcome: "complete", output: {
      criteria: [{ id: "AC1", verdict: "met", evidence: [{ path: "main:a", line: 1 }], missing: null, fixableBy: "work" },
        { id: "AC2", verdict: "met", evidence: [{ path: "docs:guide.md", line: 1 }], missing: null, fixableBy: "work" }], summary: "fine" } }),
    (id): Record<string, string | null> => (id === "a" ? { a: big("m") } : { "guide.md": big("d") }));
    try {
      makeMulti(w);
      await w.runAll();
      await w.t.until(w.driver, () => w.review()?.state === "passed" || w.review()?.state === "noted", 120);
      const prompt = w.calls[0]!.prompt;
      // mutation M14: one shared 200,000-byte cut -> each line says 200000 (or the second member is unseen), red
      expect(prompt).toContain("(Directory main: the diff was cut at 100000 bytes; the rest was not shown to you.)");
      expect(prompt).toContain("(Directory docs: the diff was cut at 100000 bytes; the rest was not shown to you.)");
      expect(prompt).toContain("+++ b/guide.md");
      expect(Buffer.byteLength(prompt, "utf8")).toBeLessThan(200_000 + 20_000);
    } finally { await w.t.h.dispose(); }
  }, 400000);
});

describe("a multi-directory group's evidence and fix paths (#337 §4.2, §5.4)", () => {
  const raw = (path: string) => ({ criteria: [{ id: "AC1", verdict: "met", evidence: [{ path, line: 1 }], missing: null, fixableBy: "work" }], summary: "s" });
  it("an evidence path with no member key is invalid; a record keeps its name", () => {
    // mutation M13: skip the dirKeys check -> passed, red
    expect(classifyReviewOutput(raw("guide.md"), ["AC1"], ["main", "docs"])).toEqual({ result: "invalid", reason: "evidence-dir:guide.md" });
    expect(classifyReviewOutput(raw("site:guide.md"), ["AC1"], ["main", "docs"])).toEqual({ result: "invalid", reason: "evidence-dir:site:guide.md" });
    expect(classifyReviewOutput(raw("docs:guide.md"), ["AC1"], ["main", "docs"])).toMatchObject({ result: "passed" });
    expect(classifyReviewOutput(raw("orca:acceptance"), ["AC1"], ["main", "docs"])).toMatchObject({ result: "passed" });
    // A repository group's answer is not checked for keys (Rule 3).
    expect(classifyReviewOutput(raw("guide.md"), ["AC1"])).toMatchObject({ result: "passed" });
  });

  it("keeps a member keyed orca's files and drops only the three records, by exact match", () => {
    // mutation M17: filter by the `orca:` prefix -> the member's notes.md is dropped, red
    expect(multiFixPaths([{ evidence: [{ path: "orca:notes.md" }, { path: "orca:acceptance" }, { path: "orca:delivery" }, { path: "orca:delivered-acceptance" }], missing: "x" }], ["main", "orca"]))
      .toEqual(new Map([["orca", ["notes.md"]]]));
  });

  it("reads <key>:<path> tokens in the missing text, and ignores a token with no known key", () => {
    // mutation M18: no <key>:<path> token grammar -> nothing from the text, red
    expect(multiFixPaths([{ evidence: [], missing: "`docs:guide.md` is missing; so is main:src/api.ts and other:x/y.md" }], ["main", "docs"]))
      .toEqual(new Map([["docs", ["guide.md"]], ["main", ["src/api.ts"]]]));
  });
});

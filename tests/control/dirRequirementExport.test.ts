/**
 * Dir-requirements spec §6.4, §6.5, criterion D4 (plan Task 3): the export of a requirement on a `dir` project. It waits
 * (no git child, no vault access, wake undelivered, no progress) while a prerequisite is not done; then a fresh import of
 * the folder becomes `refs/orca/group/<g>/base` and `placed`, and `orca/<g>` is a one-parent document commit on that base,
 * all in the vault; the export's transaction records `placement` idle at the base with `landedTip` the document commit.
 * The folder (a git repository here) is byte-equal throughout. A replay creates nothing and an existing base is never
 * replaced. Dispatch then works in a worktree of the (bare) vault at the work branch; a dir group whose work branch is
 * absent blocks A2 as `dir-base-missing` and never creates one.
 */
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveGroupSelections } from "../../src/control/agentFreeze.js";
import { readArchivedPlan, readBudgetProposal } from "../../src/control/queries.js";
import { exportPendingRequirements, exportRequirementDocument } from "../../src/control/requirementExport.js";
import { readDraft, readRequirementGroup } from "../../src/control/requirementRecords.js";
import { readCanonicalRecord } from "../../src/control/snapshot.js";
import { vaultKeyOf } from "../../src/flow/vault/paths.js";
import { digestTree, dirRequirementHarness } from "./fixtures/dirRequirement.js";
import { VALID_SPLIT } from "./fixtures/requirementOutputs.js";

type X = Awaited<ReturnType<typeof dirRequirementHarness>>;

/** A dir group "r" with its split accepted (export pending, wake queued); the folder is a git repository with a commit. */
async function accepted() {
  const x = await dirRequirementHarness({ answers: [{ purpose: "split", output: VALID_SPLIT }], startAt: "split",
    files: { "README.md": "# Notes\n", "src/export.ts": "export {};\n", "src/images.ts": "export {};\n", "answer.txt": "a\n", ".decisions/own.jsonl": "{\"mine\":true}\n" } });
  const f = (...args: string[]) => execFileSync("git", ["-c", "user.name=p", "-c", "user.email=p@p", "-c", "core.hooksPath=/dev/null", ...args], { cwd: x.folder, encoding: "utf8" }).trim();
  f("init", "-q", "-b", "main"); f("add", "-A"); f("commit", "-qm", "the person's own history");
  const real = realpathSync(x.folder).normalize("NFC");
  x.store.db.prepare("UPDATE groups SET body=? WHERE id='r'").run(JSON.stringify({ ...x.body(), dirWorkspace: { dir: real, vaultId: vaultKeyOf(real) } }));
  await x.until(() => readDraft(x.store, "r", 1).state === "awaiting-review");
  const done = await x.service.acceptRequirementDraft(x.command("requirement-draft-accept", { draftNo: 1, draftHash: readDraft(x.store, "r", 1).draftHash! }));
  if ("error" in done) throw new Error(JSON.stringify(done));
  const vault = join(x.env.ORCA_VAULT_DIR!, `${vaultKeyOf(real)}.git`);
  const v = (...args: string[]) => x.vaultGit(vault, args);
  const ref = (name: string): string | null => { try { return v("rev-parse", "--verify", "-q", `${name}^{commit}`); } catch { return null; } };
  const document = readRequirementGroup(x.store, "r").requirement.document!;
  return { x, f, vault, v, ref, text: JSON.parse(readCanonicalRecord(x.store, document.recordHash)).text as string };
}
const deps = (x: X) => ({ store: x.store, resolveRepository: x.deps.resolveRepository, env: x.env });
const wake = (x: X) => x.store.db.prepare("SELECT delivered FROM scheduler_wakes WHERE id='scheduler-wake:r:requirement-export'").get();
const exportOf = (x: X) => readRequirementGroup(x.store, "r").requirement.export;
const placementOf = (x: X) => (x.body() as { placement?: unknown }).placement;

/** Runs `body` with a `git` first on PATH that counts each invocation (one line per call) and then runs the real git. */
async function countingGit<T>(dir: string, body: () => Promise<T>): Promise<{ value: T; calls: number }> {
  const real = execFileSync("/bin/sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
  const log = join(dir, "calls");
  await mkdir(dir, { recursive: true });
  writeFileSync(log, "");
  writeFileSync(join(dir, "git"), `#!/bin/sh\necho "$*" >> "${log}"\nexec "${real}" "$@"\n`);
  chmodSync(join(dir, "git"), 0o755);
  const saved = process.env.PATH;
  process.env.PATH = `${dir}:${saved ?? ""}`;
  try { const value = await body(); return { value, calls: readFileSync(log, "utf8").split("\n").filter((line) => line.length > 0).length }; }
  finally { process.env.PATH = saved; }
}

describe("exporting a dir group's requirement document into the vault (D4)", () => {
  it("makes base, placed = base and a one-parent document commit on base in the vault, records placement, and leaves the folder byte-equal", async () => {
    const { x, vault, v, ref, text } = await accepted();
    try {
      const before = digestTree(x.folder);
      expect(ref("refs/orca/group/r/base")).toBeNull();
      expect(await exportPendingRequirements(deps(x))).toBe(true);
      expect(wake(x)).toEqual({ delivered: 1 });
      const base = ref("refs/orca/group/r/base")!, tip = ref("refs/heads/orca/r")!;
      expect(ref("refs/orca/group/r/placed")).toBe(base);
      // The base is an import of the folder (its own .decisions/ left out), never the folder's HEAD.
      expect(v("for-each-ref", "--format=%(objectname)", "refs/orca/import/").split("\n")).toContain(base);
      expect(v("ls-tree", "--name-only", base, "--", ".decisions")).toBe("");
      expect(v("show", `${base}:src/export.ts`)).toBe("export {};");
      // DR21: exactly one parent, the base; it adds only the document, with the frozen bytes.
      expect(v("rev-list", "--parents", "-n", "1", tip)).toBe(`${tip} ${base}`);
      const exported = exportOf(x);
      expect(exported).toEqual({ state: "done", path: exported.path, commit: tip, parent: base, detail: null });
      expect(v("diff-tree", "--no-commit-id", "--name-only", "-r", tip)).toBe(exported.path);
      expect(v("show", `${tip}:${exported.path}`)).toBe(text.trimEnd());
      expect(placementOf(x)).toEqual({ state: "idle", tip: base, landedTip: tip, pending: null, changed: [], changedTotal: 0, unwritable: [], unwritableTotal: 0, stopRecord: null,
        withheld: [], watch: null, detail: null, resolution: null, at: expect.any(Number) });
      // The person's folder, its .git included, is untouched: no ref, no object, no file.
      expect(digestTree(x.folder)).toBe(before);
      expect(existsSync(join(x.folder, ".orca"))).toBe(false);
      expect(realpathSync(vault)).not.toBe(realpathSync(join(x.folder, ".git")));
    } finally { await x.dispose(); }
  });

  it("waits while a prerequisite is not done: no git child, wake undelivered, nothing created, no progress; exports once it is gone", async () => {
    const { x, ref } = await accepted();
    try {
      x.store.db.prepare("INSERT INTO groups(id,revision,graph_version,body) VALUES ('p',0,0,'{}')").run();
      x.store.db.prepare("INSERT INTO group_edges(from_group,to_group,body) VALUES ('p','r','{}')").run();
      const refsBefore = x.vaultGit(join(x.env.ORCA_VAULT_DIR!, `${vaultKeyOf(realpathSync(x.folder).normalize("NFC"))}.git`), ["for-each-ref"]);
      const before = digestTree(x.folder);
      const { value: progressed, calls } = await countingGit(join(x.root, "count"), () => exportPendingRequirements(deps(x)));
      expect(calls).toBe(0);
      expect(progressed).toBe(false);
      expect(wake(x)).toEqual({ delivered: 0 });
      expect(exportOf(x).state).toBe("pending");
      expect(placementOf(x)).toBeUndefined();
      expect(x.vaultGit(join(x.env.ORCA_VAULT_DIR!, `${vaultKeyOf(realpathSync(x.folder).normalize("NFC"))}.git`), ["for-each-ref"])).toBe(refsBefore);
      expect(digestTree(x.folder)).toBe(before);
      // Direct call: the same answer, by name.
      expect(await exportRequirementDocument(deps(x), "r")).toBe("waiting");
      x.store.db.prepare("DELETE FROM group_edges").run();
      expect(await exportPendingRequirements(deps(x))).toBe(true);
      expect(wake(x)).toEqual({ delivered: 1 });
      expect(exportOf(x)).toMatchObject({ state: "done", parent: ref("refs/orca/group/r/base") });
    } finally { await x.dispose(); }
  });

  it("never replaces an existing base and, replayed on a changed folder, creates nothing new", async () => {
    const { x, v, ref } = await accepted();
    try {
      // A base already there (an earlier pass that died after it): the newest import of the folder as it was at the calls.
      const earlier = v("for-each-ref", "--sort=-version:refname", "--count=1", "--format=%(objectname)", "refs/orca/import/");
      v("update-ref", "refs/orca/group/r/base", earlier, "");
      writeFileSync(join(x.folder, "src", "later.ts"), "export const later = 1;\n");
      expect(await exportRequirementDocument(deps(x), "r")).toBe("done");
      expect(ref("refs/orca/group/r/base")).toBe(earlier);
      expect(ref("refs/orca/group/r/placed")).toBe(earlier);
      const tip = ref("refs/heads/orca/r")!;
      expect(v("rev-list", "--parents", "-n", "1", tip)).toBe(`${tip} ${earlier}`);
      const refs = v("for-each-ref"), recorded = exportOf(x), placement = placementOf(x);
      // Replay (the export recorded pending again, the folder changed once more): it finds base, placed and the branch.
      const group = readRequirementGroup(x.store, "r");
      group.requirement.export = { state: "pending", path: null, commit: null, parent: null, detail: null };
      // As if the pass died after the branch and before its transaction: no placement record yet.
      delete (group as { placement?: unknown }).placement;
      x.store.db.prepare("UPDATE groups SET body=? WHERE id='r'").run(JSON.stringify(group));
      writeFileSync(join(x.folder, "src", "later.ts"), "export const later = 2;\n");
      expect(await exportRequirementDocument(deps(x), "r")).toBe("done");
      expect(v("for-each-ref")).toBe(refs);
      expect(exportOf(x)).toEqual(recorded);
      expect(placementOf(x)).toEqual({ ...(placement as object), at: expect.any(Number) });
      expect(placement).toMatchObject({ state: "idle", tip: earlier, landedTip: tip });
    } finally { await x.dispose(); }
  });

  it("refuses a dir group's export without the driver's env, creating nothing (Rule 17: never a default vault)", async () => {
    const { x, v } = await accepted();
    try {
      const refs = v("for-each-ref");
      await expect(exportRequirementDocument({ store: x.store, resolveRepository: x.deps.resolveRepository }, "r")).rejects.toThrow(/needs the driver's env/);
      expect(v("for-each-ref")).toBe(refs);
      expect(exportOf(x).state).toBe("pending");
    } finally { await x.dispose(); }
  });
});

/** Confirms the accepted plan and starts it (the export must be done first, N1 spec §9.3). */
async function confirmAndStart(x: X): Promise<void> {
  const hash = x.profile.profileHash;
  const selections = await resolveGroupSelections({ store: x.store, port: x.deps.router.list()[0]!.port }, "r", "human");
  const confirmed = await x.service.confirm(x.command("confirm", { planHash: readArchivedPlan(x.store, "r").planHash, proposalVersion: readBudgetProposal(x.store, "r").proposalVersion,
    budgetMode: "soft", profileIds: { estimator: "all", worker: "all", handoff: "all", goalReview: "all" }, profileHashes: { estimator: hash, worker: hash, handoff: hash, goalReview: hash },
    contextPolicy: { handoffAtContextTokens: 800_000 }, selectionsHash: selections.selectionsHash! }));
  if ("error" in confirmed) throw new Error(JSON.stringify(confirmed));
  const started = await x.service.start(x.command("start", {}));
  if ("error" in started) throw new Error(JSON.stringify(started));
}
const taskRuns = (x: X) => x.runs().filter((run) => run.workItemId === "exporter");

describe("dispatch of a dir group (§6.5)", () => {
  it("prepares the task in a worktree of the bare vault at the work branch and hands it to the agent", async () => {
    const { x, vault, ref } = await accepted();
    try {
      expect(await exportPendingRequirements(deps(x))).toBe(true);
      const before = digestTree(x.folder);
      await confirmAndStart(x);
      await x.until(() => x.fake.calls.accept.some((envelope) => envelope.work.kind !== "single-call"));
      const drive = taskRuns(x)[0]!.drive as { targetRepo: string; base: string; workspacePath: string; prepared: boolean };
      expect(drive).toMatchObject({ targetRepo: vault, base: ref("refs/heads/orca/r"), prepared: true });
      const ws = (...args: string[]) => execFileSync("git", ["-C", drive.workspacePath, ...args], { encoding: "utf8" }).trim();
      expect(realpathSync(resolve(drive.workspacePath, ws("rev-parse", "--git-common-dir")))).toBe(realpathSync(vault));
      expect(ws("rev-parse", "HEAD")).toBe(drive.base);
      expect(readFileSync(join(drive.workspacePath, "src", "export.ts"), "utf8")).toBe("export {};\n");
      expect(digestTree(x.folder)).toBe(before);
    } finally { await x.dispose(); }
  });

  it("blocks A2 as dir-base-missing when the vault has no work branch, and never creates one", async () => {
    const { x, v, ref } = await accepted();
    try {
      expect(await exportPendingRequirements(deps(x))).toBe(true);
      await confirmAndStart(x);
      v("update-ref", "-d", "refs/heads/orca/r");
      await x.until(() => taskRuns(x).some((run) => run.state === "blocked"));
      expect(taskRuns(x).find((run) => run.state === "blocked")!.drive).toMatchObject({ blockedAt: "A2", blockedReason: "dir-base-missing" });
      expect(ref("refs/heads/orca/r")).toBeNull();
      expect(x.fake.calls.accept.filter((envelope) => envelope.work.kind !== "single-call")).toEqual([]);
    } finally { await x.dispose(); }
  });
});

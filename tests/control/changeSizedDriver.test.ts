import { existsSync, readdirSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ExecutionDriver } from "../../src/control/executionDriver.js";
import { describe, expect, it } from "vitest";
import { readArtifact } from "../../src/control/archive.js";
import { sha256Canonical } from "../../src/control/canonicalJson.js";
import { checkPathOf, readStartEnvelope } from "../../src/control/executionDriver.js";
import { snapshotV2Schema, verifySnapshotInRepository } from "../../src/control/snapshotV2.js";
import { applySetWorkspaceMode } from "../../src/control/workspaceSettings.js";
import { driverHarness, git } from "./fixtures/driverHarness.js";
import { spyOnGit } from "./fixtures/gitSpy.js";

/**
 * Change-sized runs spec 2026-11-19 (P2; #363 #366) through the driver, against the synthetic ccloop's two shapes: with
 * features.attemptRef "v1" (ccloop P1) and without it (the pinned ccloop 57b6d15, which never advertises it).
 */
const snapshotOf = async (t: Awaited<ReturnType<typeof driverHarness>>, runId: string) => {
  const row = t.h.store.db.prepare("SELECT body FROM outbox WHERE kind='archive' AND json_extract(body,'$.runId')=? ORDER BY rowid DESC LIMIT 1").get(runId);
  const archived = JSON.parse(String(row!.body)) as { snapshot: { artifactId: string; hash: string }; missing: string[]; repoDir: string | null };
  return { archived, bytes: await readArtifact(t.h.store, archived.snapshot) };
};

describe("an older ccloop (no features.attemptRef): today's run, unchanged (§5.8 row 2, §6.2)", () => {
  // Mutation: send the key whatever the features say (refV1 = true) -> the envelope carries attemptDelivery, red; drop the
  // snapshotVersion gate in archiveDriveRun -> a v2 snapshot, red.
  it("sends no key, archives v1 from the result copy, and pins nothing", async () => {
    const t = await driverHarness([{ taskId: "a", tokenBudget: 4_000_000 }], { tokenPolicy: "optional-v1" }); try {
      const runId = await t.claim();
      const driver = t.driver();
      await t.until(driver, () => t.body(runId).drive?.cleanedUp === true);
      const run = t.body(runId);
      const envelope = readStartEnvelope(t.h.store, run);
      expect(envelope.protocol).toBe(4);
      expect(Object.hasOwn(envelope.work, "attemptDelivery")).toBe(false);
      expect(sha256Canonical(envelope)).toBe(run.drive.envelopeHash);
      expect(run.drive.snapshotVersion).toBeUndefined();
      expect(run.drive.runRef).toBeUndefined();
      const { archived, bytes } = await snapshotOf(t, runId);
      expect(JSON.parse(bytes.toString()).version).toBe(1);
      expect(archived.repoDir).not.toBeNull();
      expect(git(t.repo, "for-each-ref", "--format=%(refname)", "refs/orca/runs/")).toBe("");
      expect(t.body(runId).state).toBe("settled");
    } finally { await t.h.dispose(); }
  }, 60_000);
});

describe("ccloop P1 (features.attemptRef v1): the attempt is a pinned ref (§5.3, §5.4, §6.2)", () => {
  // P2-1 / P2-4 at driver level. Mutations: do not pin at C (pin only at E) -> runRef absent at `landed`, red; archive v1 ->
  // no `version: 2`, red; keep fetching the landing from <sourceDir>/repo -> the spy sees that fetch and no incoming
  // update-ref, red.
  // Ruling (P2 review; human approval 「同意这样大改，并且同意改所有必要的判据」): the last mutation used to read "the landing
  // fails (no copy), red". It does not: the pinned attempt is already in the target, so `git fetch <missing path>
  // +<oid>:<ref>` takes fetch's quickfetch path and exits 0 without connecting (measured, any git config). The landing's
  // git calls are therefore counted directly (fixtures/gitSpy.ts).
  it("sends the key on protocol 4, pins ccloop's attempt at C, lands it, and archives snapshot v2 with no result copy", async () => {
    const spy = spyOnGit();
    const t = await driverHarness([{ taskId: "a", tokenBudget: 4_000_000 }], { tokenPolicy: "optional-v1", attemptRef: true }); try {
      const runId = await t.claim();
      const driver = t.driver();
      await t.until(driver, () => ["landed", "settled"].includes(t.body(runId).state));
      const atLanding = t.body(runId);
      const envelope = readStartEnvelope(t.h.store, atLanding);
      expect(envelope.work.kind === "loop" && envelope.work.attemptDelivery).toBe("ref-v1");
      expect(atLanding.drive).toMatchObject({ snapshotVersion: 2, attemptDelivery: "ref-v1", attemptSource: "ccloop-published" });
      expect(atLanding.drive.runRef).toEqual({ ref: `refs/orca/runs/${runId}`, sha: atLanding.drive.attemptSha });
      expect(git(t.repo, "rev-parse", `refs/orca/runs/${runId}`)).toBe(atLanding.drive.attemptSha);
      await t.until(driver, () => t.body(runId).drive?.cleanedUp === true);
      const run = t.body(runId);
      expect(run.state).toBe("settled");
      expect(existsSync(`${run.drive.sourceDir}/repo`)).toBe(false);
      expect(git(t.repo, "show", `${run.drive.landedCommit}:a`)).toBe("a");
      const { archived, bytes } = await snapshotOf(t, runId);
      expect(archived).toMatchObject({ repoDir: null, missing: [] });
      const snapshot = snapshotV2Schema.parse(JSON.parse(bytes.toString()));
      expect(snapshot).toMatchObject({ version: 2, base: run.drive.base, attempt: run.drive.attemptSha, head: run.drive.attemptSha, ref: `refs/orca/runs/${runId}`, source: "ccloop-published" });
      await expect(verifySnapshotInRepository(t.h.store, archived.snapshot, () => t.repo)).resolves.toMatchObject({ attempt: run.drive.attemptSha });
      // driverSettle.test.ts:102's intent, in its P2 form: cleanup leaves exactly the pin under refs/orca/ (no incoming ref).
      expect(git(t.repo, "for-each-ref", "--format=%(refname) %(objectname)", "refs/orca/")).toBe(`refs/orca/runs/${runId} ${run.drive.attemptSha}`);
      expect(readdirSync(run.drive.sourceDir)).not.toContain("repo");
      // The landing set the incoming ref in the target and nothing fetched from the run's source directory.
      const calls = spy.calls();
      expect(calls.filter((call) => call.args.includes("fetch") && call.args.some((arg) => arg.startsWith(run.drive.sourceDir)))).toEqual([]);
      expect(calls.filter((call) => call.args.includes("update-ref") && call.args.includes(`refs/orca/incoming/${runId}`) && call.args.includes(run.drive.attemptSha))).toHaveLength(1);
    } finally { spy.restore(); await t.h.dispose(); }
  }, 60_000);

  // §5.8 row 2 / P2-10: protocol 3 never carries the key (the schema refuses it there), but the ccloop reads v2, so the run
  // archives v2 from Orca's own commit of its result copy, with head = the copy's HEAD before that commit, and the copy goes.
  // Mutation: record `head` after commitAttempt -> head = attempt, red.
  it("a legacy-envelope run archives v2 from Orca's commit and deletes the result copy", async () => {
    const t = await driverHarness([{ taskId: "a" }], { attemptRef: true }); try {
      const runId = await t.claim();
      const driver = t.driver();
      await t.until(driver, () => t.body(runId).drive?.cleanedUp === true);
      const run = t.body(runId);
      const envelope = readStartEnvelope(t.h.store, run);
      expect(envelope.protocol).toBe(3);
      expect(Object.hasOwn(envelope.work, "attemptDelivery")).toBe(false);
      expect(run.drive).toMatchObject({ snapshotVersion: 2, attemptSource: "orca-commit" });
      expect(run.drive.attemptDelivery).toBeUndefined();
      const { bytes } = await snapshotOf(t, runId);
      const snapshot = snapshotV2Schema.parse(JSON.parse(bytes.toString()));
      expect(snapshot).toMatchObject({ source: "orca-commit", attempt: run.drive.attemptSha, head: run.drive.base });
      expect(git(t.repo, "rev-parse", `${run.drive.attemptSha}^`)).toBe(run.drive.base);
      expect(existsSync(`${run.drive.sourceDir}/repo`)).toBe(false);
    } finally { await t.h.dispose(); }
  }, 60_000);

  // P2-1: clone mode. Mutation: pin at E after the workspace cleanup -> refs/ccloop died with the clone, the fetch fails, red.
  it("in clone mode the pin is in the target and outlives the workspace", async () => {
    const t = await driverHarness([{ taskId: "a", tokenBudget: 4_000_000 }], { tokenPolicy: "optional-v1", attemptRef: true }); try {
      applySetWorkspaceMode({ store: t.h.store, knownRepository: () => true }, { schema: "orca-raw-command-v1", commandId: "mode", expectedRevision: 0, actorId: "human", verb: "set-workspace-mode", target: { kind: "repository", repoId: "repo" }, payload: { workspaceMode: "clone" } });
      const runId = await t.claim();
      const driver = t.driver();
      await t.until(driver, () => t.body(runId).drive?.cleanedUp === true);
      const run = t.body(runId);
      expect(run.drive.workspaceMode).toBe("clone");
      expect(existsSync(run.drive.workspacePath)).toBe(false);
      expect(git(t.repo, "rev-parse", `refs/orca/runs/${runId}`)).toBe(run.drive.attemptSha);
    } finally { await t.h.dispose(); }
  }, 60_000);
});

describe("a check worktree never outlives its run (§5.3, §9)", () => {
  // P2 review: check-<runId> is a full checkout registered in the person's repository. It is removed after the verdict and
  // remade on a restart, but a run that leaves `accepted` while its check is in flight (or whose marker write lost a race
  // after the worktree was made) never reaches either; spec §9 promises "at settle at the latest". Planted here as such a
  // run leaves it. Mutation: drop the check worktree's removal from cleanupRunWorkspace -> it is still there and still
  // registered in the target after cleanedUp, red.
  it("removes a check worktree the run left behind when the run's workspace is cleaned up", async () => {
    const t = await driverHarness([{ taskId: "a", tokenBudget: 4_000_000 }], { tokenPolicy: "optional-v1", attemptRef: true }); try {
      const runId = await t.claim();
      const check = checkPathOf(t.deps.roots, runId);
      git(t.repo, "worktree", "add", "-q", "--detach", check, "HEAD");
      const driver = t.driver();
      await t.until(driver, () => t.body(runId).drive?.cleanedUp === true);
      expect(t.body(runId).state).toBe("settled");
      expect(existsSync(check)).toBe(false);
      expect(git(t.repo, "worktree", "list", "--porcelain")).not.toContain(`check-${runId}`);
    } finally { await t.h.dispose(); }
  }, 60_000);
});

describe("a v2 run's check commands run in a check worktree of the target (§5.3)", () => {
  async function settle(driver: ExecutionDriver, predicate: () => boolean, ms = 60_000): Promise<void> {
    const deadline = Date.now() + ms;
    while (!predicate()) {
      if (Date.now() > deadline) throw new Error("the driver did not reach the expected state in time");
      await driver.round();
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  const CHECK = "test \"$(cut -d' ' -f2 tests/value.test.txt)\" = \"$(cat src/value.txt)\"";
  // criteriaBaseRun.test.ts:248's intent for a v2 run (spec §11.1 P2 row): the base re-run's setup output is neither left
  // nor archived. Mutations: skip the check worktree's removal after the verdict -> check-<runId> exists, red; run the
  // re-run in <sourceDir>/repo -> a keyed run has none, the re-run cannot start, red.
  it("re-runs a modified check at base in check-<runId>, removes it after the verdict, and archives no setup output", async () => {
    const install = "mkdir -p node_modules/x && touch node_modules/x/index.js";
    const t = await driverHarness([{ taskId: "a", tokenBudget: 4_000_000, targetPaths: ["tests/**", "src/**", "a"], contextExtra: { setupCommands: [install] } }],
      { tokenPolicy: "optional-v1", attemptRef: true, files: () => ({ "tests/value.test.txt": "expect 4 # reworded\n" }), requiredChecks: [CHECK] });
    try {
      await mkdir(join(t.repo, "tests"), { recursive: true }); await mkdir(join(t.repo, "src"), { recursive: true });
      await writeFile(join(t.repo, "tests", "value.test.txt"), "expect 4\n"); await writeFile(join(t.repo, "src", "value.txt"), "4\n");
      await writeFile(join(t.repo, ".gitignore"), "node_modules/\n");
      git(t.repo, "add", "tests", "src", ".gitignore"); git(t.repo, "commit", "-qm", "checks");
      const runId = await t.claim();
      const driver = t.driver();
      await settle(driver, () => t.body(runId).drive?.landedCommit != null || t.body(runId).state === "blocked");
      const run = t.body(runId);
      expect(run.drive.blockedReason).toBeNull();
      expect(run.drive.criteriaBase).toEqual({ result: "passed" });
      expect(run.drive.attemptDelivery).toBe("ref-v1");
      expect(existsSync(checkPathOf(t.deps.roots, runId))).toBe(false);
      expect(existsSync(join(run.drive.sourceDir, "repo"))).toBe(false);
      const tree = git(t.repo, "ls-tree", "-r", "--name-only", run.drive.attemptSha).split("\n");
      expect(tree).toContain("src/value.txt");
      expect(tree.filter((path) => path.includes("node_modules"))).toEqual([]);
      expect(git(t.repo, "worktree", "list", "--porcelain")).not.toContain(`check-${runId}`);
    } finally { await t.h.dispose(); }
  }, 90_000);
});

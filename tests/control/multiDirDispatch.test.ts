/**
 * Multi-directory projects spec §7.1-§7.4, criterion M7: A2 for a multi group's run gives only the written directories a
 * workspace, in registered order; the extra workspaces are flat leaves of the workspaces root; the drive record and the
 * frozen envelope name the same keys, targets and bases; the runtime contract's additionalRepos point at those
 * workspaces; skills stay on the primary; a continuation or a saved-result recovery is refused by name; a live registry
 * edit after the group froze changes nothing; a single-directory task keeps today's exact envelope.
 *
 * The harness is the synthetic ccloop of driverHarness.ts: the group's `multiDir` and the work item's `writes` are written
 * after confirmation (they are what the registry and the split freeze), before the first claim.
 */
import { existsSync } from "node:fs";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { stepA1, stepA2 } from "../../src/control/executionDriver.js";
import { controlRepoKey } from "../../src/panel/controlOptions.js";
import { flowVaultRepoId } from "../../src/flow/groups.js";
import { readWorkClaimEnvelope } from "../../src/control/webDispatch.js";
import { sha256Canonical } from "../../src/control/canonicalJson.js";
import { toStartEnvelope } from "../../src/control/startEnvelope.js";
import { controlWorkspaceRoots, extraWorkspacePathOf, workspacePathOf } from "../../src/control/workspace.js";
import type { LoopWork } from "../../src/control/executionPort.js";
import { driverHarness, git, type HarnessOptions } from "./fixtures/driverHarness.js";
import { requestState, stop } from "./fixtures/handoffHarness.js";

const alphaKey = controlRepoKey("alpha"), betaKey = controlRepoKey("beta");

/** A world with a second real repository, "alpha", beside the fixture's "repo". */
const withAlpha = (root: string): Promise<Record<string, string>> => (async () => {
  const alpha = join(root, "alpha");
  await mkdir(alpha);
  git(alpha, "init", "-q", "-b", "main");
  await writeFile(join(alpha, "base.txt"), "alpha\n");
  git(alpha, "add", "base.txt");
  git(alpha, "commit", "-qm", "alpha");
  return { [alphaKey]: await realpath(alpha) };
})();

type Driver = Awaited<ReturnType<typeof driverHarness>>;
type Write = { dir: string; targetPaths: string[]; checks: string[] };
type FrozenMember = { key: string; repoId: string; kind?: "repo" | "dir"; dirWorkspace?: { dir: string; vaultId: string } };

/** The registry freeze and the split's writes, written where `requirement-open` and an accepted split leave them. */
function freeze(t: Driver, dirs: FrozenMember[], writes: Record<string, Write[]>): void {
  const group = JSON.parse(String(t.h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body)) as Record<string, unknown>;
  group.multiDir = { project: "multi", landing: null, dirs: dirs.map((dir) => ({ kind: "repo", ...dir })) };
  t.h.store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify(group));
  for (const [taskId, list] of Object.entries(writes)) {
    const row = t.h.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id=?").get(taskId)!;
    const work = JSON.parse(String(row.body)) as Record<string, unknown>;
    work.writes = list;
    t.h.store.db.prepare("UPDATE work_items SET body=? WHERE group_id='g' AND id=?").run(JSON.stringify(work), taskId);
  }
}

const options = (extra: Omit<HarnessOptions, "repositories"> = {}): HarnessOptions => ({ repositories: withAlpha, ...extra });
const editRun = (t: Driver, runId: string, edit: (body: Record<string, unknown>) => void): void => {
  const body = t.body(runId) as Record<string, unknown>;
  edit(body);
  t.h.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify(body), runId);
};

describe("A2 for a multi group's run (§7.1)", () => {
  it("gives only the written directories a workspace, in registered order, and names them everywhere", async () => {
    const t = await driverHarness([{ taskId: "a", targetPaths: ["**"], contextExtra: {
      repoKey: "main", additionalRepos: [{ key: "alpha", repoPath: "/unused/alpha", targetPaths: ["alpha/**"], allowlistPaths: [] }],
    } }], options());
    // Frozen with an unwritten third member; the writes arrive in reverse registered order.
    freeze(t, [{ key: "main", repoId: "repo" }, { key: "alpha", repoId: alphaKey }, { key: "beta", repoId: betaKey }], {
      a: [{ dir: "alpha", targetPaths: ["alpha/**"], checks: [] }, { dir: "main", targetPaths: ["**"], checks: [] }],
    });
    const runId = await t.claim();
    const driver = t.driver();
    await t.until(driver, () => t.fake.calls.accept.length === 1, 10);
    const drive = t.body(runId).drive, roots = controlWorkspaceRoots(t.h.store.stateDir), alpha = t.repositories[alphaKey]!;
    expect(drive.dirs.map((dir: { key: string }) => dir.key)).toEqual(["main", "alpha"]);
    expect(drive.dirs.map((dir: { targetRepo: string }) => dir.targetRepo)).toEqual([t.repo, alpha]);
    expect(drive.targetRepo).toBe(t.repo);
    expect(drive.base).toBe(drive.dirs[0].base);
    // The primary keeps today's path; an extra is a flat leaf of the workspaces root, not a directory of its own.
    expect(drive.workspacePath).toBe(workspacePathOf(roots, runId));
    expect(drive.dirs[1].workspacePath).toBe(extraWorkspacePathOf(roots, runId, "alpha"));
    expect(join(roots.workspacesRoot, `${runId}.dir-alpha`)).toBe(drive.dirs[1].workspacePath);
    expect(existsSync(drive.dirs[1].workspacePath)).toBe(true);
    expect(existsSync(join(roots.workspacesRoot, `${runId}.dir-beta`))).toBe(false);
    const work = t.fake.calls.accept[0]!.work as LoopWork;
    expect(work.additionalRepos).toEqual([{ key: "alpha", targetRepo: alpha, base: drive.dirs[1].base }]);
    const context = (work.contract as { context: { repoPath: string; additionalRepos: Array<{ key: string; repoPath: string }> } }).context;
    expect(context.repoPath).toBe(drive.dirs[0].workspacePath);
    expect(context.additionalRepos).toEqual([expect.objectContaining({ key: "alpha", repoPath: drive.dirs[1].workspacePath })]);
  });

  it("refuses a continuation and a saved-result recovery before any workspace is made", async () => {
    const continuation = await driverHarness([{ taskId: "a", targetPaths: ["**"] }], options());
    freeze(continuation, [{ key: "main", repoId: "repo" }, { key: "alpha", repoId: alphaKey }], { a: [{ dir: "main", targetPaths: ["**"], checks: [] }] });
    const continuationRun = await continuation.claim();
    await continuation.driver().round();
    editRun(continuation, continuationRun, (body) => { body.continuationIntentId = "intent-1"; });
    await continuation.driver().round();
    expect(continuation.body(continuationRun).drive.blockedReason).toBe("multi-dir-continuation-unsupported");

    const saved = await driverHarness([{ taskId: "a", targetPaths: ["**"] }], options());
    freeze(saved, [{ key: "main", repoId: "repo" }, { key: "alpha", repoId: alphaKey }], { a: [{ dir: "main", targetPaths: ["**"], checks: [] }] });
    const savedRun = await saved.claim();
    await saved.driver().round();
    editRun(saved, savedRun, (body) => { body.mode = "verify-saved-result"; });
    await saved.driver().round();
    expect(saved.body(savedRun).drive.blockedReason).toBe("multi-dir-recovery-unsupported");
  });

  it("blocks a dir member whose work branch is missing", async () => {
    const vaultId = "ab".repeat(32);
    const t = await driverHarness([{ taskId: "a", targetPaths: ["**"] }], {
      repositories: async (root) => {
        const vault = join(root, "vault");
        await mkdir(vault);
        git(vault, "init", "-q", "-b", "main");
        await writeFile(join(vault, "base.txt"), "vault\n");
        git(vault, "add", "base.txt");
        git(vault, "commit", "-qm", "vault");
        return { ...(await withAlpha(root)), [flowVaultRepoId(vaultId)]: await realpath(vault) };
      },
    });
    freeze(t, [{ key: "main", repoId: "repo" }, { key: "alpha", repoId: "unused", kind: "dir", dirWorkspace: { dir: "/unused", vaultId } }], {
      a: [{ dir: "main", targetPaths: ["**"], checks: [] }, { dir: "alpha", targetPaths: ["**"], checks: [] }],
    });
    const runId = await t.claim();
    await t.until(t.driver(), () => t.body(runId).drive?.blockedReason === "dir-base-missing", 10);
    expect(t.body(runId).drive.blockedAt).toBe("A2");
    expect(t.fake.calls.accept).toHaveLength(0);
  });

  it("dispatches from the frozen list even when the live registry would say otherwise", async () => {
    const t = await driverHarness([{ taskId: "a", targetPaths: ["**"], contextExtra: {
      repoKey: "main", additionalRepos: [{ key: "alpha", repoPath: "/unused/alpha", targetPaths: ["alpha/**"], allowlistPaths: [] }],
    } }], options({ multiDirProjectOf: () => ({ dirs: [{ key: "main", name: "main", repoId: "repo", kind: "repo" as const, path: "/live/main" },
      { key: "beta", name: "beta", repoId: betaKey, kind: "repo" as const, path: "/live/beta" }] }) }));
    freeze(t, [{ key: "main", repoId: "repo" }, { key: "alpha", repoId: alphaKey }], {
      a: [{ dir: "main", targetPaths: ["**"], checks: [] }, { dir: "alpha", targetPaths: ["alpha/**"], checks: [] }],
    });
    const runId = await t.claim();
    await t.until(t.driver(), () => t.fake.calls.accept.length === 1, 10);
    const work = t.fake.calls.accept[0]!.work as LoopWork;
    expect(work.additionalRepos!.map((repo) => repo.key)).toEqual(["alpha"]);
    expect(t.body(runId).drive.dirs.map((dir: { key: string }) => dir.key)).toEqual(["main", "alpha"]);
  });

  it("keeps a single-directory task's envelope byte-identical to one without multi injection", async () => {
    const t = await driverHarness([{ taskId: "a", targetPaths: ["**"] }], options());
    freeze(t, [{ key: "main", repoId: "repo" }, { key: "alpha", repoId: alphaKey }], { a: [{ dir: "main", targetPaths: ["**"], checks: [] }] });
    const runId = await t.claim();
    await t.until(t.driver(), () => t.fake.calls.accept.length === 1, 10);
    const envelope = t.fake.calls.accept[0]!, drive = t.body(runId).drive;
    expect(envelope.work).not.toHaveProperty("additionalRepos");
    expect((envelope.work as LoopWork).contract as object).not.toHaveProperty("context.additionalRepos");
    expect(drive.dirs).toHaveLength(1);
    expect(drive.dirs[0].workspacePath).toBe(workspacePathOf(controlWorkspaceRoots(t.h.store.stateDir), runId));
    // The same envelope toStartEnvelope builds from this run without an additionalRepos entry: the same bytes and hash.
    const rebuilt = toStartEnvelope(readWorkClaimEnvelope(t.h.store, "g", runId), { ...t.body(runId) },
      { sourceDir: drive.sourceDir, targetRepo: drive.targetRepo, base: drive.base }, (envelope.work as LoopWork).contract);
    expect(sha256Canonical(rebuilt)).toBe(drive.envelopeHash);
  });

  it("removes the flat extra workspace when the run's workspace is cleaned up", async () => {
    const t = await driverHarness([{ taskId: "a", targetPaths: ["**"], contextExtra: {
      repoKey: "main", additionalRepos: [{ key: "alpha", repoPath: "/unused/alpha", targetPaths: ["alpha/**"], allowlistPaths: [] }],
    } }], options());
    freeze(t, [{ key: "main", repoId: "repo" }, { key: "alpha", repoId: alphaKey }], {
      a: [{ dir: "main", targetPaths: ["**"], checks: [] }, { dir: "alpha", targetPaths: ["alpha/**"], checks: [] }],
    });
    const runId = await t.claim();
    const driver = t.driver();
    await t.until(driver, () => t.body(runId).drive?.prepared === true, 10);
    const drive = t.body(runId).drive;
    expect(existsSync(drive.workspacePath)).toBe(true);
    expect(existsSync(drive.dirs[1].workspacePath)).toBe(true);
    // A settled run is where stepE's cleanup acts; E is reached directly, without a landing this task does not implement.
    editRun(t, runId, (body) => { body.state = "settled"; });
    await driver.round();
    expect(t.body(runId).drive.cleanedUp).toBe(true);
    expect(existsSync(drive.workspacePath)).toBe(false);
    expect(existsSync(drive.dirs[1].workspacePath)).toBe(false);
  });

  it("blocks a multi run whose frozen writes name no directory, instead of failing on it", async () => {
    const t = await driverHarness([{ taskId: "a", targetPaths: ["**"] }], options());
    freeze(t, [{ key: "main", repoId: "repo" }, { key: "alpha", repoId: alphaKey }], { a: [] });
    const runId = await t.claim();
    await t.until(t.driver(), () => t.body(runId).drive?.blockedReason === "multi-dir-writes-missing", 10);
    expect(t.body(runId).drive.blockedAt).toBe("A2");
  });

  it("records the directories it made before a later A2 block, so their workspaces can be found", async () => {
    const t = await driverHarness([{ taskId: "a", targetPaths: ["**"], contextExtra: {
      repoKey: "main", additionalRepos: [
        { key: "alpha", repoPath: "/unused/alpha", targetPaths: ["alpha/**"], allowlistPaths: [] },
        { key: "beta", repoPath: "/unused/beta", targetPaths: ["beta/**"], allowlistPaths: [] },
      ],
    } }], options());
    freeze(t, [{ key: "main", repoId: "repo" }, { key: "alpha", repoId: alphaKey }], {
      a: [{ dir: "main", targetPaths: ["**"], checks: [] }, { dir: "alpha", targetPaths: ["alpha/**"], checks: [] }],
    });
    const runId = await t.claim();
    await t.until(t.driver(), () => t.body(runId).drive?.blockedReason === "multi-dir-contract:beta", 10);
    expect(t.body(runId).drive.blockedAt).toBe("A2");
    expect(t.body(runId).drive.prepared).not.toBe(true);
    const dirs = t.body(runId).drive.dirs as Array<{ key: string; workspacePath: string }>;
    expect(dirs.map((dir) => dir.key)).toEqual(["main", "alpha"]);
    for (const dir of dirs) expect(existsSync(dir.workspacePath)).toBe(true);
  });

  it("removes every extra workspace when a stopped run ccloop never saw is restarted", async () => {
    const t = await driverHarness([{ taskId: "a", targetPaths: ["**"], contextExtra: {
      repoKey: "main", additionalRepos: [{ key: "alpha", repoPath: "/unused/alpha", targetPaths: ["alpha/**"], allowlistPaths: [] }],
    } }], options({ behaviour: () => "stoppable" }));
    freeze(t, [{ key: "main", repoId: "repo" }, { key: "alpha", repoId: alphaKey }], {
      a: [{ dir: "main", targetPaths: ["**"], checks: [] }, { dir: "alpha", targetPaths: ["alpha/**"], checks: [] }],
    });
    const runId = await t.claim();
    expect(stepA1(t.deps, runId)).toBe(true);
    expect(await stepA2(t.deps, runId)).toBe(true);
    const drive = t.body(runId).drive;
    expect(existsSync(drive.workspacePath)).toBe(true);
    expect(existsSync(drive.dirs[1].workspacePath)).toBe(true);
    const [requestId] = await stop(t);
    await t.until(t.driver(), () => requestState(t, requestId!) === "settled-restartable");
    expect(t.fake.calls.accept).toHaveLength(0);
    expect(t.body(runId).drive).toMatchObject({ cleanedUp: true, cleanupError: null });
    expect(existsSync(drive.workspacePath)).toBe(false);
    expect(existsSync(drive.dirs[1].workspacePath)).toBe(false);
  });
});

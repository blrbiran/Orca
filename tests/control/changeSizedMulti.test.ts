/**
 * Change-sized runs spec 2026-11-19 §5.7 (P2-9; #363 #366): a multi-directory run under a ccloop that reads snapshot v2.
 * Each extra directory's attempt is pinned at refs/orca/runs/<runId> in its own target (drive.dirs[i].runRef), the landing
 * reads it there, and a settle that did not land drops `repos/` once every extra is pinned. The harness is the synthetic
 * ccloop of driverHarness.ts; the group's `multiDir` and the work item's `writes` are written after confirmation, before
 * the first claim, as multiDirDispatch.test.ts does.
 */
import { existsSync } from "node:fs";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readStartEnvelope, stepCleanupFailed } from "../../src/control/executionDriver.js";
import { controlRepoKey } from "../../src/panel/controlOptions.js";
import { applySetWorkspaceMode } from "../../src/control/workspaceSettings.js";
import { driverHarness, git, type HarnessOptions } from "./fixtures/driverHarness.js";
import { requestState, stop } from "./fixtures/handoffHarness.js";
import { spyOnGit } from "./fixtures/gitSpy.js";

const alphaKey = controlRepoKey("alpha");
type Driver = Awaited<ReturnType<typeof driverHarness>>;

const withAlpha = (root: string): Promise<Record<string, string>> => (async () => {
  const alpha = join(root, "alpha");
  await mkdir(alpha);
  git(alpha, "init", "-q", "-b", "main");
  await writeFile(join(alpha, "base.txt"), "alpha\n");
  git(alpha, "add", "base.txt");
  git(alpha, "commit", "-qm", "alpha");
  return { [alphaKey]: await realpath(alpha) };
})();

const CONTEXT = { repoKey: "main", additionalRepos: [{ key: "alpha", repoPath: "/unused/alpha", targetPaths: ["alpha/**"], allowlistPaths: [] }] };

/** The registry freeze and the split's writes: "main" (the fixture's repo) first, then "alpha". */
function freeze(t: Driver): void {
  const group = JSON.parse(String(t.h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body)) as Record<string, unknown>;
  group.multiDir = { project: "multi", landing: null, dirs: [{ key: "main", repoId: "repo", kind: "repo" }, { key: "alpha", repoId: alphaKey, kind: "repo" }] };
  t.h.store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify(group));
  const row = t.h.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id='a'").get()!;
  const work = JSON.parse(String(row.body)) as Record<string, unknown>;
  work.writes = [{ dir: "main", targetPaths: ["**"], checks: [] }, { dir: "alpha", targetPaths: ["alpha/**"], checks: [] }];
  t.h.store.db.prepare("UPDATE work_items SET body=? WHERE group_id='g' AND id='a'").run(JSON.stringify(work));
}

const refsUnderOrca = (repo: string): string => git(repo, "for-each-ref", "--format=%(refname) %(objectname)", "refs/orca/");

describe("a keyed multi-directory run pins each extra in its own target (§5.7, P2-9)", () => {
  // Mutations: stepC does not pin extras (no dirPins) -> dirs[1].runRef absent at the landing, red; produceMultiMerge always
  // fetches from repos/<key> -> the spy sees that fetch and no incoming update-ref in alpha, red (Ruling, P2 review; human
  // approval 「同意这样大改，并且同意改所有必要的判据」: this used to claim "a keyed run has no repos/, the landing fails". It
  // does not -- the pinned attempt is in alpha, so the fetch takes git's quickfetch path and exits 0 without connecting;
  // fixtures/gitSpy.ts); stepA2Multi never sends the key -> the
  // envelope lacks attemptDelivery, red. Alpha runs in clone mode, so its attempt's objects exist only in its clone (C1)
  // until the pin fetches them: pinning after the workspace cleanup would find nothing to fetch.
  it("sends the key, pins the extra at C in its clone-mode target, lands it from there, and leaves only the pins", async () => {
    const spy = spyOnGit();
    const t = await driverHarness([{ taskId: "a", tokenBudget: 4_000_000, targetPaths: ["**"], contextExtra: CONTEXT }],
      { repositories: withAlpha, tokenPolicy: "optional-v1", attemptRef: true, extraFiles: () => ({ "alpha/x.txt": "x\n" }) } satisfies HarnessOptions);
    try {
      applySetWorkspaceMode({ store: t.h.store, knownRepository: () => true }, { schema: "orca-raw-command-v1", commandId: "mode", expectedRevision: 0, actorId: "human", verb: "set-workspace-mode", target: { kind: "repository", repoId: alphaKey }, payload: { workspaceMode: "clone" } });
      freeze(t);
      const alpha = t.repositories[alphaKey]!;
      const runId = await t.claim();
      const driver = t.driver();
      await t.until(driver, () => t.body(runId).drive?.landedCommit != null || t.body(runId).state === "blocked");
      const landed = t.body(runId);
      expect(landed.drive.blockedReason ?? null).toBeNull();
      const envelope = readStartEnvelope(t.h.store, landed);
      expect(envelope.work.kind === "loop" && envelope.work.attemptDelivery).toBe("ref-v1");
      expect(landed.drive).toMatchObject({ snapshotVersion: 2, attemptDelivery: "ref-v1" });
      const [main, extra] = landed.drive.dirs as Array<{ key: string; attemptSha: string; runRef?: { ref: string; sha: string } }>;
      expect(extra!.key).toBe("alpha");
      expect(extra!.runRef).toEqual({ ref: `refs/orca/runs/${runId}`, sha: extra!.attemptSha });
      expect(landed.drive.runRef).toEqual({ ref: `refs/orca/runs/${runId}`, sha: main!.attemptSha });
      expect(git(alpha, "rev-parse", `refs/orca/runs/${runId}`)).toBe(extra!.attemptSha);
      expect(git(t.repo, "rev-parse", `refs/orca/runs/${runId}`)).toBe(main!.attemptSha);
      await t.until(driver, () => t.body(runId).drive?.cleanedUp === true);
      const run = t.body(runId);
      expect(run.state).toBe("settled");
      expect(git(alpha, "show", "refs/heads/orca/g:alpha/x.txt")).toBe("x");
      expect(git(t.repo, "show", "refs/heads/orca/g:a")).toBe("a");
      expect(existsSync(run.drive.dirs[1].workspacePath)).toBe(false);
      expect([existsSync(join(run.drive.sourceDir, "repo")), existsSync(join(run.drive.sourceDir, "repos"))]).toEqual([false, false]);
      // Cleanup leaves exactly the pin in each target (no incoming ref).
      expect(refsUnderOrca(alpha)).toBe(`refs/orca/runs/${runId} ${extra!.attemptSha}`);
      expect(refsUnderOrca(t.repo)).toBe(`refs/orca/runs/${runId} ${main!.attemptSha}`);
      // Each directory's landing set its incoming ref in its own target, and nothing fetched from the run's source directory.
      const calls = spy.calls();
      expect(calls.filter((call) => call.args.includes("fetch") && call.args.some((arg) => arg.startsWith(run.drive.sourceDir)))).toEqual([]);
      const incoming = (sha: string) => calls.filter((call) => call.args.includes("update-ref") && call.args.includes(`refs/orca/incoming/${runId}`) && call.args.includes(sha));
      expect([incoming(main!.attemptSha).length, incoming(extra!.attemptSha).length]).toEqual([1, 1]);
    } finally { spy.restore(); await t.h.dispose(); }
  }, 90_000);

  // Tester follow-up G §1.1 for a v2 multi run: the no-change proof is measured from each directory's target, where the pins
  // are. Mutation: measure the trees in <sourceDir>/repo and repos/<key> (absent under the key) -> C throws, never landed, red.
  it("proves an empty keyed multi run unchanged from each directory's target", async () => {
    const t = await driverHarness([{ taskId: "a", tokenBudget: 4_000_000, targetPaths: ["**"], contextExtra: CONTEXT }],
      { repositories: withAlpha, tokenPolicy: "optional-v1", attemptRef: true, files: () => ({}) });
    try {
      freeze(t);
      const runId = await t.claim();
      await t.until(t.driver(), () => t.body(runId).state === "landed" || t.body(runId).state === "blocked");
      const drive = t.body(runId).drive;
      expect(t.body(runId).state).toBe("landed");
      const dirs = drive.noChangeDirs as Array<{ key: string; attempt: string; baseTree: string; attemptTree: string }>;
      expect(dirs.map((dir) => dir.key)).toEqual(["main", "alpha"]);
      for (const [index, dir] of dirs.entries()) {
        expect(dir.attempt).toBe(drive.dirs[index].attemptSha);
        expect(dir.attemptTree).toBe(dir.baseTree);
      }
      expect(git(t.repositories[alphaKey]!, "rev-parse", `refs/orca/runs/${runId}^{tree}`)).toBe(dirs[1]!.baseTree);
    } finally { await t.h.dispose(); }
  }, 60_000);

  // §5.4 failure paths: a failed terminal is archived at C, which never ran the success branch's pins. Mutation:
  // archiveDriveRun archives the primary only -> alpha has no pin and dirs[1].runRef is absent, red.
  it("a failed keyed run's archive at C pins the extra too", async () => {
    const t = await driverHarness([{ taskId: "a", tokenBudget: 4_000_000, targetPaths: ["**"], contextExtra: CONTEXT }],
      { repositories: withAlpha, tokenPolicy: "optional-v1", attemptRef: true, behaviour: () => "failed", extraFiles: () => ({ "alpha/x.txt": "x\n" }) });
    try {
      freeze(t);
      const runId = await t.claim();
      await t.until(t.driver(), () => t.body(runId).state === "blocked");
      const run = t.body(runId);
      const alphaSha = git(t.repositories[alphaKey]!, "rev-parse", `refs/orca/runs/${runId}`);
      expect(run.drive.dirs[1].runRef).toEqual({ ref: `refs/orca/runs/${runId}`, sha: alphaSha });
      expect(git(t.repositories[alphaKey]!, "show", `${alphaSha}:alpha/x.txt`)).toBe("x");
    } finally { await t.h.dispose(); }
  }, 60_000);
});

/**
 * §5.7 last bullet, §5.8 row 2 as amended: a legacy-envelope (protocol 3) multi run under a ccloop that reads v2 has
 * `repos/<key>`; Orca commits it, pins it in the extra's target, and the copy goes at a settle that did not land.
 */
describe("a legacy-envelope v2 multi run drops repos/ once every extra is pinned (§5.7)", { timeout: 60_000 }, () => {
  const EXTRA = "alpha's result\n";
  const legacy = async (behaviour: "failed" | "stoppable") => {
    let runId = "";
    let t: Driver;
    // What an older ccloop leaves for an extra: a result repository under <sourceDir>/repos/<key>, cut at the extra's base.
    const duringCollect = async () => {
      const drive = t.body(runId).drive;
      const copy = join(drive.sourceDir, "repos", "alpha");
      if (existsSync(copy)) return;
      git(drive.sourceDir, "clone", "-q", drive.dirs[1].targetRepo, copy);
      git(copy, "checkout", "-q", "--detach", drive.dirs[1].base);
      await writeFile(join(copy, "result.txt"), EXTRA);
    };
    t = await driverHarness([{ taskId: "a", targetPaths: ["**"], contextExtra: CONTEXT }], { repositories: withAlpha, attemptRef: true, behaviour: () => behaviour, duringCollect });
    freeze(t);
    runId = await t.claim();
    return { t, runId, duringCollect };
  };

  // Mutation: stepCleanupFailed keeps {extras:false} for v2 -> repos/ stays, red. Mutation: archiveDriveRun pins the
  // primary only -> extrasPinned is false, repos/ stays, red.
  it("a failed run's cleanup removes repo and repos/, and the extra's result is pinned in its target", async () => {
    const { t, runId } = await legacy("failed"); const driver = t.driver(); try {
      await t.until(driver, () => t.body(runId).state === "blocked");
      const sourceDir = t.body(runId).drive.sourceDir;
      expect(readStartEnvelope(t.h.store, t.body(runId)).protocol).toBe(3);
      expect(existsSync(join(sourceDir, "repos", "alpha"))).toBe(true);
      expect(t.service.retryTask(t.h.command("retry-task", { taskId: "a" }))).not.toHaveProperty("error");
      expect(await stepCleanupFailed(t.deps, runId)).toBe(true);
      const run = t.body(runId);
      expect(run.drive).toMatchObject({ snapshotVersion: 2, cleanedUp: true, cleanupError: null });
      const pin = run.drive.dirs[1].runRef as { ref: string; sha: string };
      expect(pin.ref).toBe(`refs/orca/runs/${runId}`);
      expect(git(t.repositories[alphaKey]!, "show", `refs/orca/runs/${runId}:result.txt`)).toBe(EXTRA.trim());
      expect(git(t.repositories[alphaKey]!, "rev-parse", `refs/orca/runs/${runId}`)).toBe(pin.sha);
      expect([existsSync(join(sourceDir, "repo")), existsSync(join(sourceDir, "repos"))]).toEqual([false, false]);
    } finally { await driver.stop(); await t.h.dispose(); }
  });

  // Mutation: dropResultCopyAfterSettle keeps {extras:false} for v2 -> repos/ stays, red.
  it("a recoverable (handoff) settle removes repo and repos/ once the extra is pinned", async () => {
    const { t, runId, duringCollect } = await legacy("stoppable"); const driver = t.driver(); try {
      await t.until(driver, () => t.body(runId).state === "accepted");
      await duringCollect();
      const sourceDir = t.body(runId).drive.sourceDir;
      const [request] = await stop(t);
      await t.until(driver, () => requestState(t, request!) === "settled-recoverable");
      const run = t.body(runId);
      expect(run.state).toBe("settled-recoverable");
      expect(run.drive.dirs[1].runRef?.ref).toBe(`refs/orca/runs/${runId}`);
      expect([existsSync(join(sourceDir, "repo")), existsSync(join(sourceDir, "repos"))]).toEqual([false, false]);
    } finally { await driver.stop(); await t.h.dispose(); }
  });
});

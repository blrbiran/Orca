import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { flagDecision } from "../../../src/control/flaggedDecisions.js";
import { newGroupIntegration } from "../../../src/control/integrationScheme.js";
import { WebControlService } from "../../../src/control/webService.js";
import { unsetInheritedGitEnv } from "../../../src/control/workspace.js";
import { readRepositorySettingsBody, writeRepositorySettingsBody } from "../../../src/control/workspaceSettings.js";
import type { ChecksLayer } from "../../../src/control/checks/settingsSchema.js";
import { profileSnapshot, webFixture } from "./web.js";

/**
 * Checks spec 2026-10-22 test world: a real git repository whose `main` is the target, a control store, and groups
 * "landed" by writing the integration record the integration pass would write (local delivery, integratedCommit).
 */
export const g = (cwd: string, ...args: string[]): string =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.hooksPath=/dev/null", ...args], { cwd, encoding: "utf8", env: { ...process.env, ...unsetInheritedGitEnv() } }).trim();

export const SYSTEM_MARK = (kind: "ladder" | "integration-check" | "criteria-review") => ({
  source: { kind, groupId: "x", taskId: null, runId: null }, stackOn: null, inputHash: "a".repeat(64), settled: null,
});

export async function checksWorld() {
  let now = Date.parse("2026-10-21T00:00:00.000Z");
  const h = await webFixture(profileSnapshot(), [{ taskId: "a" }]);
  const repo = join(h.root, "repo");
  g(repo, "init", "-q", "-b", "main");
  await writeFile(join(repo, "base.txt"), "base\n");
  g(repo, "add", "base.txt"); g(repo, "commit", "-qm", "base");
  // The project's default delivery is local into main, so its checks know their target before any group lands.
  h.store.transaction(() => writeRepositorySettingsBody(h.store, "repo", { workspaceMode: "worktree", revision: 1, integration: { delivery: "local", trigger: "task", method: "merge", target: "main" } }));
  const service = new WebControlService({ ...h.deps, now: () => new Date(now), knownRepository: (repoId: string) => repoId === "repo", resolveRepository: () => repo });
  const groupBody = (groupId: string) => JSON.parse(String(h.store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId)!.body)) as Record<string, unknown>;
  const ensure = (groupId: string) => { if (h.store.db.prepare("SELECT 1 FROM groups WHERE id=?").get(groupId) === undefined) h.importDeferred(groupId); };
  /** Record `groupId` as merged into `target` at `commit` (default: the target's head). */
  const land = (groupId: string, commit = g(repo, "rev-parse", "main"), extra: Record<string, unknown> = {}, delivery: "local" | "keep" | "push-branch" = "local"): void => {
    ensure(groupId);
    const scheme = delivery === "local" ? { delivery: "local" as const, trigger: "task" as const, method: "merge" as const, target: "main" }
      : delivery === "push-branch" ? { delivery: "push-branch" as const, trigger: "task" as const, target: "main", remote: "origin" } : null;
    // keep has no integration record; a pushed group carries the commit too, so only its delivery keeps it out of a range.
    const integration = scheme === null ? undefined : { ...newGroupIntegration(scheme)!, lastIntegrated: commit, integratedCommit: commit };
    h.store.db.prepare("UPDATE groups SET body=? WHERE id=?").run(JSON.stringify({ ...groupBody(groupId), status: "done", ...(integration === undefined ? {} : { integration }), ...extra }), groupId);
  };
  /** A commit on main that writes the files, then the group landed at it (a fast-forward landing). */
  const commitLand = async (groupId: string, files: Record<string, string>, extra: Record<string, unknown> = {}): Promise<string> => {
    for (const [path, text] of Object.entries(files)) { await mkdir(dirname(join(repo, path)), { recursive: true }); await writeFile(join(repo, path), text); }
    g(repo, "add", "--", ...Object.keys(files)); g(repo, "commit", "-qm", `land ${groupId}`);
    const commit = g(repo, "rev-parse", "main");
    land(groupId, commit, extra);
    return commit;
  };
  /** A branch commit merged into main with --no-ff (a merge landing). */
  const mergeLand = async (groupId: string, files: Record<string, string>): Promise<string> => {
    g(repo, "checkout", "-q", "-b", `orca/${groupId}`);
    for (const [path, text] of Object.entries(files)) { await mkdir(dirname(join(repo, path)), { recursive: true }); await writeFile(join(repo, path), text); }
    g(repo, "add", "--", ...Object.keys(files)); g(repo, "commit", "-qm", `work ${groupId}`);
    g(repo, "checkout", "-q", "main"); g(repo, "merge", "-q", "--no-ff", "-m", `merge ${groupId}`, `orca/${groupId}`);
    const commit = g(repo, "rev-parse", "main");
    land(groupId, commit);
    return commit;
  };
  const setProjectChecks = (checks: ChecksLayer) => {
    const current = readRepositorySettingsBody(h.store, "repo");
    h.store.transaction(() => writeRepositorySettingsBody(h.store, "repo", { ...(current ?? { workspaceMode: "worktree" }), revision: (current?.revision ?? 0) + 1, checks }));
  };
  const flag = (groupId: string, source: string) => h.store.transaction(() => flagDecision(h.store, { decisionId: `${source}:${groupId}`, groupId, runId: null, source, reason: "r", evidence: [], by: "orca-auto", at: new Date(now).toISOString() }));
  /** One pass, then wait for every check it started. */
  const pass = async () => { const out = await service.checksPass(); await service.checksSettled(); return out; };
  return { h, repo, service, land, commitLand, mergeLand, setProjectChecks, flag, pass, groupBody, advance: (ms: number) => { now += ms; }, now: () => now };
}

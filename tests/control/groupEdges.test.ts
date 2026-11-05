import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveGroupSelections } from "../../src/control/agentFreeze.js";
import { stackBaseOf, waitingPrerequisites } from "../../src/control/groupEdges.js";
import { newGroupIntegration } from "../../src/control/integrationScheme.js";
import { initialLanding } from "../../src/control/multiLandingRecord.js";
import { readArchivedPlan, readBudgetProposal } from "../../src/control/queries.js";
import { WebControlService } from "../../src/control/webService.js";
import { ensureWorkBranch, unsetInheritedGitEnv } from "../../src/control/workspace.js";
import { readGroupSummary } from "../../src/panel/controlViews.js";
import { profileSnapshot, webFixture } from "./fixtures/web.js";

// Kanban spec 2026-10-20 §3.3-§3.4, §9a items 1 and 5: a person's edges between groups. Every assertion reads the store,
// the summary, git or a command's answer after the call under test.
type H = Awaited<ReturnType<typeof webFixture>>;
const revisionOf = (h: H, id: string) => Number(h.store.db.prepare("SELECT revision FROM groups WHERE id=?").get(id)!.revision);
const body = (h: H, id: string) => JSON.parse(String(h.store.db.prepare("SELECT body FROM groups WHERE id=?").get(id)!.body)) as Record<string, unknown>;
const setBody = (h: H, id: string, value: Record<string, unknown>) => h.store.db.prepare("UPDATE groups SET body=? WHERE id=?").run(JSON.stringify(value), id);
let sequence = 0;
const edge = (h: H, service: WebControlService, verb: "add-group-dependency" | "remove-group-dependency", dependent: string, dependsOn: string) => {
  const command = h.rawCommand(`edge-${++sequence}`, revisionOf(h, dependent), verb, { kind: "group", groupId: dependent }, { dependsOn }) as never;
  return verb === "add-group-dependency" ? service.addGroupDependency(command) : service.removeGroupDependency(command);
};
const code = (answer: unknown) => (answer as { error?: { code: string } }).error?.code ?? null;
async function confirm(h: H, service: WebControlService, groupId: string) {
  const payload = {
    planHash: readArchivedPlan(h.store, groupId).planHash, proposalVersion: readBudgetProposal(h.store, groupId).proposalVersion, budgetMode: "strict" as const,
    profileIds: { estimator: "all", worker: "all", handoff: "all", goalReview: "all" },
    profileHashes: { estimator: h.frozen.profileHash, worker: h.frozen.profileHash, handoff: h.frozen.profileHash, goalReview: h.frozen.profileHash },
    contextPolicy: { handoffAtContextTokens: 800_000 },
    selectionsHash: (await resolveGroupSelections({ store: h.store, port: h.deps.port }, groupId, "human")).selectionsHash ?? "0".repeat(64),
    ...(readGroupSummary(h.store, groupId).repoId === "repo" && body(h, groupId).integration !== undefined ? { integrationHash: (body(h, groupId).integration as { schemeHash: string }).schemeHash } : {}),
  };
  const answer = await service.confirm(h.rawCommand(`confirm-${groupId}-${++sequence}`, revisionOf(h, groupId), "confirm", { kind: "group", groupId }, payload) as never);
  if ("error" in (answer as object)) throw new Error(JSON.stringify(answer));
}
/** Every task of the group done, as a landing leaves them. */
const finishTasks = (h: H, groupId: string) => {
  for (const row of h.store.db.prepare("SELECT id, body FROM work_items WHERE group_id=?").all(groupId)) {
    const work = JSON.parse(String(row.body)) as Record<string, unknown>;
    if (work.kind === "task") h.store.db.prepare("UPDATE work_items SET body=? WHERE group_id=? AND id=?").run(JSON.stringify({ ...work, status: "done" }), groupId, String(row.id));
  }
};
const LOCAL = { delivery: "local", trigger: "task", method: "merge", target: "main" } as const;

describe("edges between groups (kanban spec §3.3-§3.4)", () => {
  it("a dependent waits for its prerequisite, and starts once the prerequisite's tasks are done (not delivered locally)", async () => {
    const h = await webFixture(profileSnapshot(), [{ taskId: "a" }]); try {
      const service = new WebControlService(h.deps);
      h.importDeferred("p");
      expect(edge(h, service, "add-group-dependency", "g", "p")).toMatchObject({ result: { kind: "group-dependency-added", groupId: "g", dependsOn: "p" } });
      await confirm(h, service, "g");
      expect(readGroupSummary(h.store, "g")).toMatchObject({ dependsOn: ["p"], orchestration: { state: "waiting-prerequisite", waitingFor: ["p"] } });
      // mutation: autoStartPass ignores prerequisites -> started ["g"], red
      expect(await service.autoStart()).toEqual({ started: [], refused: [] });
      finishTasks(h, "p");
      // mutation: prerequisiteDone requires integration for every delivery -> still waiting, red
      expect(waitingPrerequisites(h.store, "g")).toEqual([]);
      expect(await service.autoStart()).toEqual({ started: ["g"], refused: [] });
    } finally { await h.dispose(); }
  });

  it("a prerequisite delivered locally is done only once integrated, with nothing pending", async () => {
    const h = await webFixture(profileSnapshot(), [{ taskId: "a" }]); try {
      const service = new WebControlService(h.deps);
      h.importDeferred("p");
      setBody(h, "p", { ...body(h, "p"), integration: { ...newGroupIntegration(LOCAL)!, frozen: true } });
      edge(h, service, "add-group-dependency", "g", "p");
      finishTasks(h, "p");
      // mutation: drop the local-delivery clause -> [] (done before integration), red
      expect(waitingPrerequisites(h.store, "g")).toEqual(["p"]);
      setBody(h, "p", { ...body(h, "p"), integration: { ...(body(h, "p").integration as object), lastIntegrated: "c".repeat(40), integratedCommit: "c".repeat(40) } });
      expect(waitingPrerequisites(h.store, "g")).toEqual([]);
      // Local delivery: the dependent branches from the target, not from the prerequisite's branch.
      expect(stackBaseOf(h.store, "g")).toBeNull();
    } finally { await h.dispose(); }
  });

  it("waits for a multi prerequisite's local and place directories, and never stacks on it", async () => {
    const h = await webFixture(profileSnapshot(), [{ taskId: "a" }]); try {
      const service = new WebControlService(h.deps);
      h.importDeferred("p");
      edge(h, service, "add-group-dependency", "g", "p");
      finishTasks(h, "p");
      const landing = {
        ...initialLanding([
          { key: "a", scheme: LOCAL },
          { key: "b", scheme: { delivery: "push-target", trigger: "task", method: "merge", target: "main", remote: "origin" } },
          { key: "c", scheme: { delivery: "place" } },
        ], 1),
        state: "landed", lastLanded: { a: "a".repeat(40) },
      };
      const multiDir = { project: "p", dirs: [
        { key: "a", repoId: "repo", kind: "repo" },
        { key: "b", repoId: "other", kind: "repo" },
        { key: "c", repoId: "vault", kind: "dir", dirWorkspace: { dir: h.root, vaultId: "b".repeat(64) } },
      ], landing };
      setBody(h, "p", { ...body(h, "p"), multiDir });
      // The place directory has not landed yet: only its tasks being done is not enough.
      expect(waitingPrerequisites(h.store, "g")).toEqual(["p"]);
      const done = { ...landing, lastLanded: { a: "a".repeat(40), c: "c".repeat(40) } };
      setBody(h, "p", { ...body(h, "p"), multiDir: { ...multiDir, landing: done } });
      // The push-target directory holds no dependent back, so its missing `lastLanded` does not matter.
      expect(waitingPrerequisites(h.store, "g")).toEqual([]);
      // §9.9: a multi group's work is on several branches, so a dependent never stacks on it.
      expect(stackBaseOf(h.store, "g")).toBeNull();
      // A journaled landing is not done.
      setBody(h, "p", { ...body(h, "p"), multiDir: { ...multiDir, landing: { ...done, state: "landing", pending: { plan: [], landed: [], startedAt: 1 } } } });
      expect(waitingPrerequisites(h.store, "g")).toEqual(["p"]);
    } finally { await h.dispose(); }
  });

  it("a blocked prerequisite holds back only its dependent; an unrelated confirmed group still starts", async () => {
    const h = await webFixture(profileSnapshot(), [{ taskId: "a" }]); try {
      const service = new WebControlService(h.deps);
      h.importDeferred("p"); h.importDeferred("free");
      edge(h, service, "add-group-dependency", "g", "p");
      setBody(h, "p", { ...body(h, "p"), status: "blocked" });
      await confirm(h, service, "g");
      await confirm(h, service, "free");
      expect((await service.autoStart()).started).toEqual(["free"]);
      expect(readGroupSummary(h.store, "g").orchestration).toMatchObject({ state: "waiting-prerequisite", waitingFor: ["p"] });
    } finally { await h.dispose(); }
  });

  it("refuses a cycle, a self edge, a second stacked prerequisite, a started dependent; removing a missing edge is a no-op", async () => {
    const h = await webFixture(profileSnapshot(), [{ taskId: "a" }]); try {
      const service = new WebControlService(h.deps);
      h.importDeferred("p"); h.importDeferred("q"); h.importDeferred("r");
      expect(code(edge(h, service, "add-group-dependency", "g", "p"))).toBeNull();
      expect(code(edge(h, service, "add-group-dependency", "p", "q"))).toBeNull();
      // mutation: reaches() returns false -> the cycle q -> g -> p -> q is accepted, red
      expect(code(edge(h, service, "add-group-dependency", "q", "g"))).toBe("group-edge-cycle");
      expect(code(edge(h, service, "add-group-dependency", "g", "g"))).toBe("group-edge-self");
      // g already stacks on p (keep); a second keep prerequisite has no single branch to stack on.
      expect(code(edge(h, service, "add-group-dependency", "g", "r"))).toBe("group-edge-stack-ambiguous");
      expect(code(edge(h, service, "add-group-dependency", "g", "p"))).toBe("no-op-command");
      expect(code(edge(h, service, "add-group-dependency", "g", "nope"))).toBe("group-edge-prerequisite-not-found");
      expect(code(edge(h, service, "remove-group-dependency", "g", "r"))).toBe("no-op-command");
      expect(code(edge(h, service, "remove-group-dependency", "g", "p"))).toBeNull();
      expect(readGroupSummary(h.store, "g").dependsOn).toBeUndefined();
      await confirm(h, service, "r");
      await service.start(h.rawCommand(`start-r-${++sequence}`, revisionOf(h, "r"), "start", { kind: "group", groupId: "r" }, {}) as never);
      expect(code(edge(h, service, "add-group-dependency", "r", "q"))).toBe("group-edge-dependent-started");
    } finally { await h.dispose(); }
  });

  // Issue #133: an explicit start and a resume honour the edges with the automatic start's "done", so a dependent never
  // runs on a base without its prerequisite's work.
  it("refuses a person's start of a dependent whose prerequisite is not done, naming it; starts once it is done", async () => {
    const h = await webFixture(profileSnapshot(), [{ taskId: "a" }]); try {
      const service = new WebControlService(h.deps);
      h.importDeferred("p");
      edge(h, service, "add-group-dependency", "g", "p");
      await confirm(h, service, "g");
      const wakes = () => Number(h.store.db.prepare("SELECT count(*) AS n FROM scheduler_wakes WHERE group_id='g' AND kind='start'").get()!.n);
      const refused = await service.start(h.rawCommand(`start-g-${++sequence}`, revisionOf(h, "g"), "start", { kind: "group", groupId: "g" }, {}) as never);
      // mutation: drop the waitingPrerequisites check in scheduleStart -> scheduled, red
      expect(refused).toMatchObject({ error: { code: "group-dependency-unmet", message: "group-dependency-unmet:p" } });
      expect(wakes()).toBe(0);
      finishTasks(h, "p");
      const started = await service.start(h.rawCommand(`start-g-${++sequence}`, revisionOf(h, "g"), "start", { kind: "group", groupId: "g" }, {}) as never);
      expect(started).toMatchObject({ result: { kind: "scheduled", operation: "start" } });
      expect(wakes()).toBe(1);
    } finally { await h.dispose(); }
  });

  it("refuses resuming a paused, never-run dependent whose prerequisite is not done; the pause stays", async () => {
    const h = await webFixture(profileSnapshot(), [{ taskId: "a" }]); try {
      const service = new WebControlService(h.deps);
      h.importDeferred("p");
      edge(h, service, "add-group-dependency", "g", "p");
      await confirm(h, service, "g");
      const pause = (verb: "pause-dispatch" | "resume-dispatch") => h.rawCommand(`${verb}-${++sequence}`, revisionOf(h, "g"), verb, { kind: "group", groupId: "g" }, {}) as never;
      expect(code(await service.pauseDispatch(pause("pause-dispatch")))).toBeNull();
      // mutation: drop the waitingPrerequisites check in applyResumeDispatch -> scheduled with a start wake, red
      expect(await service.resumeDispatch(pause("resume-dispatch"))).toMatchObject({ error: { code: "group-dependency-unmet", message: "group-dependency-unmet:p" } });
      expect(h.store.db.prepare("SELECT mode FROM stop_intents WHERE group_id='g'").get()).toMatchObject({ mode: "pause" });
      expect(h.store.db.prepare("SELECT count(*) AS n FROM scheduler_wakes WHERE group_id='g' AND kind='start'").get()).toMatchObject({ n: 0 });
      finishTasks(h, "p");
      expect(await service.resumeDispatch(pause("resume-dispatch"))).toMatchObject({ result: { kind: "scheduled", operation: "resume-dispatch" } });
    } finally { await h.dispose(); }
  });

  it("refuses an edge to an archived prerequisite, naming it", async () => {
    const h = await webFixture(profileSnapshot(), [{ taskId: "a" }]); try {
      const service = new WebControlService(h.deps);
      h.importDeferred("p");
      expect(service.archiveGroup(h.rawCommand(`archive-p-${++sequence}`, revisionOf(h, "p"), "archive-group", { kind: "group", groupId: "p" }, {}) as never)).toMatchObject({ result: { kind: "archived" } });
      // mutation: drop the archived check in applyAddGroupDependency -> group-dependency-added, red
      expect(edge(h, service, "add-group-dependency", "g", "p")).toMatchObject({ error: { code: "group-edge-prerequisite-archived", message: "group-edge-prerequisite-archived:p" } });
      expect(readGroupSummary(h.store, "g").dependsOn).toBeUndefined();
    } finally { await h.dispose(); }
  });

  // Ruling (session 86352010): an archived prerequisite whose work is done is accepted; the dependent does not wait on it.
  it("accepts an edge to an archived prerequisite whose work is done, and the dependent does not wait for it", async () => {
    const h = await webFixture(profileSnapshot(), [{ taskId: "a" }]); try {
      const service = new WebControlService(h.deps);
      h.importDeferred("p");
      finishTasks(h, "p");
      expect(service.archiveGroup(h.rawCommand(`archive-p-${++sequence}`, revisionOf(h, "p"), "archive-group", { kind: "group", groupId: "p" }, {}) as never)).toMatchObject({ result: { kind: "archived" } });
      // mutation: refuse every archived prerequisite (the session 3cfc2e73 rule) -> group-edge-prerequisite-archived, red
      expect(edge(h, service, "add-group-dependency", "g", "p")).toMatchObject({ result: { kind: "group-dependency-added", groupId: "g", dependsOn: "p" } });
      expect(readGroupSummary(h.store, "g").dependsOn).toEqual(["p"]);
      expect(waitingPrerequisites(h.store, "g")).toEqual([]);
    } finally { await h.dispose(); }
  });

  it("a dependent of one prerequisite not delivered locally stacks on that prerequisite's branch", async () => {
    const h = await webFixture(profileSnapshot(), [{ taskId: "a" }]); try {
      const service = new WebControlService(h.deps);
      h.importDeferred("p");
      expect(stackBaseOf(h.store, "g")).toBeNull();
      edge(h, service, "add-group-dependency", "g", "p");
      expect(stackBaseOf(h.store, "g")).toBe("refs/heads/orca/p");
    } finally { await h.dispose(); }
  });
});

describe("ensureWorkBranch's start point (kanban spec §9a.1)", () => {
  it("creates the dependent's branch at the prerequisite's tip, and leaves an existing branch alone", async () => {
    const repo = await mkdtemp(join(tmpdir(), "stack-"));
    const git = (args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.hooksPath=/dev/null", ...args], { cwd: repo, encoding: "utf8", env: { ...process.env, ...unsetInheritedGitEnv() } }).trim();
    try {
      git(["init", "-q", "-b", "main"]); git(["commit", "-q", "--allow-empty", "-m", "base"]);
      git(["checkout", "-q", "-b", "orca/p"]); git(["commit", "-q", "--allow-empty", "-m", "p's work"]); git(["checkout", "-q", "main"]);
      const tip = git(["rev-parse", "orca/p"]), head = git(["rev-parse", "HEAD"]);
      // mutation: ignore startPoint -> the target's HEAD, red
      expect(await ensureWorkBranch(repo, "d", "refs/heads/orca/p")).toBe(tip);
      expect(await ensureWorkBranch(repo, "e")).toBe(head);
      expect(await ensureWorkBranch(repo, "d", null)).toBe(tip);
    } finally { await rm(repo, { recursive: true, force: true }); }
  });
});

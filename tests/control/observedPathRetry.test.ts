import { describe, expect, it } from "vitest";
import { readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { withCommandContext } from "../../src/control/commandClient.js";
import { readConfirmedTaskExecution } from "../../src/control/executionSnapshot.js";
import { resolveGroupSelections } from "../../src/control/agentFreeze.js";
import { readArchivedPlan, readBudgetProposal } from "../../src/control/queries.js";
import { deliverScheduledStart } from "../../src/control/webDispatch.js";
import { routedCommandContext } from "../../src/panel/controlApi.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { permissionRefusal, type Principal } from "../../src/panel/permissions.js";
import type { PathPolicyMissV1 } from "../../src/control/pathPolicyMisses.js";
import { driverHarness } from "./fixtures/driverHarness.js";
import { loop } from "./fixtures/taskLoop.js";

const AGENT: Principal = { kind: "agent", client: "cli" };
const OWNER: Principal = { kind: "user", userId: "owner", name: "ana", roles: ["owner"] };
const DISPATCHED: Principal = { kind: "agent", client: "cli", dispatchedRun: "run-other" };
const BY = { by: "ana", via: "web" };
const misses: PathPolicyMissV1[] = [{ repoKey: null, path: "test/one.test.js" }, { repoKey: null, path: "test/two.test.js" }];

async function blockedWorld(paths: PathPolicyMissV1[] = misses, recipe: Record<string, unknown> = loop("a")) {
  const t = await driverHarness([{ taskId: "a", loop: recipe }], {
    behaviour: () => "blocked-waiting-human", stopReason: () => `allowlist miss: ${paths[0]!.path}`,
    pathPolicyMisses: () => paths,
  });
  const runId = await t.claim();
  await t.until(t.driver(), () => t.body(runId).state === "blocked");
  return { t, runId };
}

function retry(t: Awaited<ReturnType<typeof driverHarness>>, runId: string, principal: Principal, commandId = "extend-1") {
  const command = t.h.command("retry-task", { taskId: "a", runId, allowObservedPaths: true } as never, commandId);
  const send = () => withCommandContext(command.commandId, routedCommandContext(principal.kind === "user" ? "web" : "cli", principal, BY),
    () => t.service.retryTask(command));
  return { answer: send(), replay: send };
}

describe("retry-task with observed paths", { timeout: 90_000 }, () => {
  it("refuses a dispatched run at the socket and apply boundary", async () => {
    const { t, runId } = await blockedWorld();
    try {
      expect(permissionRefusal(DISPATCHED, "retry-task", { taskId: "a", runId, allowObservedPaths: true })?.code).toBe("control-dispatched-run-refused");
      expect(retry(t, runId, DISPATCHED).answer).toMatchObject({ error: { code: "observed-paths-not-allowed" } });
      expect(t.body(runId).state).toBe("blocked");
    } finally { await t.h.dispose(); }
  });

  it("requires the last run id and refuses orca-auto without moving the task", async () => {
    const { t, runId } = await blockedWorld();
    try {
      const noRun = t.h.command("retry-task", { taskId: "a", allowObservedPaths: true } as never, "extend-no-run");
      expect(t.service.retryTask(noRun)).toMatchObject({ error: { code: "observed-paths-invalid" } });
      const auto = t.h.command("retry-task", { taskId: "a", runId, allowObservedPaths: true } as never, "extend-auto");
      auto.actorId = "orca-auto";
      expect(t.service.retryTask(auto)).toMatchObject({ error: { code: "observed-paths-not-allowed" } });
      expect(t.body(runId).state).toBe("blocked");
    } finally { await t.h.dispose(); }
  });

  it("refuses an older peer's allowlist block without typed paths and keeps the old run active", async () => {
    const t = await driverHarness([{ taskId: "a", loop: loop("a") }], {
      behaviour: () => "blocked-waiting-human", stopReason: () => "allowlist miss: test/one.test.js",
    });
    try {
      const runId = await t.claim();
      await t.until(t.driver(), () => t.body(runId).state === "blocked");
      expect(retry(t, runId, AGENT).answer).toMatchObject({ error: { code: "observed-paths-unavailable" } });
      expect(t.body(runId).state).toBe("blocked");
      expect(readConfirmedTaskExecution(t.h.store, "g", "a").contract.context.targetPaths).toEqual(["a"]);
    } finally { await t.h.dispose(); }
  });

  it("refuses a path the frozen contract denies, without settling or amending the old run", async () => {
    const blocked = [{ repoKey: null, path: "secrets/token.txt" }];
    const { t, runId } = await blockedWorld(blocked, { ...loop("a"), protectedPaths: ["secrets/**"] });
    try {
      expect(retry(t, runId, AGENT).answer).toMatchObject({ error: { code: "observed-paths-invalid" } });
      expect(t.body(runId).state).toBe("blocked");
      expect(readConfirmedTaskExecution(t.h.store, "g", "a").contract.context.targetPaths).toEqual(["a"]);
    } finally { await t.h.dispose(); }
  });

  it("refuses an observed path through an existing symlink outside the repository", async () => {
    const blocked = [{ repoKey: null, path: "test/escape.txt" }];
    const { t, runId } = await blockedWorld(blocked);
    try {
      await symlink(t.h.root, join(t.repo, "test"));
      expect(retry(t, runId, AGENT).answer).toMatchObject({ error: { code: "observed-paths-invalid" } });
      expect(t.body(runId).state).toBe("blocked");
    } finally { await t.h.dispose(); }
  });

  it("refuses a repository key absent from the source contract without a partial amendment", async () => {
    const blocked = [{ repoKey: "ghost", path: "test/new.test.js" }];
    const { t, runId } = await blockedWorld(blocked);
    try {
      expect(retry(t, runId, AGENT).answer).toMatchObject({ error: { code: "observed-paths-invalid" } });
      expect(t.body(runId).state).toBe("blocked");
      expect(readConfirmedTaskExecution(t.h.store, "g", "a").contract.context.targetPaths).toEqual(["a"]);
    } finally { await t.h.dispose(); }
  });

  it("refuses a new write overlap with an unfinished sibling that has no dependency order", async () => {
    const blocked = [{ repoKey: null, path: "b" }];
    const t = await driverHarness([{ taskId: "a", loop: loop("a") }, { taskId: "b", loop: loop("b") }], {
      behaviour: (id) => id === "a" ? "blocked-waiting-human" : "succeed",
      stopReason: () => "allowlist miss: b", pathPolicyMisses: () => blocked,
    });
    try {
      const runId = await t.claim();
      await t.until(t.driver(), () => t.body(runId).state === "blocked");
      expect(retry(t, runId, AGENT).answer).toMatchObject({ error: { code: "observed-paths-conflict" } });
      expect(t.body(runId).state).toBe("blocked");
    } finally { await t.h.dispose(); }
  });

  it("keeps an already ordered later sibling when the new path overlaps its write set", async () => {
    const blocked = [{ repoKey: null, path: "b" }];
    const t = await driverHarness([{ taskId: "a", loop: loop("a") }, { taskId: "b", loop: loop("b"), dependsOn: ["a"] }], {
      behaviour: (id) => id === "a" ? "blocked-waiting-human" : "succeed",
      stopReason: () => "allowlist miss: b", pathPolicyMisses: () => blocked,
    });
    try {
      const runId = await t.claim();
      await t.until(t.driver(), () => t.body(runId).state === "blocked");
      expect(retry(t, runId, AGENT).answer).toMatchObject({ result: { kind: "task-retried" } });
    } finally { await t.h.dispose(); }
  });

  it("refuses a new path while another group has an active run writing the same repository path", async () => {
    const blocked = [{ repoKey: null, path: "test/one.test.js" }];
    const { t, runId } = await blockedWorld(blocked);
    try {
      const planPath = join(t.repo, "plan.json");
      const plan = JSON.parse(await readFile(planPath, "utf8"));
      plan.tasks = [{ taskId: "b", loop: { ...loop("b"), targetPaths: ["test/one.test.js"] }, dependsOn: [], targetVersion: 1 }];
      await writeFile(planPath, JSON.stringify(plan));
      t.h.importDeferred("h");
      const proposal = readBudgetProposal(t.h.store, "h"), archived = readArchivedPlan(t.h.store, "h");
      const selections = await resolveGroupSelections({ store: t.h.store, port: t.h.deps.port }, "h", "human");
      const revision = () => Number(t.h.store.db.prepare("SELECT revision FROM groups WHERE id='h'").get()!.revision);
      const confirm = t.h.rawCommand("confirm-h", revision(), "confirm", { kind: "group", groupId: "h" }, {
        planHash: archived.planHash, proposalVersion: proposal.proposalVersion, budgetMode: "soft",
        profileIds: { estimator: "all", worker: "all", handoff: "all", goalReview: "all" },
        profileHashes: { estimator: t.h.frozen.profileHash, worker: t.h.frozen.profileHash,
          handoff: t.h.frozen.profileHash, goalReview: t.h.frozen.profileHash },
        contextPolicy: { handoffAtContextTokens: 800_000 }, selectionsHash: selections.selectionsHash ?? "0".repeat(64),
      });
      expect(await t.service.confirm(confirm as never)).not.toHaveProperty("error");
      const start = t.h.rawCommand("start-h", revision(), "start", { kind: "group", groupId: "h" }, {});
      expect(await t.service.start(start as never)).not.toHaveProperty("error");
      const claimed = await deliverScheduledStart(t.dispatch, "h");
      expect(claimed.kind).toBe("claimed");
      expect(retry(t, runId, AGENT).answer).toMatchObject({ error: { code: "observed-paths-conflict" } });
      expect(t.body(runId).state).toBe("blocked");
    } finally { await t.h.dispose(); }
  });

  it("combines an authorized work top-up with the same atomic path extension on an optional-policy task", async () => {
    const t = await driverHarness([{ taskId: "a", loop: loop("a") }], {
      tokenPolicy: "optional-v1", behaviour: () => "blocked-waiting-human", stopReason: () => "allowlist miss: test/one.test.js",
      pathPolicyMisses: () => [misses[0]!],
    });
    try {
      const row = t.h.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id='a'").get()!;
      const work = JSON.parse(String(row.body));
      work.grant.work.attempts = 1;
      t.h.store.db.prepare("UPDATE work_items SET body=? WHERE group_id='g' AND id='a'").run(JSON.stringify(work));
      const runId = await t.claim();
      await t.until(t.driver(), () => t.body(runId).state === "blocked");
      const command = t.h.command("retry-task", { taskId: "a", runId, allowObservedPaths: true, work: { attempts: 2 } } as never);
      const answer = withCommandContext(command.commandId, routedCommandContext("web", OWNER, BY), () => t.service.retryTask(command));
      expect(answer).toMatchObject({ result: { kind: "task-retried", fromRunId: runId } });
      expect(readConfirmedTaskExecution(t.h.store, "g", "a").contract.context.targetPaths).toEqual(["a", "test/one.test.js"]);
      expect(readControlGroup(t.h.store, "epoch", "g").workItems.find((item) => item.taskId === "a")?.topUps).toMatchObject([{ amount: { attempts: 2 } }]);
    } finally { await t.h.dispose(); }
  });

  it("rolls back a work top-up and old-run settlement when a path is denied", async () => {
    const t = await driverHarness([{ taskId: "a", loop: { ...loop("a"), protectedPaths: ["secrets/**"] } }], {
      tokenPolicy: "optional-v1", behaviour: () => "blocked-waiting-human", stopReason: () => "allowlist miss: secrets/token.txt",
      pathPolicyMisses: () => [{ repoKey: null, path: "secrets/token.txt" }],
    });
    try {
      const row = t.h.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id='a'").get()!;
      const work = JSON.parse(String(row.body));
      work.grant.work.attempts = 1;
      t.h.store.db.prepare("UPDATE work_items SET body=? WHERE group_id='g' AND id='a'").run(JSON.stringify(work));
      const runId = await t.claim();
      await t.until(t.driver(), () => t.body(runId).state === "blocked");
      const command = t.h.command("retry-task", { taskId: "a", runId, allowObservedPaths: true, work: { attempts: 2 } } as never);
      const answer = withCommandContext(command.commandId, routedCommandContext("web", OWNER, BY), () => t.service.retryTask(command));
      expect(answer).toMatchObject({ error: { code: "observed-paths-invalid" } });
      expect(t.body(runId).state).toBe("blocked");
      expect(t.h.store.db.prepare("SELECT COUNT(*) AS n FROM work_grant_top_ups").get()!.n).toBe(0);
      expect(readConfirmedTaskExecution(t.h.store, "g", "a").contract.context.targetPaths).toEqual(["a"]);
    } finally { await t.h.dispose(); }
  });

  it.each([["agent", AGENT], ["person", OWNER]] as const)("%s retries once with only the two paths the blocked run reported", async (_name, principal) => {
    const { t, runId } = await blockedWorld();
    try {
      const { answer, replay } = retry(t, runId, principal);
      expect(answer).toMatchObject({ result: { kind: "task-retried", taskId: "a", fromRunId: runId } });
      expect(replay()).toEqual(answer);
      expect(t.body(runId)).toMatchObject({ state: "settled-failed", drive: { outcome: "blocked_waiting_human", pathPolicyMisses: misses } });
      expect(readConfirmedTaskExecution(t.h.store, "g", "a").contract.context.targetPaths).toEqual(["a", ...misses.map((miss) => miss.path)]);
      expect(readConfirmedTaskExecution(t.h.store, "g", "a").contract.verification.requiredChecks).toEqual(["true"]);
      expect(readControlGroup(t.h.store, "epoch", "g").workItems.find((item) => item.taskId === "a")?.status).toBe("ready");
      const next = await t.claim();
      expect(t.body(next).runId).not.toBe(runId);
      expect(retry(t, runId, principal, "stale-extension").answer).toMatchObject({ error: { code: "task-run-moved" } });
      expect(readConfirmedTaskExecution(t.h.store, "g", "a").contract.context.targetPaths).toEqual(["a", ...misses.map((miss) => miss.path)]);
      await t.until(t.driver(), () => t.fake.calls.accept.some((entry) => entry.claim.runId === next));
      const sent = t.fake.calls.accept.find((entry) => entry.claim.runId === next);
      expect(sent?.work.kind).toBe("loop");
      if (sent?.work.kind === "loop") expect((sent.work.contract as { context: { targetPaths: string[] } }).context.targetPaths).toEqual(["a", ...misses.map((miss) => miss.path)]);
    } finally { await t.h.dispose(); }
  });
});

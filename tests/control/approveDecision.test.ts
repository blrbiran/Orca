import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { integratePendingGroups } from "../../src/control/integrationPass.js";
import { newGroupIntegration, readGroupIntegration } from "../../src/control/integrationScheme.js";
import { applyApprovePendingDecision, prepareApproval } from "../../src/control/decisionCommands.js";
import { readPendingDecision } from "../../src/control/pendingDecisions.js";
import { WebControlService } from "../../src/control/webService.js";
import { controlWorkspaceRoots } from "../../src/control/workspace.js";
import { driverHarness, git } from "./fixtures/driverHarness.js";

// Control run decisions plan Task 9: an owner gives a refused decision an executable undo.how; Orca writes the line in a
// ledger-only commit on orca/<groupId>, re-arms a stuck integration so it reaches the target, and marks the item approved.
// Every assertion reads git or the store, not only the command's answer.
const LANDED = ["landed", "settled"];
const SHA_E = "e".repeat(40);
const tier0 = (n: number) => ({
  question: `q${n}`, chose: "c", alternatives: [{ option: "o", why_not: "w" }], because: "b",
  undo: { how: "revert it", cost: "c", blast_radius: "r" }, scope: "task", kind: "interface",
});

async function landedWithPending(count = 1) {
  const t = await driverHarness([{ taskId: "a" }], { decisions: () => Array.from({ length: count }, (_, i) => tier0(i)) });
  const runId = await t.claim();
  await t.until(t.driver(), () => LANDED.includes(t.body(runId).state));
  // The harness's service resolves no repository; approve needs the group's repository path.
  const service = new WebControlService({ ...t.h.deps, knownRepository: (repoId: string) => repoId === "repo", resolveRepository: () => t.repo });
  const approve = (payload: { pendingId: string; undoHow: string }, commandId?: string) =>
    service.approvePendingDecision(t.h.command("approve-pending-decision", payload, commandId));
  const branchLines = (): Record<string, unknown>[] =>
    git(t.repo, "show", `refs/heads/orca/g:.decisions/${runId}.jsonl`).split("\n").filter((l) => l.trim().length > 0).map((l) => JSON.parse(l));
  const commits = () => git(t.repo, "rev-list", "--count", "refs/heads/orca/g");
  const groupBody = () => JSON.parse(String(t.h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body)) as Record<string, unknown>;
  const writeGroupBody = (body: Record<string, unknown>) => t.h.store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify(body));
  /** Someone else's commit on orca/g (same tree), as a moved tip; its id. */
  const moveBranch = (): string => {
    const old = git(t.repo, "rev-parse", "refs/heads/orca/g");
    const next = git(t.repo, "commit-tree", `${old}^{tree}`, "-p", old, "-m", "someone else");
    git(t.repo, "update-ref", "refs/heads/orca/g", next, old);
    return next;
  };
  return { ...t, runId, service, approve, branchLines, commits, groupBody, writeGroupBody, moveBranch, pendingId: (i = 0) => `pending-${runId}-${i}` };
}

describe("approve-pending-decision (control run decisions Task 9)", { timeout: 60_000 }, () => {
  it("approve writes the decision with the human's undo.how on the group branch", async () => {
    const t = await landedWithPending(); try {
      const pendingId = t.pendingId();
      const before = git(t.repo, "rev-parse", "refs/heads/orca/g");
      const command = t.h.command("approve-pending-decision", { pendingId, undoHow: `git revert --no-edit ${SHA_E}` });
      const r = await t.service.approvePendingDecision(command);
      expect(r).toMatchObject({ result: { kind: "pending-decision-approved", pendingId, decisionId: `${t.runId}/agent-0` } });
      const line = t.branchLines().at(-1)!;
      expect(line).toMatchObject({ id: `${t.runId}/agent-0`, run: t.runId, question: "q0", undo: { how: `git revert --no-edit ${SHA_E}` } });
      // goal.md §1.1: who wrote the undo.how is visible on the line itself.
      expect(line.evidence).toEqual([...readPendingDecision(t.h.store, pendingId)!.entry.evidence, `undo.how by human via approve-pending-decision ${command.commandId}`]);
      expect(git(t.repo, "rev-parse", "refs/heads/orca/g^")).toBe(before);
      expect(git(t.repo, "log", "-1", "--format=%s", "refs/heads/orca/g")).toBe(`orca: approve ${pendingId}`);
      expect(readPendingDecision(t.h.store, pendingId)).toMatchObject({ state: "approved", approvedId: `${t.runId}/agent-0` });
    } finally { await t.h.dispose(); }
  });

  it("refuses an undo.how that still fails the gate, keeping the item pending", async () => {
    const t = await landedWithPending(); try {
      const before = git(t.repo, "rev-parse", "refs/heads/orca/g");
      const r = await t.approve({ pendingId: t.pendingId(), undoHow: "revert it" });
      expect(r).toMatchObject({ error: { code: "decision-undo-not-executable" } });
      expect((r as { error: { message: string } }).error.message).toMatch(/^decision-undo-not-executable:tier-0: /);
      expect(readPendingDecision(t.h.store, t.pendingId())!.state).toBe("pending");
      expect(git(t.repo, "rev-parse", "refs/heads/orca/g")).toBe(before);
    } finally { await t.h.dispose(); }
  });

  it("refuses, by name and not as a server error, a run ledger on the branch that cannot be appended to", async () => {
    // Final review m2: appendEvents validates the file it appends to; a line it rejects is a refusal of this approve.
    const t = await landedWithPending(); try {
      const run = (args: string[], input?: string) =>
        execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: t.repo, encoding: "utf8", input }).trim();
      const old = run(["rev-parse", "refs/heads/orca/g"]);
      const blob = run(["hash-object", "-w", "--stdin"], "not json\n");
      const sub = run(["mktree"], `100644 blob ${blob}\t${t.runId}.jsonl\n`);
      const tree = run(["mktree"], `${run(["ls-tree", old])}\n040000 tree ${sub}\t.decisions\n`);
      const seeded = run(["commit-tree", tree, "-p", old, "-m", "seed"]);
      run(["update-ref", "refs/heads/orca/g", seeded, old]);
      // mutation m2: let appendEvents' throw escape prepareApproval -> the call rejects (a raw 500), red
      const r = await t.approve({ pendingId: t.pendingId(), undoHow: `git revert --no-edit ${SHA_E}` });
      expect(r).toMatchObject({ error: { code: "pending-decision-entry-invalid" } });
      expect((r as { error: { message: string } }).error.message).toMatch(/^pending-decision-entry-invalid:refusing to append/);
      expect(readPendingDecision(t.h.store, t.pendingId())!.state).toBe("pending");
      expect(git(t.repo, "rev-parse", "refs/heads/orca/g")).toBe(seeded);
    } finally { await t.h.dispose(); }
  });

  it("refuses an unknown pending id and one already approved, by name", async () => {
    const t = await landedWithPending(); try {
      expect(await t.approve({ pendingId: "pending-nope-0", undoHow: `git revert --no-edit ${SHA_E}` })).toMatchObject({ error: { code: "pending-decision-not-found" } });
      await t.approve({ pendingId: t.pendingId(), undoHow: `git revert --no-edit ${SHA_E}` });
      const commits = t.commits();
      expect(await t.approve({ pendingId: t.pendingId(), undoHow: `git revert --no-edit ${SHA_E}` })).toMatchObject({ error: { code: "no-op-command" } });
      expect(t.commits()).toBe(commits);
    } finally { await t.h.dispose(); }
  });

  it("only marks approved when the line is already on the branch (a crash between git and DB)", async () => {
    const t = await landedWithPending(); try {
      const pendingId = t.pendingId();
      await t.approve({ pendingId, undoHow: `git revert --no-edit ${SHA_E}` });
      const commits = t.commits();
      t.h.store.db.prepare("UPDATE pending_decisions SET state='pending' WHERE id=?").run(pendingId);
      // The integration got stuck before the crash: the line is only on the group branch, so recovery re-arms it (§4).
      const scheme = { delivery: "local", trigger: "task", method: "merge", target: "main" } as const;
      t.writeGroupBody({ ...t.groupBody(), integration: { ...newGroupIntegration(scheme)!, frozen: true, state: "blocked", reason: "integration-worktree-dirty" } });
      const again = await t.approve({ pendingId, undoHow: `git revert --no-edit ${"f".repeat(40)}` });
      expect(again).toMatchObject({ result: { kind: "pending-decision-approved", pendingId, decisionId: `${t.runId}/agent-0` } });
      // Mutation "skip the findDecision check" is red here: the call throws appendEvents' duplicate-id guard
      // ("refusing to append: duplicate decision id"), since the line is already in the file it appends to.
      expect(t.commits()).toBe(commits);
      expect(readGroupIntegration(t.groupBody())).toMatchObject({ state: "idle", reason: null }); // mutation: drop the already-present clause -> red
      expect(t.branchLines().map((l) => l.id)).toEqual([`${t.runId}/agent-0`]);
      expect(readPendingDecision(t.h.store, pendingId)!.state).toBe("approved");
    } finally { await t.h.dispose(); }
  });

  it("refuses decision-approve-tip-moved after three retries of a branch that keeps moving, keeping the item pending", async () => {
    const t = await landedWithPending(); try {
      const pendingId = t.pendingId();
      const command = t.h.command("approve-pending-decision", { pendingId, undoHow: `git revert --no-edit ${SHA_E}` });
      let calls = 0;
      const beforeCas = async () => { calls += 1; t.moveBranch(); };
      const prepared = await prepareApproval(t.h.store, controlWorkspaceRoots(t.h.store.stateDir), t.repo, command, { beforeCas });
      expect(prepared).toEqual({ kind: "refused", code: "decision-approve-tip-moved" });
      expect(calls).toBe(4); // one try and three retries; mutation: retries = 0 -> 1, red
      expect(applyApprovePendingDecision({ store: t.h.store }, command, prepared)).toMatchObject({ error: { code: "decision-approve-tip-moved" } });
      expect(readPendingDecision(t.h.store, pendingId)!.state).toBe("pending");
      expect(git(t.repo, "log", "--format=%s", "refs/heads/orca/g")).not.toContain("orca: approve");
    } finally { await t.h.dispose(); }
  });

  it("commits on the retry after the branch moved once", async () => {
    const t = await landedWithPending(); try {
      const pendingId = t.pendingId();
      const command = t.h.command("approve-pending-decision", { pendingId, undoHow: `git revert --no-edit ${SHA_E}` });
      let calls = 0;
      let moved = "";
      const beforeCas = async () => { calls += 1; if (calls === 1) moved = t.moveBranch(); };
      const prepared = await prepareApproval(t.h.store, controlWorkspaceRoots(t.h.store.stateDir), t.repo, command, { beforeCas });
      const tip = git(t.repo, "rev-parse", "refs/heads/orca/g");
      expect(prepared).toEqual({ kind: "committed", id: `${t.runId}/agent-0`, commit: tip }); // mutation: return committed on moved -> red
      expect(calls).toBe(2);
      expect(git(t.repo, "rev-parse", `${tip}^`)).toBe(moved);
      expect(t.branchLines().map((l) => l.id)).toEqual([`${t.runId}/agent-0`]);
    } finally { await t.h.dispose(); }
  });

  it("re-arms a blocked local integration so the approved line reaches the target", async () => {
    const t = await landedWithPending(); try {
      // The harness's checkout holds an untracked plan.json: main is integrated in a worktree of Orca's, not in place.
      git(t.repo, "checkout", "-q", "-b", "other");
      const scheme = { delivery: "local", trigger: "task", method: "merge", target: "main" } as const;
      t.writeGroupBody({ ...t.groupBody(), integration: { ...newGroupIntegration(scheme)!, frozen: true, state: "blocked", reason: "integration-worktree-dirty" } });
      const r = await t.approve({ pendingId: t.pendingId(), undoHow: `git revert --no-edit ${SHA_E}` });
      expect(r).toMatchObject({ result: { kind: "pending-decision-approved" } });
      expect(readGroupIntegration(t.groupBody())).toMatchObject({ state: "idle", reason: null, retryAfter: null, transient: 0 });
      const deps = { store: t.h.store, roots: controlWorkspaceRoots(t.h.store.stateDir), admissionGate: t.h.deps.admissionGate, repoPathOf: () => t.repo,
        now: () => 1_000_000, ghBin: "/nonexistent/gh", stopped: () => false };
      expect(await integratePendingGroups(deps)).toBe(true);
      const onMain = git(t.repo, "show", `refs/heads/main:.decisions/${t.runId}.jsonl`).split("\n").map((l) => JSON.parse(l) as { id: string });
      expect(onMain.map((l) => l.id)).toEqual([`${t.runId}/agent-0`]);
    } finally { await t.h.dispose(); }
  });

  it("is refused while another run of the group is reconciling", async () => {
    const t = await landedWithPending(); try {
      const before = git(t.repo, "rev-parse", "refs/heads/orca/g");
      t.h.store.db.prepare("INSERT INTO runs(id,group_id,work_item_id,generation,active,body) VALUES ('run-sibling','g','sibling',1,1,?)").run(JSON.stringify({ state: "reconciling" }));
      const r = await t.approve({ pendingId: t.pendingId(), undoHow: `git revert --no-edit ${SHA_E}` });
      expect(r).toMatchObject({ error: { code: "decision-approve-reconciling" } });
      expect(readPendingDecision(t.h.store, t.pendingId())!.state).toBe("pending");
      expect(git(t.repo, "rev-parse", "refs/heads/orca/g")).toBe(before);
    } finally { await t.h.dispose(); }
  });

  it("is refused while an agent resolves the group's integration conflict", async () => {
    const t = await landedWithPending(); try {
      const before = git(t.repo, "rev-parse", "refs/heads/orca/g");
      const scheme = { delivery: "local", trigger: "task", method: "merge", target: "main" } as const;
      t.writeGroupBody({ ...t.groupBody(), integration: { ...newGroupIntegration(scheme)!, frozen: true, state: "resolving" } });
      expect(await t.approve({ pendingId: t.pendingId(), undoHow: `git revert --no-edit ${SHA_E}` })).toMatchObject({ error: { code: "integration-busy" } });
      expect(readPendingDecision(t.h.store, t.pendingId())!.state).toBe("pending");
      expect(git(t.repo, "rev-parse", "refs/heads/orca/g")).toBe(before);
    } finally { await t.h.dispose(); }
  });

  it("appends a second approval to the same run file", async () => {
    const t = await landedWithPending(2); try {
      await t.approve({ pendingId: t.pendingId(1), undoHow: `git revert --no-edit ${SHA_E}` });
      await t.approve({ pendingId: t.pendingId(0), undoHow: `git revert --no-edit ${"d".repeat(40)}` });
      expect(t.branchLines().map((l) => l.id)).toEqual([`${t.runId}/agent-1`, `${t.runId}/agent-0`]);
      expect([0, 1].map((i) => readPendingDecision(t.h.store, t.pendingId(i))!.state)).toEqual(["approved", "approved"]);
    } finally { await t.h.dispose(); }
  });

  it("refuses an archived group by name and keeps the item pending", async () => {
    const t = await landedWithPending(); try {
      await t.until(t.driver(), () => t.body(t.runId).state === "settled");
      expect(t.service.archiveGroup(t.h.command("archive-group", {}))).toMatchObject({ result: { kind: "archived" } });
      const before = git(t.repo, "rev-parse", "refs/heads/orca/g");
      expect(await t.approve({ pendingId: t.pendingId(), undoHow: `git revert --no-edit ${SHA_E}` })).toMatchObject({ error: { code: "group-archived" } });
      expect(readPendingDecision(t.h.store, t.pendingId())!.state).toBe("pending");
      expect(git(t.repo, "rev-parse", "refs/heads/orca/g")).toBe(before);
    } finally { await t.h.dispose(); }
  });
});

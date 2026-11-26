// Issue #199: an agent polling a long run needs the group's state, completion, counts and blockers, not the ~100 KB
// full view. `group brief` reads the summary route itself; `group show` keeps its bytes.
import { createServer } from "node:http";
import express from "express";
import { describe, expect, it } from "vitest";
import { registerControlReadRoutes } from "../../src/panel/controlApi.js";
import { requirementHarness } from "../control/fixtures/requirementHarness.js";
import { ROUND_ONE } from "../control/fixtures/requirementOutputs.js";
import { cli, fakePanel } from "./fixtures/fakePanel.js";

const VIEW = {
  schema: "orca-control-group-v1", epoch: "e", changeSeq: 11,
  summary: { groupId: "g-alpha", repoId: "repo-1", state: "running", commandRevision: 7, projectionSeq: 4, stopMode: null, stopState: null,
    claimBlocked: false, recoveryBlockerCount: 0, completion: { done: 2, total: 6 }, goal: "ship", branch: "orca/g-alpha",
    counts: { idle: 2, running: 1, waiting: 0, blocked: 1, done: 2 }, updatedAt: 5, archived: false, executionPending: true, overGrant: true },
  proposal: {}, allocations: [], ledger: {}, workItems: [], runs: [], checkpoints: [],
};

const routes = { "GET summary": { status: 200, body: { schema: "orca-control-summary-v1", epoch: "e", changeSeq: 11, resetRequired: false, groups: [{ groupId: "g-alpha", repoId: "repo-1", state: "running", commandRevision: 7 }] } }, "GET groups/g-alpha/brief": { status: 200, body: { schema: "orca-group-brief-v1", ...VIEW.summary } }, "GET groups/g-alpha": { status: 200, body: VIEW } };

describe("group brief (issue 199)", () => {
  it("returns only the group summary fields, not the full view", async () => {
    const p = await fakePanel(routes);
    const out = await cli(["group", "brief", "g-alpha", "--json"], p.dir);
    expect(out.code, out.stderr).toBe(0);
    const body = out.json().body as Record<string, any>;
    expect(body.schema).toBe("orca-group-brief-v1");
    expect(body).toMatchObject({ groupId: "g-alpha", state: "running", completion: { done: 2, total: 6 }, counts: { blocked: 1 }, overGrant: true });
    expect(body).not.toHaveProperty("proposal");
    expect(body).not.toHaveProperty("workItems");
    expect(body).not.toHaveProperty("runs");
  });

  it("resolves a group prefix from group-ids, not the full summary (#497)", async () => {
    const p = await fakePanel({ ...routes, "GET group-ids": { status: 200, body: { groupIds: ["g-alpha"] } } });
    const out = await cli(["group", "brief", "g-alpha"], p.dir);
    expect(out.code, out.stderr).toBe(0);
    expect(p.requests.some((request) => request.path === "group-ids")).toBe(true);
    // mutation: resolve the prefix from the summary again -> this request appears, red
    expect(p.requests.some((request) => request.path === "summary")).toBe(false);
  });

  it("explains that a passing acceptance and a not-passed requirement review are independent", async () => {
    const acceptance = { tip: "a".repeat(40), result: "passed", commands: [], at: 1,
      testChanges: { base: "b".repeat(40), paths: ["tests/a.test.ts"], weakeningSignals: [], digest: "d".repeat(64),
        disposition: { tip: "a".repeat(40), digest: "d".repeat(64), by: "user:owner", note: "approved" } } };
    const requirementReview = { state: "not-passed", why: "rounds-exhausted", rounds: [], autoFixRounds: 2,
      problem: "requirement-review-not-passed:rounds-exhausted" };
    const p = await fakePanel({
      "GET summary": { status: 200, body: { schema: "orca-control-summary-v1", epoch: "e", changeSeq: 11, resetRequired: false, groups: [{ groupId: "g-alpha", repoId: "repo-1", state: "review", commandRevision: 7 }] } },
      "GET groups/g-alpha/brief": { status: 200, body: { schema: "orca-group-brief-v1", ...VIEW.summary, acceptance, requirementReview } },
    });
    const out = await cli(["group", "brief", "g-alpha"], p.dir);
    expect(out.code, out.stderr).toBe(0);
    expect(out.stdout).toContain("acceptance: passed");
    expect(out.stdout).toContain("requirement review: not-passed; independent of acceptance, with its own next action below");
    expect(out.stdout).toContain("next: orca group review-fix g-alpha --goal '<what to fix>'");
    expect(out.stdout).toContain("test changes: accepted by user:owner on aaaaaaaaaaaa");
  });

  it("group brief shows a pending test change, its paths, and the person command", async () => {
    const acceptance = { tip: "a".repeat(40), result: "test-change-pending", commands: [], at: 1, problem: "test-change-pending",
      testChanges: { base: "b".repeat(40), paths: ["tests/a.test.ts"], weakeningSignals: [], digest: "d".repeat(64), pendingResult: "passed" } };
    const p = await fakePanel({
      "GET summary": { status: 200, body: { schema: "orca-control-summary-v1", epoch: "e", changeSeq: 11, resetRequired: false, groups: [{ groupId: "g-alpha", repoId: "repo-1", state: "review", commandRevision: 7 }] } },
      "GET groups/g-alpha/brief": { status: 200, body: { schema: "orca-group-brief-v1", ...VIEW.summary, acceptance, groupProblem: {
        code: "test-change-pending", why: "test-change-pending", next: ["orca group accept-test-changes g-alpha --note '<why>' --tip <tip> --digest <digest>"],
      } } },
    });
    const out = await cli(["group", "brief", "g-alpha"], p.dir);
    expect(out.code, out.stderr).toBe(0);
    expect(out.stdout).toContain("problem: test-change-pending on orca/g-alpha at aaaaaaaaaaaa");
    expect(out.stdout).toContain("  changed test paths: tests/a.test.ts");
    expect(out.stdout).toContain("next: orca group accept-test-changes g-alpha --note '<why>' --tip <tip> --digest <digest>");
  });

  it("keeps group show's full body unchanged", async () => {
    const p = await fakePanel(routes);
    const out = await cli(["group", "show", "g-alpha", "--json"], p.dir);
    expect(out.code, out.stderr).toBe(0);
    expect(out.json().body).toEqual(VIEW);
  });

  it("answers a clarifying group's brief while its full view is refused", async () => {
    const x = await requirementHarness({ answers: [{ purpose: "clarify", output: ROUND_ONE }] });
    const app = express();
    app.use(express.json());
    registerControlReadRoutes(app, { store: x.store, epoch: "epoch", config: { readView: async () => ({}) } as never }, "web");
    const server = createServer(app);
    try {
      await x.until(() => x.round(1).state === "awaiting-answers");
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("address");
      const get = async (path: string) => {
        const response = await fetch(`http://127.0.0.1:${address.port}${path}`);
        return { status: response.status, body: await response.json() as Record<string, unknown> };
      };
      expect(await get("/api/control/groups/r/brief")).toMatchObject({ status: 200, body: { schema: "orca-group-brief-v1", groupId: "r", state: "clarifying", requirement: { roundNo: 1 } } });
      // Tester #365(a): the brief names a done group's delivery only. A clarifying group has no integration copy yet, so
      // "keep" would be false there (batch D re-review Important 2).
      // Ruling (2026-11-18 tester batch D review): this assertion pinned "keep" for a clarifying group; that was the defect.
      expect((await get("/api/control/groups/r/brief")).body.delivery).toBeUndefined();
      expect(await get("/api/control/groups/r")).toMatchObject({ status: 422, body: { error: { code: "requirement-not-split" } } });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await x.dispose();
    }
  });

  // Tester #500: the brief printed `card` through compact()'s 160-character cut, so a first failure's `next` command
  // arrived truncated and could not be pasted. The failure block carries the cause and the whole command on its own line.
  it("prints a first failure's cause and a next command longer than 160 characters in full (#500)", async () => {
    const groupId = "sprint-3layer-20261125-1";
    const next = `orca group set-limit ${groupId} --limit <a higher limit>  or  orca task accept-stopped-attempt ${groupId} task-with-a-rather-long-identifier-0001 --run run-0123456789abcdef`;
    expect(next.length).toBeGreaterThan(160);
    const card = { budget: { usedTokens: 1, limitTokens: null, reservedTokens: 0 }, firstFailure: { taskId: "t-7", cause: "group-cap-reached", next } };
    const summary = { status: 200, body: { schema: "orca-control-summary-v1", epoch: "e", changeSeq: 11, resetRequired: false, groups: [{ groupId, repoId: "repo-1", state: "running", commandRevision: 7 }] } };
    const p = await fakePanel({ "GET summary": summary, [`GET groups/${groupId}/brief`]: { status: 200, body: { schema: "orca-group-brief-v1", ...VIEW.summary, groupId, card } } });
    const out = await cli(["group", "brief", groupId], p.dir);
    expect(out.code, out.stderr).toBe(0);
    expect(out.stdout).toContain("failure: group-cap-reached — task t-7");
    expect(out.stdout).toContain(`  next: ${next}`);
    // `card` stays in the output for whoever greps it.
    expect(out.stdout).toContain("card: ");
  });

  it("prints a first failure without a next command as its cause alone, never an empty next line (#500)", async () => {
    const card = { firstFailure: { taskId: "t-2", cause: "task-blocked" } };
    const p = await fakePanel({ ...routes, "GET groups/g-alpha/brief": { status: 200, body: { schema: "orca-group-brief-v1", ...VIEW.summary, card } } });
    const out = await cli(["group", "brief", "g-alpha"], p.dir);
    expect(out.code, out.stderr).toBe(0);
    expect(out.stdout).toContain("failure: task-blocked — task t-2");
    expect(out.stdout).not.toContain("next:");
  });
});

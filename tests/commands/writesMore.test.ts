// CLI v2 plan Task 6 (spec §4 table; plan "Control verbs → commands"): project, decision, correction, agent, usage,
// orchestration and recovery writes -- each one route, one payload, the revision of its own scope (spec §6.1).
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cli, useFakePanels } from "./fixtures/fakePanel.js";
import { accept, H, world } from "./fixtures/world.js";
import { boot, useSocketPanels, workspace } from "../panel/fixtures/socketPanel.js";
import { controlRepoKey } from "../../src/panel/controlOptions.js";

useFakePanels();
useSocketPanels();

const prefsFile = (() => {
  const file = join(mkdtempSync(join(tmpdir(), "prefs-")), "prefs.json");
  writeFileSync(file, JSON.stringify({ perAgent: {} }));
  return file;
})();
const CID = "c_0123456789abcdef";

/** argv → the one POST: route, expectedRevision (its scope's: group 5, repository 7, operator 2, spend 8, orchestration 4, corrections 0), payload. */
const MAPPINGS: Array<[string[], string, number, unknown]> = [
  [["project", "set-workspace-mode", "--mode", "clone"], "repositories/repo-1/workspace-mode", 7, { workspaceMode: "clone" }],
  [["project", "set-integration", "--delivery", "keep"], "repositories/repo-1/integration", 7, { integration: { delivery: "keep" } }],
  [["project", "set-integration", "--delivery", "github-pr", "--trigger", "group", "--target", "main", "--remote", "origin"], "repositories/repo-1/integration", 7,
    { integration: { delivery: "github-pr", trigger: "group", target: "main", remote: "origin" } }],
  [["project", "set-integration-check", "--on"], "repositories/repo-1/integration-check", 7, { enabled: true, command: null }],
  [["project", "set-integration-check", "--on", "--command", "npm test"], "repositories/repo-1/integration-check", 7, { enabled: true, command: "npm test" }],
  [["project", "set-integration-check", "--off"], "repositories/repo-1/integration-check", 7, { enabled: false, command: null }],
  [["project", "set-criteria-review", "--off"], "repositories/repo-1/criteria-review", 7, { enabled: false }],
  [["decision", "approve", "g-alpha", "pending-run-x-0", "--undo-how", "git revert --no-edit abc"], "groups/g-alpha/decisions/approve", 5, { pendingId: "pending-run-x-0", undoHow: "git revert --no-edit abc" }],
  [["decision", "reject", "g-alpha", "pending-run-x-0", "--because", "false premise"], "groups/g-alpha/decisions/reject", 5, { pendingId: "pending-run-x-0", because: "false premise" }],
  [["decision", "reject", "g-alpha", "pending-run-x-0"], "groups/g-alpha/decisions/reject", 5, { pendingId: "pending-run-x-0" }],
  [["decision", "ratify", "g-alpha", "run-x/agent-0"], "groups/g-alpha/decisions/ratify", 5, { decisionId: "run-x/agent-0" }],
  [["correction", "record", "--decision", "run-1/1", "--kind", "wrong", "--because", "false premise"], "corrections", 0,
    { repoId: "repo-1", decisionId: "run-1/1", kind: "wrong", because: "false premise" }],
  [["correction", "record", "--decision", "run-1/1", "--kind", "stale", "--because", "b", "--chose-instead", "a lease", "--again"], "corrections", 0,
    { repoId: "repo-1", decisionId: "run-1/1", kind: "stale", because: "b", chose_instead: "a lease", again: true }],
  [["correction", "close", CID, "--undo-how", "git revert --no-edit abc", "--chose-instead", "a lease"], `corrections/${CID}/close`, 0,
    { correctionId: CID, undoHow: "git revert --no-edit abc", choseInstead: "a lease" }],
  [["correction", "withdraw", CID], `corrections/${CID}/withdraw`, 0, { correctionId: CID }],
  [["correction", "debug", CID, "--check", "npm test"], `corrections/${CID}/debug-group`, 0, { correctionId: CID, checks: ["npm test"] }],
  [["correction", "debug", CID, "--reopen"], `corrections/${CID}/debug-group`, 0, { correctionId: CID, reopen: true }],
  [["agent", "set-preferences", "--file", prefsFile], "operator/agent-preferences", 2, { preferences: { perAgent: {} } }],
  [["agent", "apply-update", "--accept", "ch-2", "--accept", "ch-1"], "operator/apply-agent-update", 2, { previewId: "pv-1", baseTableHash: H.table, acceptedChangeIds: ["ch-1", "ch-2"] }],
  [["usage", "set-cap", "--scope", "all", "--period", "week", "--tokens", "5000000"], "operator/set-spend-cap", 8, { scope: "all", period: "week", tokens: 5000000 }],
  [["usage", "clear-cap", "--scope", "repo:repo-1", "--period", "month"], "operator/clear-spend-cap", 8, { scope: "repo:repo-1", period: "month" }],
  [["usage", "set-calendar", "--time-zone", "UTC", "--week-start", "1"], "operator/set-usage-calendar", 8, { timeZone: "UTC", weekStart: 1 }],
  [["orchestration", "set", "--max-running-groups", "4"], "operator/set-orchestration-settings", 4, { maxRunningGroups: 4 }],
  [["orchestration", "set", "--max-running-groups", "2", "--criteria-review", "off", "--quota-wait", "claude-main"], "operator/set-orchestration-settings", 4,
    { maxRunningGroups: 2, criteriaReview: false, quotaWait: ["claude-main"] }],
  [["recovery", "retry", "--run", "run-1"], "recovery/retry", 5, { scope: "run", runId: "run-1" }],
  [["recovery", "retry", "--group", "g-al"], "recovery/retry", 5, { scope: "group", groupId: "g-alpha" }],
];

describe("project, decision, correction, agent, usage, orchestration, recovery writes (spec §4)", () => {
  it.each(MAPPINGS)("orca %j sends one POST %s at revision %i", async (argv, path, revision, payload) => {
    // The fake ledger checks each scope's own revision, as commandLedger.ts does.
    const w = await world({}, path.startsWith("groups/") || path === "recovery/retry" ? {} : { [`POST ${path}`]: accept(() => revision) });
    const out = await cli([...argv, "--json"], w.dir);
    expect(out.code, out.stdout + out.stderr).toBe(0);
    const posts = w.posts();
    expect(posts.map((p) => ({ path: p.path, expectedRevision: p.expectedRevision, payload: p.payload }))).toEqual([{ path, expectedRevision: revision, payload }]);
  });

  it("the token-tier rows say so in their help (spec §15.1)", async () => {
    const w = await world();
    for (const argv of [["usage", "set-cap"], ["agent", "apply-update"], ["group", "set-limit"], ["task", "settle-usage"]]) {
      expect((await cli([...argv, "--help"], w.dir)).stdout, JSON.stringify(argv)).toContain("person token");
    }
  });
});

describe("project register-plan (spec §14 R4)", () => {
  it("posts the plan's path relative to the project root to the socket's plans route", async () => {
    const w = await world({}, { "POST projects/proj/plans": { status: 201, body: { plan: { id: "proj.plan.json", path: "docs/plan.json", sha256: H.plan } } } });
    const out = await cli(["project", "register-plan", "docs/plan.json", "--json"], w.dir, { cwd: "/repos/proj" });
    expect(out.code, out.stderr).toBe(0);
    expect(w.requests.filter((r) => r.method === "POST").map((r) => [r.path, JSON.parse(r.text)])).toEqual([["projects/proj/plans", { path: "docs/plan.json" }]]);
    expect(out.json().body).toEqual({ plan: { id: "proj.plan.json", path: "docs/plan.json", sha256: H.plan } });
  });

  it("a refusal is the panel's answer: exit 2, its code named", async () => {
    const w = await world({}, { "POST projects/proj/plans": { status: 422, body: { code: "plan-path-missing", message: "no such file" } } });
    const out = await cli(["project", "register-plan", "/repos/proj/nope.json"], w.dir);
    expect(out.code).toBe(2);
    expect(out.stderr).toContain("plan-path-missing");
  });
});

describe("against a real panel", () => {
  it("project set-workspace-mode reads the repository revision and is accepted", async () => {
    const w = await workspace();
    await boot(w, [], { port: true });
    const out = await cli(["project", "set-workspace-mode", "--mode", "clone", "--json"], w.state, { cwd: w.repo });
    expect(out.code, out.stdout + out.stderr).toBe(0);
    const read = await cli(["control", "get", `repositories/${controlRepoKey("proj")}/workspace`], w.state);
    expect(read.json().body).toMatchObject({ workspaceMode: "clone", revision: 1 });
    // A second change reads the new revision itself.
    expect((await cli(["project", "set-workspace-mode", "--mode", "worktree"], w.state, { cwd: w.repo })).code).toBe(0);
  }, 60_000);
});

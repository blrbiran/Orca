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
  // Ruling: 这次批准改写所有必要的判据 (b37f7ce9): `project set-integration-check` is removed; `orca check` sends the
  // check verbs (checks spec 2026-10-22 §7), the project layer at the repository revision, --global at orchestration's.
  [["check", "set", "integration-check", "--on", "--no-command"], "repositories/repo-1/checks/settings", 7, { kind: "integration-check", set: { enabled: true, command: null }, clear: [] }],
  [["check", "set", "integration-check", "--command", "npm test"], "repositories/repo-1/checks/settings", 7, { kind: "integration-check", set: { command: "npm test" }, clear: [] }],
  [["check", "set", "model-review", "--off", "--budget-tokens", "500000", "--max-groups", "4", "--global"], "operator/checks/settings", 4,
    { kind: "model-review", set: { enabled: false, budgetTokens: 500000, maxGroupsPerReview: 4 }, clear: [] }],
  [["check", "set", "model-review", "--trigger", '{"all":[{"any":[{"kind":"queue-idle"}]}]}'], "repositories/repo-1/checks/settings", 7,
    { kind: "model-review", set: { trigger: { all: [{ any: [{ kind: "queue-idle" }] }] } }, clear: [] }],
  [["check", "reset", "model-review", "trigger", "budgetTokens"], "repositories/repo-1/checks/settings", 7, { kind: "model-review", set: {}, clear: ["trigger", "budgetTokens"] }],
  [["check", "reset", "integration-check", "command", "--global"], "operator/checks/settings", 4, { kind: "integration-check", set: {}, clear: ["command"] }],
  [["check", "schedule", "weekly", "--kind", "model-review", "--cron", "0 9 * * 1"], "repositories/repo-1/checks/scheduled", 7, { id: "weekly", kind: "model-review", cron: "0 9 * * 1", enabled: true }],
  [["check", "schedule", "weekly", "--kind", "model-review", "--cron", "0 9 * * 1", "--off", "--global"], "operator/checks/scheduled", 4, { id: "weekly", kind: "model-review", cron: "0 9 * * 1", enabled: false }],
  [["check", "schedule", "weekly", "--remove"], "repositories/repo-1/checks/scheduled", 7, { id: "weekly", remove: true }],
  [["check", "lock", "--lock", "modelReview.budgetTokens", "--lock", "integrationCheck.command"], "operator/checks/locks", 4, { locks: ["integrationCheck.command", "modelReview.budgetTokens"] }],
  [["check", "lock"], "operator/checks/locks", 4, { locks: [] }],
  [["check", "run", "model-review"], "repositories/repo-1/checks/run", 7, { kind: "model-review" }],
  [["check", "resume", "integration-check"], "repositories/repo-1/checks/resume", 7, { kind: "integration-check" }],
  [["project", "set-criteria-review", "--off"], "repositories/repo-1/criteria-review", 7, { enabled: false }],
  [["decision", "approve", "g-alpha", "pending-run-x-0", "--undo-how", "git revert --no-edit abc"], "groups/g-alpha/decisions/approve", 5, { pendingId: "pending-run-x-0", undoHow: "git revert --no-edit abc" }],
  [["decision", "reject", "g-alpha", "pending-run-x-0", "--because", "false premise"], "groups/g-alpha/decisions/reject", 5, { pendingId: "pending-run-x-0", because: "false premise" }],
  [["decision", "reject", "g-alpha", "pending-run-x-0"], "groups/g-alpha/decisions/reject", 5, { pendingId: "pending-run-x-0" }],
  [["decision", "ratify", "g-alpha", "run-x/agent-0"], "groups/g-alpha/decisions/ratify", 5, { decisionId: "run-x/agent-0" }],
  [["decision", "ratify", "g-alpha", "run-x/agent-0", "--note", "not a drift: both follow the spec"], "groups/g-alpha/decisions/ratify", 5, { decisionId: "run-x/agent-0", note: "not a drift: both follow the spec" }],
  [["correction", "record", "--decision", "run-1/1", "--kind", "wrong", "--because", "false premise"], "corrections", 0,
    { repoId: "repo-1", decisionId: "run-1/1", kind: "wrong", because: "false premise" }],
  [["correction", "record", "--decision", "run-1/1", "--kind", "stale", "--because", "b", "--chose-instead", "a lease", "--again"], "corrections", 0,
    { repoId: "repo-1", decisionId: "run-1/1", kind: "stale", because: "b", chose_instead: "a lease", again: true }],
  // Flow engine spec §13.2–§13.3 (W-COR): no --decision is a repository-only correction (one sentence); --run a bare run.
  [["correction", "record", "--kind", "wrong", "--because", "the export page lost its totals"], "corrections", 0,
    { repoId: "repo-1", kind: "wrong", because: "the export page lost its totals" }],
  [["correction", "record", "--run", "run-7", "--kind", "wrong", "--because", "b"], "corrections", 0,
    { repoId: "repo-1", runId: "run-7", kind: "wrong", because: "b" }],
  [["correction", "close", CID, "--undo-how", "git revert --no-edit abc", "--chose-instead", "a lease"], `corrections/${CID}/close`, 0,
    { correctionId: CID, undoHow: "git revert --no-edit abc", choseInstead: "a lease" }],
  [["correction", "withdraw", CID], `corrections/${CID}/withdraw`, 0, { correctionId: CID }],
  [["correction", "debug", CID, "--check", "npm test"], `corrections/${CID}/debug-group`, 0, { correctionId: CID, checks: ["npm test"] }],
  [["correction", "debug", CID, "--reopen"], `corrections/${CID}/debug-group`, 0, { correctionId: CID, reopen: true }],
  [["agent", "set-preferences", "--file", prefsFile], "operator/agent-preferences", 2, { preferences: { perAgent: {} } }],
  [["agent", "set-preferences", "--file", prefsFile, "--review", "codex-main:gpt-5"], "operator/agent-preferences", 2, { preferences: { perAgent: {}, review: { agent: "codex-main", model: "gpt-5" } } }],
  // Checks spec §6.1: --review alone keeps the current preferences (read now) and sets only the review slot.
  [["agent", "set-preferences", "--review", "claude-main"], "operator/agent-preferences", 2, { preferences: { perAgent: {}, review: { agent: "claude-main" } } }],
  [["agent", "apply-update", "--accept", "ch-2", "--accept", "ch-1"], "operator/apply-agent-update", 2, { previewId: "pv-1", baseTableHash: H.table, acceptedChangeIds: ["ch-1", "ch-2"] }],
  [["usage", "set-cap", "--scope", "all", "--period", "week", "--tokens", "5000000"], "operator/set-spend-cap", 8, { scope: "all", period: "week", tokens: 5000000 }],
  [["usage", "clear-cap", "--scope", "repo:repo-1", "--period", "month"], "operator/clear-spend-cap", 8, { scope: "repo:repo-1", period: "month" }],
  [["usage", "set-calendar", "--time-zone", "UTC", "--week-start", "1"], "operator/set-usage-calendar", 8, { timeZone: "UTC", weekStart: 1 }],
  [["orchestration", "set", "--max-running-groups", "4"], "operator/set-orchestration-settings", 4, { maxRunningGroups: 4 }],
  [["orchestration", "set", "--max-running-groups", "2", "--criteria-review", "off", "--quota-wait", "claude-main"], "operator/set-orchestration-settings", 4,
    { maxRunningGroups: 2, criteriaReview: false, quotaWait: ["claude-main"] }],
  [["recovery", "retry", "--run", "run-1"], "recovery/retry", 5, { scope: "run", runId: "run-1" }],
  [["recovery", "retry", "--group", "g-al"], "recovery/retry", 5, { scope: "group", groupId: "g-alpha" }],
  // Tester #103 (2026-10-28): the panel's charge-and-retry of a single call blocked on unknown usage, from the CLI.
  [["recovery", "retry", "--run", "run-1", "--acknowledge", "charge-remaining-grant"], "recovery/retry", 5, { scope: "run", runId: "run-1", acknowledge: "charge-remaining-grant" }],
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

  it("--acknowledge goes only with --run and only as charge-remaining-grant, refused before anything is sent (tester #103)", async () => {
    for (const argv of [["recovery", "retry", "--group", "g-al", "--acknowledge", "charge-remaining-grant"], ["recovery", "retry", "--run", "run-1", "--acknowledge", "release-unmetered"]]) {
      const w = await world();
      const out = await cli([...argv, "--json"], w.dir);
      expect(out.code, JSON.stringify(argv)).not.toBe(0);
      expect(w.posts(), JSON.stringify(argv)).toEqual([]);
    }
  });

  it("the token-tier rows say so in their help (spec §15.1)", async () => {
    const w = await world();
    for (const argv of [["usage", "set-cap"], ["agent", "apply-update"], ["group", "set-limit"], ["task", "settle-usage"], ["check", "lock"], ["check", "set"], ["check", "schedule"]]) {
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

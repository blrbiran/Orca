// CLI v2 plan Task 3 (spec §4 read rows, §14 R6, R7): each read's --json body is the panel's GET body verbatim, or the
// composition the spec names; human output is never empty; `command show` needs exactly one scope.
import { describe, expect, it } from "vitest";
import { cli, fakePanel, useFakePanels } from "./fixtures/fakePanel.js";
import { boot, useSocketPanels, workspace } from "../panel/fixtures/socketPanel.js";

useFakePanels();
useSocketPanels();

const ACTIVITY = Array.from({ length: 14 }, (_, i) => ({ seq: 100 - i, groupId: "g-alpha", taskId: "t1", runId: "run-1", at: 1_000 - i, kind: "phase", body: { i } }));
const GROUP = {
  schema: "orca-control-group-v1", epoch: "e", changeSeq: 9,
  summary: { groupId: "g-alpha", repoId: "repo-1", state: "running", commandRevision: 5 },
  plan: { repoId: "repo-1", planId: "p", planHash: "a".repeat(64), goal: "ship", successConditions: [] },
  proposal: { state: "confirmed", proposalVersion: 3, planHash: "a".repeat(64), budgetMode: "soft", contextPolicy: { handoffAtContextTokens: null }, profiles: null, executionSnapshotHash: null },
  ledger: { groupLimit: { tokens: 10, activeMs: 1, attempts: 1, sessions: 1 } },
  allocations: [{ ownerKind: "task", ownerId: "t1", bucket: "work", state: "confirmed", amount: { tokens: 5 } }],
  workItems: [{ taskId: "t1", status: "blocked", currentRunId: "run-1" }, { taskId: "t2", status: "ready", currentRunId: null }],
  runs: [{ runId: "run-1", taskId: "t1", state: "blocked" }, { runId: "run-0", taskId: "t2", state: "settled" }],
};
const EVIDENCE = { schema: "orca-run-evidence-v1", runId: "run-1", entries: [
  { evidenceId: "ev-1", kind: "terminal", sha256: "b".repeat(64), byteLength: 10, downloadUrl: "/x" },
  { evidenceId: "ev-2", kind: "log", sha256: "c".repeat(64), byteLength: 20, downloadUrl: "/y" },
] };
const RAW: Record<string, unknown> = {
  "summary": { schema: "orca-control-summary-v1", groups: [{ groupId: "g-alpha", state: "running", commandRevision: 5 }, { groupId: "g-beta", state: "draft", commandRevision: 1 }] },
  "groups/g-alpha": GROUP,
  "groups/g-beta": { ...GROUP, summary: { ...GROUP.summary, groupId: "g-beta" }, runs: [] },
  "groups/g-alpha/requirement": { schema: "orca-requirement-view-v1", summary: { groupId: "g-alpha", commandRevision: 5 } },
  "groups/g-alpha/decisions": { schema: "orca-group-decisions-v1", tasks: [] },
  "groups/g-alpha/funding-preview": { schema: "orca-funding-preview-v1", groupId: "g-alpha", rows: [] },
  "runs/run-1/activity": { schema: "orca-run-activity-v1", runId: "run-1", entries: ACTIVITY },
  "runs/run-1/evidence": EVIDENCE,
  "runs/run-1/evidence/ev-2/content": { schema: "orca-run-evidence-content-v1", runId: "run-1", evidenceId: "ev-2", sha256: "c".repeat(64), byteLength: 20, truncated: false, encoding: "utf8", text: "line one\nline two\n" },
  "runs/run-1/results": { schema: "orca-run-results-v1", runId: "run-1" },
  "runs/run-1/saved-result-eligibility": { status: "unavailable", reason: "x" },
  "corrections": { schema: "orca-correction-list-v1", corrections: [] },
  "agents": { schema: "orca-agents-view-v1", installations: [{ id: "claude-main", kind: "claude" }] },
  "agents/claude-main/models": { schema: "orca-agent-models-v1", installation: "claude-main", models: [] },
  "usage?scope=all": { schema: "orca-usage-view-v1", scope: "all", spendRevision: 2 },
  "orchestration": { schema: "orca-orchestration-v1", revision: 4, maxRunningGroups: 3, runningGroups: 1 },
  "recovery": { schema: "orca-control-recovery-v1", blockers: [] },
  "projects": { source: "command-line", projects: [{ projectKey: "proj", name: "proj", path: "/repos/proj", controlRepoId: "repo-1" }] },
  "repositories/repo-1/workspace": { schema: "orca-repository-workspace-v1", repoId: "repo-1", workspaceMode: "worktree", revision: 7 },
  "repositories/repo-1/integration": { schema: "orca-repository-integration-v1", repoId: "repo-1", integration: { delivery: "keep" }, revision: 7 },
  "operator/agent-preferences": { schema: "orca-agent-preferences-v1", operatorId: "operator-1", revision: 0 },
  "groups/g-alpha/commands/cli-1": { schema: "orca-command-lookup-v1", originalStatus: 200, body: { ok: 1 } },
  "groups/@spend/commands/cli-2": { schema: "orca-command-lookup-v1", originalStatus: 200, body: { ok: 2 } },
  "groups/@repository:repo-1/commands/cli-3": { schema: "orca-command-lookup-v1", originalStatus: 200, body: { ok: 3 } },
  "groups/@operator:operator-1/commands/cli-4": { schema: "orca-command-lookup-v1", originalStatus: 200, body: { ok: 4 } },
};
const panel = () => fakePanel(Object.fromEntries(Object.entries(RAW).map(([path, body]) => [`GET ${path}`, { status: 200, body }])));

describe("reads whose body is the panel's GET body verbatim (spec §4)", () => {
  const cases: Array<[string[], string]> = [
    [["group", "list"], "summary"], [["group", "show", "g-al"], "groups/g-alpha"], [["requirement", "show", "g-alpha"], "groups/g-alpha/requirement"],
    [["decision", "list", "g-alpha"], "groups/g-alpha/decisions"], [["run", "activity", "run-1"], "runs/run-1/activity"],
    [["run", "evidence", "run-1"], "runs/run-1/evidence"], [["run", "evidence", "run-1", "--id", "ev-2"], "runs/run-1/evidence/ev-2/content"], [["run", "results", "run-1"], "runs/run-1/results"],
    [["run", "eligibility", "run-1"], "runs/run-1/saved-result-eligibility"], [["correction", "list"], "corrections"],
    [["agent", "list"], "agents"], [["agent", "models", "claude-main"], "agents/claude-main/models"], [["usage", "show"], "usage?scope=all"],
    [["orchestration", "show"], "orchestration"], [["recovery", "list"], "recovery"], [["project", "list"], "projects"],
    [["command", "show", "cli-1", "--group", "g-alpha"], "groups/g-alpha/commands/cli-1"], [["command", "show", "cli-2", "--spend"], "groups/@spend/commands/cli-2"],
    [["command", "show", "cli-3", "--project", "proj"], "groups/@repository:repo-1/commands/cli-3"], [["command", "show", "cli-4", "--operator"], "groups/@operator:operator-1/commands/cli-4"],
  ];
  it.each(cases)("orca %j --json is GET %s's body, and human text is not empty", async (argv, path) => {
    const p = await panel();
    const json = await cli([...argv, "--json"], p.dir);
    expect([json.code, json.stdout.split("\n").length], json.stderr).toEqual([0, 2]);
    expect(json.json()).toEqual({ schema: "orca-cli-response-v1", status: 200, body: RAW[path] });
    const human = await cli(argv, p.dir);
    expect(human.code).toBe(0);
    expect(human.stdout.trim().length).toBeGreaterThan(0);
  });

  it("run evidence --id prints that entry's content, and a binary entry says base64 (#184)", async () => {
    const p = await panel();
    const text = await cli(["run", "evidence", "run-1", "--id", "ev-2"], p.dir);
    expect(text.code, text.stderr).toBe(0);
    expect(text.stdout).toContain("evidence ev-2");
    expect(text.stdout).toContain("line two");
    const raw = Object.fromEntries(Object.entries(RAW).map(([path, body]) => [`GET ${path}`, { status: 200, body }]));
    raw["GET runs/run-1/evidence/ev-3/content"] = { status: 200, body: { schema: "orca-run-evidence-content-v1", runId: "run-1", evidenceId: "ev-3", sha256: "d".repeat(64), byteLength: 4, truncated: true, encoding: "base64", base64: "AP/+QQ==" } };
    const binaryPanel = await fakePanel(raw);
    const binary = await cli(["run", "evidence", "run-1", "--id", "ev-3"], binaryPanel.dir);
    expect(binary.code, binary.stderr).toBe(0);
    expect(binary.stdout).toContain("encoding base64");
    expect(binary.stdout).toContain("AP/+QQ==");
    expect(binary.stdout).toContain("(truncated)");
  });
});

describe("composed reads (spec §14 R6; proposal, task and project views)", () => {
  it("run show = the group view's run entry + the activity head (newest 10) + the evidence summary", async () => {
    const p = await panel();
    const expected = {
      schema: "orca-run-show-v1", groupId: "g-alpha", run: GROUP.runs[0],
      activity: { entries: ACTIVITY.slice(0, 10), more: true },
      evidence: { count: 2, entries: [{ evidenceId: "ev-1", kind: "terminal", byteLength: 10 }, { evidenceId: "ev-2", kind: "log", byteLength: 20 }] },
    };
    expect((await cli(["run", "show", "run-1", "--group", "g-alpha", "--json"], p.dir)).json().body).toEqual(expected);
    // Without --group the run is found by reading the groups the summary lists.
    expect((await cli(["run", "show", "run-1", "--json"], p.dir)).json().body).toEqual(expected);
    const human = await cli(["run", "show", "run-1"], p.dir);
    expect(human.stdout).toContain("run-1");
    expect(human.stdout).toContain("phase");
  });

  it("a run no group lists is run-not-found, exit 1", async () => {
    const p = await panel();
    const out = await cli(["run", "show", "run-404", "--json"], p.dir);
    expect([out.code, out.json().body.error.code]).toEqual([1, "run-not-found"]);
  });

  // Tester follow-up E §3 (#242): an explicit --group used to skip the only membership check, so run show printed
  // another group's id beside this run's activity and evidence. It refuses before reading either; the group that does
  // list the run still answers as before.
  it("run show --group refuses a group whose view does not list the run, before reading activity or evidence (#242)", async () => {
    const p = await panel();
    const out = await cli(["run", "show", "run-1", "--group", "g-beta", "--json"], p.dir);
    expect([out.code, out.json().body.error.code, out.json().body.error.message]).toEqual([1, "run-not-found", "run run-1 is not in group g-beta"]);
    expect(p.requests.filter((r) => r.path.startsWith("runs/")).map((r) => r.path)).toEqual([]);
    const human = await cli(["run", "show", "run-1", "--group", "g-beta"], p.dir);
    expect(human.code).toBe(1);
    expect(human.stderr).toContain("run-not-found: run run-1 is not in group g-beta");
    expect((await cli(["run", "show", "run-1", "--group", "g-alpha", "--json"], p.dir)).json().body.groupId).toBe("g-alpha");
  });

  it("proposal show, task show and project show compose their parts of the reads", async () => {
    const p = await panel();
    expect((await cli(["proposal", "show", "g-alpha", "--json"], p.dir)).json().body).toEqual({
      schema: "orca-proposal-view-v1", groupId: "g-alpha", revision: 5, proposal: GROUP.proposal, allocations: GROUP.allocations, groupLimit: GROUP.ledger.groupLimit,
    });
    expect((await cli(["task", "show", "g-alpha", "t1", "--json"], p.dir)).json().body).toEqual({
      schema: "orca-task-show-v1", groupId: "g-alpha", revision: 5, task: GROUP.workItems[0], runs: [GROUP.runs[0]],
    });
    expect((await cli(["project", "show", "--project", "proj", "--json"], p.dir)).json().body).toEqual({
      schema: "orca-project-show-v1", repoId: "repo-1", projectKey: "proj", path: "/repos/proj",
      workspace: RAW["repositories/repo-1/workspace"], integration: RAW["repositories/repo-1/integration"],
    });
  });
});

describe("command show scopes (spec §14 R7)", () => {
  it("without a scope flag, or with two, it is refused here (exit 1) and nothing is asked of the panel", async () => {
    for (const argv of [["command", "show", "cli-1"], ["command", "show", "cli-1", "--group", "g-alpha", "--spend"]]) {
      const p = await panel();
      const out = await cli([...argv, "--json"], p.dir);
      expect([out.code, out.json().body.error.code], JSON.stringify(argv)).toEqual([1, "control-cli-argument-invalid"]);
      expect(p.requests).toEqual([]);
    }
  });

  it("a lookup miss is the panel's answer: exit 2", async () => {
    const p = await panel();
    expect((await cli(["command", "show", "cli-9", "--group", "g-alpha"], p.dir)).code).toBe(2);
  });
});

describe("against a real panel", () => {
  it("group list, recovery list and orchestration show answer as the panel's GET does", async () => {
    const w = await workspace();
    await boot(w);
    for (const [argv, path] of [[["group", "list"], "summary"], [["recovery", "list"], "recovery"], [["orchestration", "show"], "orchestration"]] as const) {
      const out = await cli([...argv, "--json"], w.state);
      expect(out.code, out.stderr).toBe(0);
      const raw = await cli(["control", "get", path], w.state);
      expect(out.json().body).toEqual(raw.json().body);
    }
  }, 60_000);
});

// Issue 146 (session 3cfc2e73): a multi project's row carries its primary member's path for display (multi spec §4.2).
// The CLI must not resolve a cwd to the multi by that path, and the human list must say which row is a multi.
describe("multi projects in project resolution and the project list (issue 146)", () => {
  const MULTI_PROJECTS = { source: "file", editable: true, pendingRestart: [], fileError: null, projects: [
    // Sorted by key, as the panel lists them: the multi "app" comes before its primary member "backend".
    { projectKey: "app", name: "app", path: "/repos/backend", kind: "multi", dirs: [{ projectKey: "backend", kind: "repo" }, { projectKey: "web", kind: "repo" }], controlRepoId: "multi-app" },
    { projectKey: "backend", name: "backend", path: "/repos/backend", controlRepoId: "repo-b" },
    { projectKey: "web", name: "web", path: "/repos/web", controlRepoId: "repo-w" },
  ] };
  const settings = (repoId: string) => ({
    [`GET repositories/${repoId}/workspace`]: { status: 200, body: { repoId, workspaceMode: "worktree", revision: 1 } },
    [`GET repositories/${repoId}/integration`]: { status: 200, body: { repoId, integration: { delivery: "keep" }, revision: 1 } },
  });
  const multiPanel = () => fakePanel({ "GET projects": { status: 200, body: MULTI_PROJECTS }, ...settings("repo-b"), ...settings("multi-app") });

  it("a cwd inside the primary member resolves to the member repository, not the multi", async () => {
    const p = await multiPanel();
    const out = await cli(["project", "show", "--json"], p.dir, { cwd: "/repos/backend/src" });
    expect(out.code, out.stdout).toBe(0);
    expect(out.json().body).toMatchObject({ repoId: "repo-b", projectKey: "backend" });
    expect(out.json().body.kind).toBeUndefined();
  });

  it("--project <the multi's key> is the multi, and project show names its kind and members", async () => {
    const p = await multiPanel();
    const out = await cli(["project", "show", "--project", "app", "--json"], p.dir, { cwd: "/repos/backend/src" });
    expect(out.code, out.stdout).toBe(0);
    expect(out.json().body).toMatchObject({ repoId: "multi-app", projectKey: "app", kind: "multi", dirs: ["backend", "web"] });
  });

  it("the human project list names each row's kind, and a multi's members instead of the primary's path", async () => {
    const p = await multiPanel();
    const out = await cli(["project", "list"], p.dir);
    expect(out.code).toBe(0);
    expect(out.stdout.split("\n").filter(Boolean)).toEqual([
      "app  multi  multi-app  members backend, web",
      "backend  repo  repo-b  /repos/backend",
      "web  repo  repo-w  /repos/web",
    ]);
  });
});

// Issue 152 (session 3cfc2e73): rows that never use the project still took --project and ignored it, so a misspelt
// one passed silently. It is now checked once at dispatch, with the refusal every project-scoped command gives.
describe("--project is validated on every panel row (issue 152)", () => {
  it.each([[["usage", "show"]], [["group", "show", "g-alpha"]], [["recovery", "list"]]])("orca %j --project <unknown> is project-not-found, exit 1", async (argv) => {
    const p = await panel();
    const out = await cli([...argv, "--project", "no-such-project", "--json"], p.dir);
    expect([out.code, out.json().body.error.code]).toEqual([1, "project-not-found"]);
  });

  it("a registered --project still answers the row as before", async () => {
    const p = await panel();
    const out = await cli(["usage", "show", "--project", "proj", "--json"], p.dir);
    expect(out.code, out.stdout).toBe(0);
    expect(out.json().body).toEqual(RAW["usage?scope=all"]);
  });
});

// Issue 151 (session 3cfc2e73): group list took --project and ignored it. Without the flag it still lists every group
// (spec §4, unchanged); with it, only that project's groups. The human line names each group's repository.
describe("group list --project (issue 151)", () => {
  const TWO_REPOS = { ...RAW.summary as object, groups: [
    { groupId: "g-one", repoId: "repo-1", state: "running", commandRevision: 5, goal: "ship" },
    { groupId: "g-two", repoId: "repo-2", state: "draft", commandRevision: 1, goal: "other" },
  ] };
  const twoRepoPanel = () => fakePanel({ "GET summary": { status: 200, body: TWO_REPOS }, "GET projects": { status: 200, body: RAW.projects } });

  it("with --project, only that project's groups; without it, every group as before", async () => {
    const p = await twoRepoPanel();
    const filtered = await cli(["group", "list", "--project", "proj", "--json"], p.dir);
    expect(filtered.code, filtered.stdout).toBe(0);
    expect(filtered.json().body.groups.map((g: { groupId: string }) => g.groupId)).toEqual(["g-one"]);
    const all = await cli(["group", "list", "--json"], p.dir);
    expect(all.json().body).toEqual(TWO_REPOS);
  });

  it("the human line names the group's repository", async () => {
    const p = await twoRepoPanel();
    const out = await cli(["group", "list"], p.dir);
    expect(out.stdout.split("\n").filter(Boolean)).toEqual(["g-one  repo-1  running  rev 5  ship", "g-two  repo-2  draft  rev 1  other"]);
  });
});

// Issue 148 (session 3cfc2e73): a broken projects.json (the panel keeps the last good list, registry spec) and edits
// waiting for a restart showed only under --json; the human list looked healthy.
describe("the human project list says a broken projects file and pending restarts (issue 148)", () => {
  const ROWS = [{ projectKey: "proj", name: "proj", path: "/repos/proj", controlRepoId: "repo-1" }];
  const listed = async (body: unknown) => {
    const p = await fakePanel({ "GET projects": { status: 200, body } });
    const out = await cli(["project", "list"], p.dir);
    expect(out.code).toBe(0);
    return out.stdout.split("\n").filter(Boolean);
  };

  it("fileError and pendingRestart get their own lines after the rows", async () => {
    expect(await listed({ source: "file", projects: ROWS, fileError: "Unexpected token } in JSON", pendingRestart: ["alpha", "beta"] })).toEqual([
      "proj  repo  repo-1  /repos/proj",
      "error: the projects file is not in effect (the list above is the last good one): Unexpected token } in JSON",
      "restart needed for: alpha, beta (orca panel restart)",
    ]);
  });

  it("a healthy file adds no line", async () => {
    expect(await listed({ source: "file", projects: ROWS, fileError: null, pendingRestart: [] })).toEqual(["proj  repo  repo-1  /repos/proj"]);
  });
});

// Scheduled flows and groups spec 2026-10-24 §13.1, §16, criterion C12 (plan Task 4: the `plan` rows and `group import
// --library`; P2 adds the `schedule` rows). Each row maps to its verb or read; `plan import` reads the file here and sends
// a document, never a path; `plan export --out` writes a new 0600 file and nothing else. HOME and every ORCA_* variable
// point into temp dirs, and nothing appears under HOME (Rule 17).
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { canonicalBytes, sha256Canonical } from "../../src/control/canonicalJson.js";
import { cli, useFakePanels } from "./fixtures/fakePanel.js";
import { accept, H, world } from "./fixtures/world.js";

useFakePanels();

const temp = (prefix: string): string => realpathSync(mkdtempSync(join(tmpdir(), prefix)));
const HOME = temp("sched-cli-home-");
const ENV = {
  HOME, XDG_CONFIG_HOME: join(HOME, "xdg"),
  ORCA_PANEL_DIR: join(temp("sched-cli-panel-"), "panel"), ORCA_PROJECTS_FILE: join(temp("sched-cli-projects-"), "p.json"),
  ORCA_CONTROL_DIR: temp("sched-cli-control-"), ORCA_CORRECTIONS_DIR: temp("sched-cli-corrections-"), ORCA_PERSON_DIR: temp("sched-cli-person-"),
};
let umask = 0;
beforeAll(() => {
  for (const [key, value] of Object.entries(ENV)) vi.stubEnv(key, value);
  // Rule 17: a mode the code does not set explicitly would show here as 0644.
  umask = process.umask(0o022);
});
afterAll(() => { vi.unstubAllEnvs(); process.umask(umask); });
const run = (argv: string[], dir: string, cwd = "/") => cli(argv, dir, { env: ENV, cwd });

const ENTRY = "pl-0123456789abcdef";
const contract = (taskId: string, repoPath: string) => ({
  objective: { taskId, goal: "ship", successCondition: "passes", nonGoals: [] },
  context: { repoPath, targetPaths: [taskId], relevantDocs: [], buildTestCommands: ["true"], constraints: [] },
  executionPolicy: { autonomyLevel: "L2", maxAttempts: 9, perAttemptTimeoutMs: 60_000, totalRuntimeBudgetMs: 90_000, tokenBudget: 99_000, worktreeRequired: true, partialOutcomeRecoveryWindowMs: 30_000 },
  safetyPolicy: { allowlistPaths: [], denylistPaths: [], maxFilesTouched: 1, humanGateConditions: [] },
  verification: { verifierType: "command", requiredChecks: ["true"], rejectOn: ["failure"], evidenceRequired: [] },
  escalationAndExit: { escalationTargets: [], pauseOn: [], stopOn: [], terminalStates: ["succeeded", "blocked_waiting_human", "exhausted", "cancelled", "failed"] },
});
const DOC = { schema: "orca-plan-v1", goal: "ship", successConditions: ["passes"], tasks: [{ taskId: "a", dependsOn: [], targetVersion: 1, contract: contract("a", "/repos/proj") }] };
const SHA = sha256Canonical(DOC);
const entryView = { schema: "orca-plan-library-entry-v1", entryId: ENTRY, projectId: "repo-1", name: "weekly", state: "active", head: { version: 2, sha256: SHA }, versions: [{ version: 1, sha256: H.plan }, { version: 2, sha256: SHA }], usedBy: [] };
const LIBRARY_READS = {
  [`GET plan-library/${ENTRY}`]: { status: 200, body: entryView },
  [`GET plan-library/${ENTRY}/versions/${SHA}`]: { status: 200, body: DOC },
  "GET plan-library?repoId=repo-1": { status: 200, body: { schema: "orca-plan-library-v1", repoId: "repo-1", entries: [] } },
  "POST plan-library/save": { status: 200, body: { result: { kind: "plan-library-saved" } } },
  "POST plan-library/import": { status: 200, body: { result: { kind: "plan-library-saved" } } },
  "POST plan-library/archive": { status: 200, body: { result: { kind: "plan-library-archived" } } },
};

describe("the plan rows map to their verb or read (§13.1)", () => {
  const WRITES: Array<[string[], string, number, unknown]> = [
    [["plan", "save", "--group", "g-al"], "plan-library/save", 0, { source: { kind: "group", groupId: "g-alpha" }, name: "g-alpha" }],
    [["plan", "save", "--group", "g-alpha", "--name", "weekly", "--entry", ENTRY], "plan-library/save", 0, { source: { kind: "group", groupId: "g-alpha" }, name: "weekly", entryId: ENTRY }],
    [["plan", "save", "--requirement", "g-alpha", "--draft", "1"], "plan-library/save", 0, { source: { kind: "requirement-draft", groupId: "g-alpha", draftNo: 1, draftHash: H.draft }, name: "g-alpha" }],
    [["plan", "archive", ENTRY], "plan-library/archive", 0, { entryId: ENTRY }],
    [["group", "import", "--library", ENTRY, "--group", "g-new"], "groups/import-plan", 0, { groupId: "g-new", repoId: "repo-1", libraryEntry: { entryId: ENTRY, sha256: SHA } }],
    [["group", "import", "--library", ENTRY, "--version", H.plan.slice(0, 8), "--group", "g-new"], "groups/import-plan", 0, { groupId: "g-new", repoId: "repo-1", libraryEntry: { entryId: ENTRY, sha256: H.plan } }],
    [["group", "import", "plan-a", "--group", "g-new"], "groups/import-plan", 0, { groupId: "g-new", repoId: "repo-1", planId: "plan-a" }],
  ];
  it.each(WRITES)("orca %j sends one POST %s at revision %i", async (argv, path, revision, payload) => {
    const w = await world({}, LIBRARY_READS);
    const out = await run([...argv, "--json"], w.dir);
    expect(out.code, out.stdout + out.stderr).toBe(0);
    expect(w.posts().map((p) => ({ path: p.path, expectedRevision: p.expectedRevision, payload: p.payload }))).toEqual([{ path, expectedRevision: revision, payload }]);
  });

  it.each([
    [["plan", "list"], "plan-library?repoId=repo-1"],
    [["plan", "list", "--archived"], "plan-library?repoId=repo-1&archived=1"],
    [["plan", "show", ENTRY], `plan-library/${ENTRY}`],
  ])("orca %j reads GET %s", async (argv, path) => {
    const w = await world({}, { ...LIBRARY_READS, "GET plan-library?repoId=repo-1&archived=1": { status: 200, body: { entries: [] } } });
    const out = await run([...argv, "--json"], w.dir);
    expect(out.code, out.stdout + out.stderr).toBe(0);
    expect(w.requests.filter((r) => r.method === "GET" && r.path.startsWith("plan-library")).map((r) => r.path)).toEqual([path]);
    expect(w.posts()).toEqual([]);
  });

  it("plan show --version adds that version's document", async () => {
    const w = await world({}, LIBRARY_READS);
    const out = await run(["plan", "show", ENTRY, "--version", SHA, "--json"], w.dir);
    expect(out.code, out.stderr).toBe(0);
    expect(out.json().body).toMatchObject({ entryId: ENTRY, document: DOC });
  });

  it("refuses here, before sending: both or neither of a plan id and --library; --draft without --requirement", async () => {
    const w = await world({}, LIBRARY_READS);
    for (const argv of [["group", "import", "plan-a", "--library", ENTRY], ["group", "import"], ["plan", "save", "--group", "g-alpha", "--draft", "1"], ["plan", "save"]]) {
      const out = await run([...argv, "--json"], w.dir);
      expect([out.code, out.json().body.error?.code], argv.join(" ")).toEqual([1, "control-cli-argument-invalid"]);
    }
    expect(w.posts()).toEqual([]);
  });
});

describe("the schedule rows map to their verb (§13.1)", () => {
  it("sends --param values as their scalar types, and keeps __proto__ an own key", async () => {
    const w = await world({}, { ...LIBRARY_READS, "POST schedules/sch-weekly": accept(() => 0) });
    const out = await run(["schedule", "add", "flow", "wechat-article", "--cron", "0 9 * * 1", "--name", "weekly",
      "--param", "illustrations=true", "--param", "n=3", "--param", "__proto__=x", "--json"], w.dir);
    expect(out.code, out.stdout + out.stderr).toBe(0);
    const [post] = w.posts();
    expect(post!.path).toBe("schedules/sch-weekly");
    // Coerced as `flow`'s scalar: true/false and safe integers as such, anything else as text.
    const params = (post!.payload as { start: { params: Record<string, unknown> } }).start.params;
    expect(params.illustrations).toBe(true);
    expect(params.n).toBe(3);
    // An own key, so the panel's own-key check refuses it as "not a parameter"; the CLI never silently drops it.
    expect(Object.hasOwn(params, "__proto__")).toBe(true);
    expect(Object.getOwnPropertyDescriptor(params, "__proto__")!.value).toBe("x");
  });
});

describe("a group pin shows its provenance and confirm mode (§13.1, §9.3)", () => {
  const AT = 1760000000000;
  const NEXT = "b".repeat(64);
  const NEW_ID = `sch-${ENTRY}`;
  const version = (over: { sha256: string; version: number; by: string; via: string; at: number; origin: string }) => ({ ...over });
  const pinned = {
    ...LIBRARY_READS,
    [`GET plan-library/${ENTRY}`]: { status: 200, body: { schema: "orca-plan-library-entry-v1", entryId: ENTRY, versions: [version({ version: 1, sha256: H.plan, by: "ana", via: "web", at: AT, origin: "group" })] } },
  };
  const repinned = {
    ...LIBRARY_READS,
    [`GET plan-library/${ENTRY}`]: { status: 200, body: { schema: "orca-plan-library-entry-v1", entryId: ENTRY, versions: [
      version({ version: 1, sha256: H.plan, by: "ana", via: "web", at: AT, origin: "group" }),
      version({ version: 2, sha256: NEXT, by: "bo", via: "cli", at: AT + 1000, origin: "requirement" }),
    ] } },
  };

  const ADD_GROUP_MODES: Array<[string[], number | null, string]> = [
    [[], null, "confirm mode: runs on its own"],
    [["--token-limit", "500000"], 500000, "confirm mode: waits for your click (token limit 500000)"],
  ];
  it.each(ADD_GROUP_MODES)("add group prints the pinned version and its mode (%j), and sends at revision 0", async (extra, tokenLimit, line) => {
    const w = await world({}, { ...pinned, [`POST schedules/${NEW_ID}`]: accept(() => 0) });
    const out = await run(["schedule", "add", "group", ENTRY, "--version", H.plan, "--cron", "0 9 * * 1", ...extra, "--json"], w.dir);
    expect(out.code, out.stdout + out.stderr).toBe(0);
    // stdout stays the JSON envelope; the informative lines are stderr only.
    expect(out.json()).toMatchObject({ schema: "orca-cli-response-v1", status: 200 });
    expect(w.posts()).toEqual([{
      path: `schedules/${NEW_ID}`, commandId: expect.any(String), expectedRevision: 0,
      payload: { projectId: "repo-1", name: ENTRY, cron: "0 9 * * 1", enabled: true,
        start: { kind: "group", entryId: ENTRY, sha256: H.plan, tokenLimit, integration: null } },
    }]);
    expect(out.stderr).toContain(`version ${H.plan} — saved by ana via web at ${new Date(AT).toISOString()} from group`);
    expect(out.stderr).toContain(line);
  });

  it("add group of an older version prints that version's provenance, not the newest", async () => {
    const w = await world({}, { ...repinned, [`POST schedules/${NEW_ID}`]: accept(() => 0) });
    const out = await run(["schedule", "add", "group", ENTRY, "--version", H.plan, "--cron", "0 9 * * 1", "--json"], w.dir);
    expect(out.code, out.stdout + out.stderr).toBe(0);
    expect((w.posts()[0]!.payload as { start: { sha256: string } }).start.sha256).toBe(H.plan);
    expect(out.stderr).toContain(`version ${H.plan} — saved by ana via web at ${new Date(AT).toISOString()} from group`);
    expect(out.stderr).not.toContain(`version ${NEXT}`);
    expect(out.stderr).not.toContain("saved by bo");
  });

  it("add group --quiet keeps stdout the JSON envelope and prints neither the provenance nor the mode", async () => {
    const w = await world({}, { ...repinned, [`POST schedules/${NEW_ID}`]: accept(() => 0) });
    const out = await run(["schedule", "add", "group", ENTRY, "--version", H.plan, "--cron", "0 9 * * 1", "--quiet", "--json"], w.dir);
    expect(out.code, out.stdout + out.stderr).toBe(0);
    expect(out.json()).toMatchObject({ schema: "orca-cli-response-v1", status: 200 });
    expect(out.stderr).not.toContain("confirm mode:");
    expect(out.stderr).not.toContain("saved by");
  });

  it("edit --token-limit without --repin keeps the pinned version, sends the whole start and prints the new mode", async () => {
    const w = await world({}, {
      ...pinned,
      "GET schedules/sch-weekly": { status: 200, body: { schema: "orca-schedule-v1", id: "sch-weekly", kind: "group", revision: 3,
        start: { kind: "group", entryId: ENTRY, sha256: H.plan, tokenLimit: null, integration: null } } },
      "POST schedules/sch-weekly": accept(() => 3),
    });
    const out = await run(["schedule", "edit", "sch-weekly", "--token-limit", "500000", "--json"], w.dir);
    expect(out.code, out.stdout + out.stderr).toBe(0);
    expect(w.posts().map((p) => ({ path: p.path, expectedRevision: p.expectedRevision, payload: p.payload }))).toEqual([{
      path: "schedules/sch-weekly", expectedRevision: 3,
      payload: { set: { start: { kind: "group", entryId: ENTRY, sha256: H.plan, tokenLimit: 500000, integration: null } } },
    }]);
    expect(out.stderr).toContain("confirm mode: waits for your click (token limit 500000)");
  });

  it("add group without --version is refused here, with nothing sent", async () => {
    const w = await world({}, pinned);
    const out = await run(["schedule", "add", "group", ENTRY, "--cron", "0 9 * * 1", "--json"], w.dir);
    expect([out.code, out.json().body.error?.code]).toEqual([1, "control-cli-argument-invalid"]);
    expect(w.posts()).toEqual([]);
  });

  it("edit --repin sends the whole start with the new sha256 at the schedule's revision, and prints its provenance and mode", async () => {
    const integration = { delivery: "push-branch", trigger: "group", target: "main", remote: "origin" };
    const w = await world({}, {
      ...repinned,
      "GET schedules/sch-weekly": { status: 200, body: { schema: "orca-schedule-v1", id: "sch-weekly", kind: "group", revision: 3,
        start: { kind: "group", entryId: ENTRY, sha256: H.plan, tokenLimit: 500000, integration } } },
      "POST schedules/sch-weekly": accept(() => 3),
    });
    const out = await run(["schedule", "edit", "sch-weekly", "--repin", NEXT, "--json"], w.dir);
    expect(out.code, out.stdout + out.stderr).toBe(0);
    expect(out.json()).toMatchObject({ schema: "orca-cli-response-v1", status: 200 });
    expect(w.posts().map((p) => ({ path: p.path, expectedRevision: p.expectedRevision, payload: p.payload }))).toEqual([{
      path: "schedules/sch-weekly", expectedRevision: 3,
      payload: { set: { start: { kind: "group", entryId: ENTRY, sha256: NEXT, tokenLimit: 500000, integration } } },
    }]);
    expect(out.stderr).toContain(`version ${NEXT} — saved by bo via cli at ${new Date(AT + 1000).toISOString()} from requirement`);
    expect(out.stderr).toContain("confirm mode: waits for your click (token limit 500000, delivery push-branch)");
  });

  it("edit --unlimited sets tokenLimit null and prints that it runs on its own", async () => {
    const w = await world({}, {
      ...pinned,
      "GET schedules/sch-weekly": { status: 200, body: { schema: "orca-schedule-v1", id: "sch-weekly", kind: "group", revision: 3,
        start: { kind: "group", entryId: ENTRY, sha256: H.plan, tokenLimit: 500000, integration: null } } },
      "POST schedules/sch-weekly": accept(() => 3),
    });
    const out = await run(["schedule", "edit", "sch-weekly", "--unlimited", "--json"], w.dir);
    expect(out.code, out.stdout + out.stderr).toBe(0);
    expect(w.posts()[0]!.payload).toEqual({ set: { start: { kind: "group", entryId: ENTRY, sha256: H.plan, tokenLimit: null, integration: null } } });
    expect(out.stderr).toContain("confirm mode: runs on its own");
  });

  it("edit --repin of a flow schedule is refused here, with nothing sent", async () => {
    const w = await world({}, {
      ...repinned,
      "GET schedules/sch-weekly": { status: 200, body: { schema: "orca-schedule-v1", id: "sch-weekly", kind: "flow", revision: 3,
        start: { kind: "flow", template: "wechat-article", params: {} } } },
      "POST schedules/sch-weekly": accept(() => 3),
    });
    const out = await run(["schedule", "edit", "sch-weekly", "--repin", NEXT, "--json"], w.dir);
    expect([out.code, out.json().body.error?.code]).toEqual([1, "control-cli-argument-invalid"]);
    expect(w.posts()).toEqual([]);
  });
});

describe("the schedule reads: list, --all, fires and show (§13.1)", () => {
  it("list reads only this project's schedules", async () => {
    const w = await world({}, { "GET schedules?repoId=repo-1": { status: 200, body: { schema: "orca-schedules-v1", repoId: "repo-1", schedules: [], corrupt: [] } } });
    const out = await run(["schedule", "list", "--json"], w.dir);
    expect(out.code, out.stdout + out.stderr).toBe(0);
    expect(w.requests.map((r) => `${r.method} ${r.path}`)).toEqual(["GET projects", "GET schedules?repoId=repo-1"]);
    expect(out.json().body).toEqual({ schema: "orca-schedules-v1", repoId: "repo-1", schedules: [], corrupt: [] });
  });

  it("list --all reads projects once, then one schedules read per controlRepoId, and merges them", async () => {
    const w = await world({}, {
      "GET projects": { status: 200, body: { source: "command-line", projects: [
        { projectKey: "proj", name: "proj", path: "/repos/proj", controlRepoId: "repo-1" },
        { projectKey: "two", name: "two", path: "/repos/two", controlRepoId: "repo-2" },
        { projectKey: "again", name: "again", path: "/repos/again", controlRepoId: "repo-1" },
        { projectKey: "none", name: "none", path: "/repos/none", controlRepoId: null },
      ] } },
      "GET schedules?repoId=repo-1": { status: 200, body: { schema: "orca-schedules-v1", repoId: "repo-1", schedules: [{ id: "sch-a" }] } },
      "GET schedules?repoId=repo-2": { status: 200, body: { schema: "orca-schedules-v1", repoId: "repo-2", schedules: [{ id: "sch-b" }],
        corrupt: [{ id: "sch-bad", code: "recovery-blocked", message: "recovery-blocked:schedule-body-invalid" }] } },
    });
    const out = await run(["schedule", "list", "--all", "--json"], w.dir);
    expect(out.code, out.stdout + out.stderr).toBe(0);
    expect(w.requests.map((r) => `${r.method} ${r.path}`)).toEqual(["GET projects", "GET schedules?repoId=repo-1", "GET schedules?repoId=repo-2"]);
    // An older panel without `corrupt` contributes none; a corrupt row rides beside the flattened schedules.
    expect(out.json().body).toEqual({
      schema: "orca-schedules-v1", all: true, schedules: [{ id: "sch-a" }, { id: "sch-b" }],
      corrupt: [{ id: "sch-bad", code: "recovery-blocked", message: "recovery-blocked:schedule-body-invalid" }],
    });
  });

  it("list --all with no control repositories reads projects once and never falls back to resolving a project", async () => {
    const w = await world({}, {
      "GET projects": { status: 200, body: { source: "command-line", projects: [{ projectKey: "none", name: "none", path: "/repos/none", controlRepoId: null }] } },
    });
    const out = await run(["schedule", "list", "--all", "--json"], w.dir, w.dir);
    expect(out.code, out.stdout + out.stderr).toBe(0);
    expect(w.requests.map((r) => `${r.method} ${r.path}`)).toEqual(["GET projects"]);
    expect(out.json().body).toEqual({ schema: "orca-schedules-v1", all: true, schedules: [], corrupt: [] });
  });

  const FIRES: Array<[string[], string]> = [
    [[], "schedules/sch-weekly/fires"],
    [["--limit", "7"], "schedules/sch-weekly/fires?limit=7"],
  ];
  it.each(FIRES)("fires %j reads %s", async (extra, path) => {
    const body = { schema: "orca-schedule-fires-v1", scheduleId: "sch-weekly", fires: [] };
    const w = await world({}, { [`GET ${path}`]: { status: 200, body } });
    const out = await run(["schedule", "fires", "sch-weekly", ...extra, "--json"], w.dir);
    expect(out.code, out.stdout + out.stderr).toBe(0);
    expect(w.requests.filter((r) => r.method === "GET").map((r) => r.path)).toEqual([path]);
    expect(out.json().body).toEqual(body);
  });

  it("fires --limit 0 is refused here, with nothing sent", async () => {
    const w = await world();
    const out = await run(["schedule", "fires", "sch-weekly", "--limit", "0", "--json"], w.dir);
    expect([out.code, out.json().body.error?.code]).toEqual([1, "control-cli-argument-invalid"]);
    expect(w.requests).toEqual([]);
  });

  it("show reads the one schedule", async () => {
    const body = { schema: "orca-schedule-v1", id: "sch-weekly", revision: 3, nextSlots: [1, 2, 3] };
    const w = await world({}, { "GET schedules/sch-weekly": { status: 200, body } });
    const out = await run(["schedule", "show", "sch-weekly", "--json"], w.dir);
    expect(out.code, out.stdout + out.stderr).toBe(0);
    expect(w.requests.map((r) => `${r.method} ${r.path}`)).toEqual(["GET schedules/sch-weekly"]);
    expect(out.json().body).toEqual(body);
  });

  const SWITCHES: Array<[string[], string, unknown]> = [
    [["schedule", "enable", "sch-weekly"], "schedules/sch-weekly/enable", { enabled: true }],
    [["schedule", "disable", "sch-weekly"], "schedules/sch-weekly/enable", { enabled: false }],
    [["schedule", "remove", "sch-weekly"], "schedules/sch-weekly/remove", {}],
    [["schedule", "resume", "sch-weekly"], "schedules/sch-weekly/resume", {}],
  ];
  it.each(SWITCHES)("orca %j sends one POST at the schedule's revision", async (argv, path, payload) => {
    const w = await world({}, {
      "GET schedules/sch-weekly": { status: 200, body: { schema: "orca-schedule-v1", id: "sch-weekly", revision: 3 } },
      [`POST ${path}`]: accept(() => 3),
    });
    const out = await run([...argv, "--json"], w.dir);
    expect(out.code, out.stdout + out.stderr).toBe(0);
    expect(w.posts().map((p) => ({ path: p.path, expectedRevision: p.expectedRevision, payload: p.payload }))).toEqual([{ path, expectedRevision: 3, payload }]);
  });
});

describe("plan import reads the file here and sends a document, never a path (§5.3 (c), C12)", () => {
  /** A registered repository at a real path, its plan file and contracts; the fake panel lists it as the project. */
  function repoWorld() {
    const root = temp("sched-cli-repo-");
    const repo = join(root, "repo");
    mkdirSync(join(repo, "plans", "contracts"), { recursive: true });
    const contractPath = join(repo, "plans", "contracts", "a.json");
    writeFileSync(contractPath, JSON.stringify(contract("a", repo)));
    const plan = (over: Record<string, unknown> = {}, contractRef: string = contractPath) => {
      const planPath = join(repo, "plans", "plan.json");
      const text = JSON.stringify({ targetRepo: repo, ccloopBin: "/bin/true", runsDir: "/tmp/runs", workBranch: "orca/w", policy: "local-merge", ledgerMode: "out-of-repo",
        goal: "ship", successConditions: ["passes"],
        tasks: [{ taskId: "a", contract: contractRef, dependsOn: [], targetVersion: 1 },
          { taskId: "b", loop: { plan: "standard", goal: "g", successCondition: "s", targetPaths: ["src/**"], checks: ["true"] }, dependsOn: ["a"], targetVersion: 1, labels: ["feature"] }],
        ...over });
      writeFileSync(planPath, text);
      return { planPath, text };
    };
    const routes = { ...LIBRARY_READS, "GET projects": { status: 200, body: { source: "command-line", projects: [{ projectKey: "proj", name: "proj", path: repo, controlRepoId: "repo-1" }] } } };
    return { root, repo, contractPath, plan, routes };
  }

  it("inlines each contract, keeps a loop task as its recipe, and names the file only by name and sha256", async () => {
    const r = repoWorld();
    const { planPath, text } = r.plan();
    const w = await world({}, r.routes);
    const out = await run(["plan", "import", planPath, "--json"], w.dir, r.repo);
    expect(out.code, out.stdout + out.stderr).toBe(0);
    const [post] = w.posts();
    expect(post!.path).toBe("plan-library/import");
    const payload = post!.payload as { projectId: string; name: string; doc: { schema: string; tasks: Array<Record<string, unknown>> }; provenance: unknown };
    expect(payload.provenance).toEqual({ fileName: "plan.json", fileSha256: createHash("sha256").update(text).digest("hex"), format: "scheduler-plan-file" });
    expect([payload.projectId, payload.name, payload.doc.schema]).toEqual(["repo-1", "plan.json", "orca-plan-v1"]);
    expect(payload.doc.tasks[0]).toEqual({ taskId: "a", dependsOn: [], targetVersion: 1, contract: contract("a", r.repo) });
    expect(payload.doc.tasks[1]).toMatchObject({ taskId: "b", loop: { schema: "orca-loop-recipe-v1", planId: "standard", chosenBy: "explicit" }, labels: ["feature"] });
    // Never a path: neither the plan file's nor a contract's appears in what was sent.
    const sent = w.requests.find((q) => q.method === "POST")!.text;
    expect(sent.includes(r.contractPath)).toBe(false);
    expect(sent.includes(planPath)).toBe(false);
  });

  it("an orca-plan-v1 file is sent as it is", async () => {
    const r = repoWorld();
    const file = join(r.root, "weekly.orca-plan.json");
    writeFileSync(file, canonicalBytes(DOC));
    const w = await world({}, r.routes);
    const out = await run(["plan", "import", file, "--name", "weekly", "--json"], w.dir, r.repo);
    expect(out.code, out.stderr).toBe(0);
    expect(w.posts()[0]!.payload).toEqual({ projectId: "repo-1", name: "weekly", doc: DOC, provenance: { fileName: "weekly.orca-plan.json", fileSha256: createHash("sha256").update(canonicalBytes(DOC)).digest("hex"), format: "orca-plan-v1" } });
  });

  it("refuses a targetRepo other than the project's path (plan-library-target-mismatch), sending nothing", async () => {
    const r = repoWorld();
    const { planPath } = r.plan({ targetRepo: join(r.root, "elsewhere") });
    const w = await world({}, r.routes);
    const out = await run(["plan", "import", planPath, "--json"], w.dir, r.repo);
    expect([out.code, out.json().body.error?.code]).toEqual([1, "plan-library-target-mismatch"]);
    expect(w.posts()).toEqual([]);
  });

  it("refuses a contract outside the repository (plan-library-contract-path-refused), sending nothing", async () => {
    const r = repoWorld();
    const outside = join(r.root, "outside.json");
    writeFileSync(outside, JSON.stringify(contract("a", r.repo)));
    const { planPath } = r.plan({}, outside);
    const w = await world({}, r.routes);
    const out = await run(["plan", "import", planPath, "--json"], w.dir, r.repo);
    expect([out.code, out.json().body.error?.code]).toEqual([1, "plan-library-contract-path-refused"]);
    expect(out.json().body.error?.message).toContain("plan-library-contract-path-refused:a");
    expect(w.posts()).toEqual([]);
  });

  it("refuses a contract reached through a symbolic link in any component, even one inside the repository", async () => {
    const r = repoWorld();
    symlinkSync(join(r.repo, "plans", "contracts"), join(r.repo, "linked"));
    const { planPath } = r.plan({}, join(r.repo, "linked", "a.json"));
    const w = await world({}, r.routes);
    const out = await run(["plan", "import", planPath, "--json"], w.dir, r.repo);
    expect([out.code, out.json().body.error?.code]).toEqual([1, "plan-library-contract-path-refused"]);
    expect(w.posts()).toEqual([]);
  });
});

describe("plan export --out (§16, C12)", () => {
  it("writes a new 0600 file with the version's canonical bytes, and refuses an existing path, leaving it as it was", async () => {
    const dir = temp("sched-cli-out-");
    const w = await world({}, LIBRARY_READS);
    const target = join(dir, "weekly.orca-plan.json");
    const out = await run(["plan", "export", ENTRY, "--out", target, "--json"], w.dir);
    expect(out.code, out.stdout + out.stderr).toBe(0);
    expect(readFileSync(target)).toEqual(canonicalBytes(DOC));
    expect(statSync(target).mode & 0o777).toBe(0o600);
    expect(out.json().body).toMatchObject({ entryId: ENTRY, sha256: SHA, out: target });
    writeFileSync(target, "mine");
    const again = await run(["plan", "export", ENTRY, "--out", target, "--json"], w.dir);
    expect([again.code, again.json().body.error?.code, again.json().body.error?.message]).toEqual([1, "control-cli-argument-invalid", "--out exists"]);
    expect(readFileSync(target, "utf8")).toBe("mine");
    expect(readdirSync(dir)).toEqual(["weekly.orca-plan.json"]);
  });

  it("refuses a missing parent directory, and leaves no file and no temp file when the written bytes fail their check", async () => {
    const dir = temp("sched-cli-out-");
    const w = await world({}, { ...LIBRARY_READS, [`GET plan-library/${ENTRY}/versions/${SHA}`]: { status: 200, body: { ...DOC, goal: "altered" } } });
    const missing = await run(["plan", "export", ENTRY, "--out", join(dir, "no", "x.json"), "--json"], w.dir);
    expect([missing.code, missing.json().body.error?.code]).toEqual([1, "control-cli-argument-invalid"]);
    const forced = await run(["plan", "export", ENTRY, "--out", join(dir, "x.json"), "--json"], w.dir);
    expect([forced.code, forced.json().body.error?.code]).toEqual([1, "plan-library-hash-mismatch"]);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("wants --out: nothing is written anywhere without it, and nothing ever appears under HOME", async () => {
    const w = await world({}, LIBRARY_READS);
    const out = await run(["plan", "export", ENTRY, "--json"], w.dir);
    for (const argv of [["plan", "list"], ["plan", "show", ENTRY], ["plan", "save", "--group", "g-alpha"], ["plan", "archive", ENTRY]]) await run(argv, w.dir);
    expect(readdirSync(HOME)).toEqual([]);
    expect([out.code, out.json().body.error?.code]).toEqual([1, "control-cli-argument-invalid"]);
  });
});

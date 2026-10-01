import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { expandSplitDraft, validateSplitDraft } from "../../src/control/requirementSplit.js";
import { expandLoopTask } from "../../src/control/loopPlans.js";
import { buildGraph } from "../../src/scheduler/graph.js";
import type { SplitOutput } from "../../src/control/requirementSchemas.js";
import { VALID_SPLIT } from "./fixtures/requirementOutputs.js";

// N1 spec §8.2-§8.4: code expands the model's split into a plan, validates it with every check the Web import applies
// plus the requirement's own, hands it back with every reason at once, and computes the layers -- never the model.
let root = "", repo = "", commit = "";
beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "orca-split-")));
  repo = join(root, "repo"); await mkdir(join(repo, "src"), { recursive: true });
  const g = (...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: repo, encoding: "utf8" }).trim();
  g("init", "-q", "-b", "main"); await writeFile(join(repo, "README.md"), "r"); await writeFile(join(repo, "src", "a.ts"), "a"); g("add", "-A"); g("commit", "-qm", "base");
  commit = g("rev-parse", "HEAD");
});
afterAll(async () => { await rm(root, { recursive: true, force: true }); });
const criteria = [{ id: "AC1", text: "An exported note opens as CommonMark." }, { id: "AC2", text: "Images in the note are links in the file." }];
const ctx = (acceptanceCriteria = criteria) => ({ targetRepo: repo, ccloopBin: "/opt/ccloop/dist/cli.js", runsDir: "/var/orca/runs", groupId: "r", statement: "Export notes.", acceptanceCriteria });
const validate = (output: SplitOutput, criterionIds = ["AC1", "AC2"], acceptanceCriteria = criteria) =>
  validateSplitDraft({ output, plan: expandSplitDraft(output, ctx(acceptanceCriteria)), repo, commit, criterionIds, adrIds: ["R1.ADR1"] });
const task = (patch: Partial<SplitOutput["tasks"][number]>, index = 0) => ({ ...VALID_SPLIT, tasks: VALID_SPLIT.tasks.map((t, i) => (i === index ? { ...t, ...patch } : t)) });

describe("expanding a split (N1 spec §8.2)", () => {
  it("expands into a complete loop-task plan on orca/<groupId>, local-merge, the statement as goal", () => {
    expect(expandSplitDraft(VALID_SPLIT, ctx())).toEqual({
      targetRepo: repo, ccloopBin: "/opt/ccloop/dist/cli.js", runsDir: "/var/orca/runs", workBranch: "orca/r", policy: "local-merge", ledgerMode: "out-of-repo",
      goal: "Export notes.", successConditions: criteria.map((c) => c.text),
      tasks: VALID_SPLIT.tasks.map((t) => ({ taskId: t.taskId, loop: { goal: t.goal, successCondition: t.successCondition, targetPaths: t.targetPaths, checks: t.checks }, dependsOn: t.dependsOn, targetVersion: 1, labels: t.labels })),
    });
  });
});

describe("validating a split (N1 spec §8.3)", () => {
  it("passes a valid draft and computes the layers buildGraph computes", async () => {
    const out = await validate(VALID_SPLIT);
    expect(out).toMatchObject({ ok: true, reasons: [], layers: [["exporter"], ["images"]], implicitEdges: [] });
    const contracts = new Map(VALID_SPLIT.tasks.map((t) => { const e = expandLoopTask(t.taskId, repo, { goal: t.goal, successCondition: t.successCondition, targetPaths: t.targetPaths, checks: t.checks }, t.labels); if (!e.ok) throw new Error(e.reason); return [t.taskId, e.contract]; }));
    expect(out.layers).toEqual(buildGraph({ targetRepo: repo, ccloopBin: "x", runsDir: "x", workBranch: "x", policy: "local-merge", ledgerMode: "out-of-repo", tasks: VALID_SPLIT.tasks.map((t) => ({ taskId: t.taskId, contract: t.taskId, dependsOn: t.dependsOn })) }, contracts).layers);
  });

  it("names the write-set conflict behind an implicit edge", async () => {
    const out = await validate({ ...VALID_SPLIT, tasks: VALID_SPLIT.tasks.map((t) => ({ ...t, dependsOn: [], targetPaths: ["src/**"] })) });
    expect(out).toMatchObject({ ok: true, layers: [["exporter"], ["images"]], implicitEdges: [{ from: "exporter", to: "images" }] });
    // Each loop task claims its targets twice (targetPaths and allowlistPaths, writeSet.ts writeSetOf), so the conflict
    // list repeats the pair; what matters is that it names the paths behind the edge.
    expect(out.implicitEdges![0]!.conflicts).toEqual(expect.arrayContaining([{ a: "src/**", b: "src/**" }]));
  });

  it.each([
    ["a cycle (loadPlan)", { ...VALID_SPLIT, tasks: VALID_SPLIT.tasks.map((t) => ({ ...t, dependsOn: [t.taskId === "exporter" ? "images" : "exporter"] })) }, "plan:cycle"],
    ["a task id that cannot be a run id (loadPlan)", task({ taskId: "team/alpha", dependsOn: [] }), "plan:unusable-task-id"],
    ["a label outside the vocabulary (loadPlan)", task({ labels: ["not-a-label"] }), "plan:malformed"],
    ["an unknown loop plan (expandLoopTask)", task({ loopPlan: "nope" }), "expand:exporter:unknown-plan"],
    ["an investigate plan with two targets (expandLoopTask)", task({ loopPlan: "investigate" }), "expand:exporter:investigate-target"],
    ["a dangling dependency (Web import)", task({ dependsOn: ["ghost"] }), "import:dangling-dependency:exporter:ghost"],
    ["a repeated dependency (Web import)", task({ dependsOn: ["exporter", "exporter"] }, 1), "import:duplicate-dependency:images"],
    ["a target under a directory the commit lacks", task({ targetPaths: ["missing/dir/x.ts"] }), "path:exporter:missing/dir/x.ts"],
    ["a trace naming nothing", task({ traces: ["AC9"] }), "trace:exporter:AC9"],
    ["a criterion no task traces", task({ traces: ["R1.ADR1"] }), "untraced:AC1"],
  ] as const)("hands back %s by name", async (_name, output, reason) => {
    const out = await validate(output as SplitOutput);
    expect(out.ok).toBe(false);
    expect(out.reasons.some((entry) => entry.startsWith(reason))).toBe(true);
    expect(out.layers).toBeNull();
  });

  it("hands back every reason at once, not the first", async () => {
    const out = await validate({ ...VALID_SPLIT, tasks: [{ ...VALID_SPLIT.tasks[0]!, targetPaths: ["missing/x.ts"], traces: ["AC9"] }, VALID_SPLIT.tasks[1]!] });
    expect(out.reasons).toEqual(expect.arrayContaining(["path:exporter:missing/x.ts", "trace:exporter:AC9", "untraced:AC1"]));
  });

  // The Web import refuses two equal success conditions; a requirement whose criteria repeat a text is handed back by name.
  it("hands back acceptance criteria whose texts repeat (Web import)", async () => {
    const out = await validate(VALID_SPLIT, ["AC1", "AC2"], [{ id: "AC1", text: "Same." }, { id: "AC2", text: "Same." }]);
    expect(out).toMatchObject({ ok: false, reasons: ["import:duplicate-success-condition"], layers: null, implicitEdges: null });
  });

  // What only the Web import itself decides (here: a plan with no success condition) still reaches the person by name.
  it("hands back what the Web import refuses beyond the checks above, by its detail", async () => {
    const traced = { ...VALID_SPLIT, tasks: VALID_SPLIT.tasks.map((t) => ({ ...t, traces: ["R1.ADR1"] })) };
    const out = await validate(traced, [], []);
    expect(out).toMatchObject({ ok: false, reasons: ["import:control-metadata"], layers: null, implicitEdges: null });
  });
});

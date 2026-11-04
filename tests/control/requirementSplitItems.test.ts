import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { expandSplitDraft, explainSplitReason, importReasons, validateSplitDraft } from "../../src/control/requirementSplit.js";
import { ControlError } from "../../src/control/errors.js";
import { VALID_SPLIT } from "./fixtures/requirementOutputs.js";

// Spec 2026-10-08 §2.2(c): the Web import's refusal can carry several items; the split validator hands each back as
// its own `import:` reason, so the model's feedback stays one problem per line.
vi.mock("../../src/scheduler/planFile.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/scheduler/planFile.js")>();
  const { ControlError: Refusal } = await import("../../src/control/errors.js");
  return { ...actual, schedulerControlPlanSourceOf: () => { throw new Refusal("control-plan-rejected", "missing-goal\nmissing-success-conditions"); } };
});

let root = "", repo = "", commit = "";
beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "orca-split-items-")));
  repo = join(root, "repo"); await mkdir(join(repo, "src"), { recursive: true });
  const g = (...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: repo, encoding: "utf8" }).trim();
  g("init", "-q", "-b", "main"); await writeFile(join(repo, "README.md"), "r"); await writeFile(join(repo, "src", "a.ts"), "a"); g("add", "-A"); g("commit", "-qm", "base");
  commit = g("rev-parse", "HEAD");
});
afterAll(async () => { await rm(root, { recursive: true, force: true }); });

describe("the split validator and a Web import refusal with several items (spec 2026-10-08 §2.2(c))", () => {
  it("hands back one import reason per item", async () => {
    const criteria = [{ id: "AC1", text: "An exported note opens as CommonMark." }, { id: "AC2", text: "Images in the note are links in the file." }];
    const plan = expandSplitDraft(VALID_SPLIT, { targetRepo: repo, ccloopBin: "/opt/ccloop/dist/cli.js", runsDir: "/var/orca/runs", groupId: "r", statement: "Export notes.", acceptanceCriteria: criteria });
    const out = await validateSplitDraft({ output: VALID_SPLIT, plan, repo, commit, criterionIds: ["AC1", "AC2"], adrIds: ["R1.ADR1"] });
    expect(out).toMatchObject({ ok: false, reasons: ["import:missing-goal", "import:missing-success-conditions"], layers: null, implicitEdges: null });
  });

  it("hands back a refusal with no detail by its code", () => {
    expect(importReasons(new ControlError("group-not-found"))).toEqual(["import:group-not-found"]);
  });
});

// Task setup spec §4.3: an npm setup or check command naming a script the commit's package.json does not have is handed
// back as a `command:` reason, with its meaning for the redraft, before a paid run fails on it.
describe("the split validator and npm commands that do not exist (task setup spec §4.3)", () => {
  let npmRepo = "", npmCommit = "";
  beforeAll(async () => {
    npmRepo = join(root, "npm-repo"); await mkdir(join(npmRepo, "web", "src"), { recursive: true }); await mkdir(join(npmRepo, "src"));
    const g = (...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: npmRepo, encoding: "utf8" }).trim();
    g("init", "-q", "-b", "main");
    await writeFile(join(npmRepo, "package.json"), JSON.stringify({ name: "root", workspaces: ["web"], scripts: { build: "tsc" } }));
    await writeFile(join(npmRepo, "web", "package.json"), JSON.stringify({ name: "@x/web", scripts: { build: "vite build" } }));
    await writeFile(join(npmRepo, "src", "a.ts"), "a"); g("add", "-A"); g("commit", "-qm", "base");
    npmCommit = g("rev-parse", "HEAD");
  });
  const criteria = [{ id: "AC1", text: "An exported note opens as CommonMark." }, { id: "AC2", text: "Images in the note are links in the file." }];
  const validate = (output: typeof VALID_SPLIT & { tasks: Array<{ setup?: string[] }> }) => validateSplitDraft({ output, repo: npmRepo, commit: npmCommit, criterionIds: ["AC1", "AC2"], adrIds: [],
    plan: expandSplitDraft(output, { targetRepo: npmRepo, ccloopBin: "/opt/ccloop/dist/cli.js", runsDir: "/var/orca/runs", groupId: "r", statement: "Export notes.", acceptanceCriteria: criteria }) });

  // mutation: drop the command check in validateSplitDraft -> no `command:` reason -> red
  it("hands back a check whose workspace has no such script, with what it means", async () => {
    const output = { ...VALID_SPLIT, tasks: [{ ...VALID_SPLIT.tasks[0]!, checks: ["npm test --workspace web"] }, VALID_SPLIT.tasks[1]!] };
    const out = await validate(output);
    const expected = 'command:npm test --workspace web: workspace web (web/package.json) has no script "test"';
    expect(out).toMatchObject({ ok: false, reasons: [expected], layers: null, implicitEdges: null });
    expect(explainSplitReason(expected)).toBe("an npm setup or check command names a script or workspace that does not exist in the overview's commit: name a script that is already in that package's `scripts` (as `manifests` lists them) and a workspace the root package.json lists, or a command that is not npm");
  });

  it("checks every setup command too, and each distinct command once", async () => {
    const setup = ["npm ci", "npm run gen -w @x/web"];
    const output = { ...VALID_SPLIT, tasks: [{ ...VALID_SPLIT.tasks[0]!, setup }, { ...VALID_SPLIT.tasks[1]!, setup }] };
    const out = await validate(output);
    expect(out.reasons).toEqual(['command:npm run gen -w @x/web: workspace @x/web (web/package.json) has no script "gen"']);
  });
});

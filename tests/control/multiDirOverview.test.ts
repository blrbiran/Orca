/**
 * Multi-directory projects spec §6.3-§6.4, criterion M5: a clarifying group on a multi-dir project builds one overview per
 * member, in registered order (a `repo` member from its HEAD, a `dir` member from its import commit), composes them into
 * `orca-project-overview-v1` and keeps `commits` per member key on the call's run. The clarify and split prompts of a
 * multi group use the multi instructions and the `project-overview` fence; a single-repository group's bytes are the
 * ones the code wrote before this work (pinned here, and by the C7 golden).
 *
 * Rule 17: HOME, ORCA_VAULT_DIR, ORCA_CONTROL_DIR and ORCA_PROJECTS_FILE are under the harness's temporary root.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sha256Canonical } from "../../src/control/canonicalJson.js";
import { buildRepositoryOverview, dividedOverviewLimits, OVERVIEW_LIMITS, type ProjectOverview } from "../../src/control/requirementOverview.js";
import { buildClarifyPrompt, CLARIFY_INSTRUCTION_V3 } from "../../src/control/requirementClarify.js";
import { buildSplitPrompt, SPLIT_INSTRUCTION_MULTI_V2, SPLIT_JSON_SCHEMA, SPLIT_JSON_SCHEMA_MULTI } from "../../src/control/requirementSplit.js";
import { multiSplitOutputSchema } from "../../src/control/requirementSchemas.js";
import { readRequirementGroup } from "../../src/control/requirementRecords.js";
import { vaultKeyOf } from "../../src/flow/vault/paths.js";
import { controlRepoKey } from "../../src/panel/controlOptions.js";
import { writeTree } from "./fixtures/dirRequirement.js";
import { multiHarness } from "./fixtures/multiRequirement.js";
import { requirementHarness } from "./fixtures/requirementHarness.js";
import { ROUND_ONE } from "./fixtures/requirementOutputs.js";

const sha = (text: string): string => createHash("sha256").update(text).digest("hex");
/** The bytes of the single-repository prompts and schemas at commit 2d707b29, before this task. */
const PINNED = {
  clarifyInstructionV3: "09e9b2484492755ed729ffb7a35c9f763eacc3fa891e642e0ccd4f14e2465c0e",
  clarifyPrompt: "082285a1b2a23f21335bf704699b5e5decbf20fdcb24b29d9d1551513e93e4fc",
  // Split instruction version 2 (the requirement document and Orca's files are in the repository): the pin moves with it.
  // Ruling: human approved rewriting all necessary criteria, Orca session 7753e97d, 2026-10-27
  splitPrompt: "cfe027bc99a0fa77a999619d5379cc1208f9a671831d307607f9461f7582a263",
  splitSchema: "0e8a8113c3a739af427bd6b730ef7995c2bcdcf41ea808d2ba526b1e66ecf728",
} as const;
const FIXED_OVERVIEW = { canonicalJson: "{}", hash: "a".repeat(64) };

const PROMPT_OF = (envelope: { work: { kind: string; prompt?: string } }): string => envelope.work.prompt!;
const FENCE_OF = (prompt: string, name: string): unknown => {
  const match = new RegExp(`<<<ORCA-DATA ${name} ([0-9a-f]{16})\\n([\\s\\S]*?)\\nORCA-DATA ${name} \\1>>>`).exec(prompt);
  expect(match, `the ${name} fence is in the prompt`).not.toBeNull();
  return JSON.parse(match![2]!);
};

describe("the overview across directories (M5, §6.3)", () => {
  it("builds one entry per member in registered order, each from its own commit, and keeps commits per key", async () => {
    const x = await multiHarness({ answers: [{ purpose: "clarify", output: ROUND_ONE }] });
    try {
      expect(await x.open()).toMatchObject({ result: { kind: "requirement-opened", groupId: "r" } });
      await x.until(() => x.round(1).state !== "drafting");
      expect(x.round(1).state).toBe("awaiting-answers");
      const run = x.runs()[0]!;
      const overview = run.overview as { hash: string; commits: Record<string, string> };
      expect(Object.keys(overview.commits)).toEqual(["posts", "alpha"]);
      expect(overview.commits.alpha).toBe(x.alphaHead);
      expect(overview.commits.posts).toBe(x.importCommit());
      const composed = FENCE_OF(x.promptOf(0), "project-overview") as ProjectOverview;
      expect(overview.hash).toBe(sha256Canonical(composed));
      expect(composed.schema).toBe("orca-project-overview-v1");
      expect(composed.dirs.map((dir) => [dir.key, dir.name, dir.kind, dir.primary, dir.overview.commit])).toEqual([
        ["posts", "Posts notes", "dir", true, x.importCommit()],
        ["alpha", "Alpha service", "repo", false, x.alphaHead],
      ]);
      // Each member's tree, read from its own target: the folder's committed files and the repository's.
      expect(composed.dirs[0]!.overview.files.listed).toEqual(["README.md", "notes/p1.md"]);
      expect(composed.dirs[1]!.overview.files.listed).toEqual(["README.md", "src/a.ts"]);
      expect(composed.dirs[0]!.overview.docs.entries[0]!.text).toContain("the posts folder.");
      expect(composed.dirs[1]!.overview.docs.entries[0]!.text).toContain("The alpha service.");
      // Each cached under its own dir target id and commit, in the entry of the divided limits it was built with:
      // the default-limits path is never written by a multi run (review fix: the caps key the cache).
      const root = `${x.store.stateDir}.overview`;
      const limitsDir = `limits-${sha256Canonical({ ...OVERVIEW_LIMITS, ...dividedOverviewLimits(2) }).slice(0, 16)}`;
      const postsRepoId = `flow-vault-${vaultKeyOf(realpathSync(x.posts).normalize("NFC"))}`;
      expect(existsSync(join(root, postsRepoId, x.importCommit(), limitsDir, "overview.json"))).toBe(true);
      expect(existsSync(join(root, controlRepoKey("alpha"), x.alphaHead, limitsDir, "overview.json"))).toBe(true);
      expect(existsSync(join(root, postsRepoId, x.importCommit(), "overview.json"))).toBe(false);
      expect(existsSync(join(root, controlRepoKey("alpha"), x.alphaHead, "overview.json"))).toBe(false);
      // The composed prompt: the multi instruction and the fenced project overview, both members inside.
      const prompt = x.promptOf(0);
      expect(prompt.startsWith("Orca requirement clarification, instruction version 3.")).toBe(true);
      expect(prompt).toContain("for a project made of several directories (repositories or folders), listed in order; the first is the primary");
      expect(prompt).toContain("<<<ORCA-DATA project-overview ");
      expect(prompt).not.toContain("<<<ORCA-DATA repository-overview ");
      expect(prompt).toContain("the posts folder.");
      expect(prompt).toContain("The alpha service.");
      expect(readRequirementGroup(x.store, "r").requirement.repoId).toBe("repo");
    } finally { await x.dispose(); }
  });

  it("builds every member under the limits divided by the member count, so the composed prompt stays one repository's size", async () => {
    const x = await multiHarness({ answers: [{ purpose: "clarify", output: ROUND_ONE }], alphaFileCount: 2_001 });
    try {
      expect(await x.open()).toMatchObject({ result: { kind: "requirement-opened", groupId: "r" } });
      await x.until(() => x.round(1).state !== "drafting");
      expect(x.round(1).state).toBe("awaiting-answers");
      const composed = FENCE_OF(x.promptOf(0), "project-overview") as ProjectOverview;
      // Two members divide 4,000 paths into 2,000 each: alpha's 2,002 paths are cut, the handful member's are whole.
      const alphaFiles = composed.dirs[1]!.overview.files;
      expect(alphaFiles.listed).toHaveLength(2_000);
      expect(alphaFiles.listed[0]).toBe("README.md");
      expect(alphaFiles).toMatchObject({ total: 2_002, cut: true });
      expect(alphaFiles.directories).toEqual([{ directory: ".", files: 1 }, { directory: "big", files: 2_001 }]);
      expect(composed.dirs[0]!.overview.files).toMatchObject({ listed: ["README.md", "notes/p1.md"], cut: false, directories: null });
      expect(x.runs()[0]!.overview).toMatchObject({ commits: { posts: x.importCommit(), alpha: x.alphaHead } });
    } finally { await x.dispose(); }
  });

  it("divides the count limits by the member count, floor and at least 1; byte limits are unchanged", () => {
    expect(dividedOverviewLimits(1)).toEqual({ maxPaths: OVERVIEW_LIMITS.maxPaths });
    expect(dividedOverviewLimits(2)).toEqual({ maxPaths: Math.floor(OVERVIEW_LIMITS.maxPaths / 2) });
    expect(dividedOverviewLimits(3)).toEqual({ maxPaths: 1_333 });
    expect(dividedOverviewLimits(8)).toEqual({ maxPaths: 500 });
    expect(dividedOverviewLimits(OVERVIEW_LIMITS.maxPaths + 1)).toEqual({ maxPaths: 1 });
    expect(dividedOverviewLimits(4)).not.toHaveProperty("maxListBytes");
    expect(dividedOverviewLimits(4)).not.toHaveProperty("maxDocBytes");
  });
});

/**
 * Review fix: the cache entry is keyed by the effective limits. One repository reached by one group's default build and
 * another group's divided build shares the same control repo key, so a warm single-repo entry must never answer a
 * divided build (its `files` would not be cut) nor the other way round (its `files` would stay truncated).
 */
describe("the overview cache is keyed by the effective limits", () => {
  it("keeps a divided build and a default build on one repository apart, in either order", async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "orca-overview-limits-")));
    try {
      const repo = join(root, "repo");
      writeTree(repo, { "README.md": "# Notes\n", "notes/p1.md": "first post\n", "src/a.ts": "export const a = 1;\n" });
      const git = (...args: string[]): string => execFileSync("git",
        ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.hooksPath=/dev/null", ...args], { cwd: repo, encoding: "utf8" }).trim();
      git("init", "-q", "-b", "main"); git("add", "-A"); git("commit", "-qm", "base");
      const stateDir = join(root, "control", "repo");
      const build = (limits?: { maxPaths: number }) => buildRepositoryOverview({ repo, repoId: "repo", stateDir, runId: "run-1", astGrepBin: null,
        ...(limits === undefined ? {} : { limits }) });
      const whole = { listed: ["README.md", "notes/p1.md", "src/a.ts"], total: 3, cut: false };
      const cut = { listed: ["README.md"], total: 3, cut: true };
      const first = await build();
      expect(first.overview.files).toMatchObject(whole);
      expect((await build({ maxPaths: 1 })).overview.files).toMatchObject(cut);
      expect((await build()).overview.files).toMatchObject(whole);
      expect((await build({ maxPaths: 1 })).overview.files).toMatchObject(cut);
      // The default limits keep today's path; the divided ones live under their digest beside it.
      const commitDir = join(`${stateDir}.overview`, "repo", first.overview.commit);
      expect(existsSync(join(commitDir, "overview.json"))).toBe(true);
      expect(existsSync(join(commitDir, `limits-${sha256Canonical({ ...OVERVIEW_LIMITS, maxPaths: 1 }).slice(0, 16)}`, "overview.json"))).toBe(true);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});

describe("the split prompt across directories (M5, §6.4)", () => {
  it("uses the multi instruction, the writes schema and the project-overview fence", async () => {
    const x = await multiHarness({ answers: [{ purpose: "split", output: null, outcome: "failed" }], startAt: "split" });
    try {
      await x.until(() => x.fake.calls.accept.length > 0);
      const envelope = x.fake.calls.accept[0]! as { work: { kind: string; prompt: string; responseSchema: unknown } };
      expect(envelope.work.responseSchema).toEqual(SPLIT_JSON_SCHEMA_MULTI);
      const prompt = envelope.work.prompt;
      // Ruling: human approved rewriting all necessary criteria, Orca session 7753e97d, 2026-10-27 (version 1 -> 2)
      expect(prompt.startsWith("Orca requirement split (several directories), instruction version 2.")).toBe(true);
      expect(prompt).toContain(SPLIT_INSTRUCTION_MULTI_V2.split("\n", 1)[0]!);
      expect(prompt).toContain("`writes[].targetPaths` are paths relative to that directory's root");
      expect(prompt).toContain("`writes[].checks` are shell commands, run in that directory");
      expect(prompt).toContain("`dir` is a directory's `key`");
      expect(prompt).toContain("the first entry is the task's primary directory and its `checks` must not be empty");
      expect(prompt).toContain("Name only the directories the task changes");
      expect(prompt).toContain("<<<ORCA-DATA project-overview ");
      expect(prompt).not.toContain("<<<ORCA-DATA repository-overview ");
      const composed = FENCE_OF(prompt, "project-overview") as ProjectOverview;
      expect(composed.dirs.map((dir) => [dir.key, dir.kind, dir.primary])).toEqual([["posts", "dir", true], ["alpha", "repo", false]]);
      // The response schema's tasks carry writes (dir, targetPaths, checks) instead of targetPaths/checks.
      const tasks = ((SPLIT_JSON_SCHEMA_MULTI as { properties: { tasks: { items: { properties: Record<string, unknown>; required: string[] } } } }).properties.tasks.items);
      expect(tasks.required).toContain("writes");
      expect(tasks.properties).not.toHaveProperty("targetPaths");
      expect(tasks.properties).not.toHaveProperty("checks");
      const writes = (tasks.properties.writes as { items: { required: string[]; properties: Record<string, unknown> } }).items;
      expect(writes.required).toEqual(["dir", "targetPaths", "checks"]);
      // The zod variant for the wire output: writes entries, checks may be empty for a non-primary directory.
      expect(multiSplitOutputSchema.safeParse({ notes: "", tasks: [{ taskId: "t1", title: "T", labels: [], goal: "G", successCondition: "S",
        writes: [{ dir: "alpha", targetPaths: ["src/a.ts"], checks: [] }], dependsOn: [], traces: ["AC1"] }] }).success).toBe(true);
      expect(multiSplitOutputSchema.safeParse({ notes: "", tasks: [{ taskId: "t1", title: "T", labels: [], goal: "G", successCondition: "S",
        targetPaths: ["src/a.ts"], checks: ["true"], dependsOn: [], traces: ["AC1"] }] }).success).toBe(false);
    } finally { await x.dispose(); }
  });
});

describe("a member that cannot be read", () => {
  it("names members by their keys when the multi project is no longer registered", async () => {
    const x = await multiHarness({ answers: [{ purpose: "clarify", output: ROUND_ONE }] });
    try {
      expect(await x.open()).toMatchObject({ result: { kind: "requirement-opened", groupId: "r" } });
      x.deps.multiDirProjectOf = () => null;
      await x.until(() => x.round(1).state !== "drafting");
      expect(x.round(1).state).toBe("awaiting-answers");
      const composed = FENCE_OF(x.promptOf(0), "project-overview") as ProjectOverview;
      expect(composed.dirs.map((dir) => dir.name)).toEqual(["posts", "alpha"]);
    } finally { await x.dispose(); }
  });

  it("blocks the run with repository-path when a repository member's folder is gone", async () => {
    const x = await multiHarness({ answers: [{ purpose: "clarify", output: ROUND_ONE }] });
    try {
      expect(await x.open()).toMatchObject({ result: { kind: "requirement-opened", groupId: "r" } });
      rmSync(x.alpha, { recursive: true, force: true });
      await x.until(() => x.runs().some((run) => run.state === "blocked"));
      expect(x.runs()[0]!.drive).toMatchObject({ blockedAt: "A2", blockedReason: "repository-path" });
    } finally { await x.dispose(); }
  });
});

describe("a single-repository group's prompts are byte-equal to today's (M5, §6.4)", () => {
  it("pins the instruction, both builders' bytes and the split schema", () => {
    expect(sha(CLARIFY_INSTRUCTION_V3)).toBe(PINNED.clarifyInstructionV3);
    expect(sha(buildClarifyPrompt({
      idea: "A fixed idea.", contentLanguage: "en", overview: FIXED_OVERVIEW, earlier: [], retryReason: null,
      limits: { roundNo: 1, classification: null, roundCap: 3 },
    }))).toBe(PINNED.clarifyPrompt);
    expect(sha(buildSplitPrompt({ document: "A fixed requirement document.", overview: FIXED_OVERVIEW, earlierDrafts: [] }))).toBe(PINNED.splitPrompt);
    expect(sha256Canonical(SPLIT_JSON_SCHEMA)).toBe(PINNED.splitSchema);
  });

  it("sends the single-repository clarify and split prompts, unframed", async () => {
    const clarify = await requirementHarness({ answers: [{ purpose: "clarify", output: ROUND_ONE }] });
    try {
      await clarify.until(() => clarify.round(1).state !== "drafting");
      const prompt = PROMPT_OF(clarify.fake.calls.accept[0]!);
      expect(prompt.startsWith("Orca requirement clarification, instruction version 3.")).toBe(true);
      expect(prompt).toContain("for one software repository");
      expect(prompt).toContain("<<<ORCA-DATA repository-overview ");
      expect(prompt).not.toContain("project-overview");
      expect(prompt).not.toContain("several directories");
      // The run names exactly one commit: `{hash, commit}`, never a per-member `commits`.
      const clarifyRun = clarify.runs()[0]!;
      expect(Object.keys(clarifyRun.overview as object).sort()).toEqual(["commit", "hash"]);
      expect(clarifyRun.overview).toMatchObject({ commit: clarify.head() });
    } finally { await clarify.dispose(); }
    const split = await requirementHarness({ answers: [{ purpose: "split", output: null, outcome: "failed" }], startAt: "split" });
    try {
      await split.until(() => split.fake.calls.accept.length > 0);
      const envelope = split.fake.calls.accept[0]! as { work: { kind: string; prompt: string; responseSchema: unknown } };
      expect(envelope.work.responseSchema).toEqual(SPLIT_JSON_SCHEMA);
      // Ruling: human approved rewriting all necessary criteria, Orca session 7753e97d, 2026-10-27 (version 1 -> 2)
      expect(envelope.work.prompt.startsWith("Orca requirement split, instruction version 2.")).toBe(true);
      expect(envelope.work.prompt).toContain("for one software repository");
      expect(envelope.work.prompt).toContain("<<<ORCA-DATA repository-overview ");
      expect(envelope.work.prompt).not.toContain("project-overview");
      expect(envelope.work.prompt).not.toContain("several directories");
      expect(envelope.work.prompt).not.toContain("\"writes\"");
      expect(Object.keys(split.runs()[0]!.overview as object).sort()).toEqual(["commit", "hash"]);
    } finally { await split.dispose(); }
  });
});

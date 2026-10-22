import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalBytes, sha256Canonical } from "../../src/control/canonicalJson.js";
import { collectDebugInput, DEBUG_DIFF_INLINE_MAX_BYTES, DEBUG_INPUT_SCHEMA, REPO_CORRECTION_WINDOW, type DebugInputV1 } from "../../src/control/debugInput.js";
import { debugGoalText } from "../../src/control/debugPlan.js";
import { createExecutionDriver } from "../../src/control/executionDriver.js";
import { writeCanonicalRecord } from "../../src/control/snapshot.js";
import { unsetInheritedGitEnv } from "../../src/control/workspace.js";
import { deriveCorrectionId, deriveFixRunId } from "../../src/corrections/fields.js";
import type { Correction } from "../../src/corrections/schema.js";
import { readCorrections } from "../../src/corrections/store.js";
import type { DecisionEvent } from "../../src/ledger/schema.js";
import { controlRepoKey } from "../../src/panel/controlOptions.js";
import { reviewsFile } from "../../src/panel/paths.js";
import { createPanelServer, parsePanelArgs } from "../../src/panel/server.js";
import { makeTargetRepo } from "../corrections/harness.js";
import { sessionFor } from "../panel/fixtures/auth.js";
import { driverHarness, git as hgit } from "./fixtures/driverHarness.js";
import { FIXTURE_AGENT, webFixture } from "./fixtures/web.js";

// Flow engine spec §13.2–§13.4 (W-COR, criterion C20): a correction naming only a repository (one sentence) or only a
// run. Code builds the debug group's frozen input (Rule 5): the sentence, and for a repository the landed groups of that
// project in a bounded window -- the smaller of the last REPO_CORRECTION_WINDOW.groups landed groups and the last
// REPO_CORRECTION_WINDOW.days days before the correction -- each with its title, reported decisions and landed range,
// plus the diff capped at today's inline limit with the cut recorded. A run target freezes that run's evidence and its
// reported decisions without a decision row. Closing either writes one `decision` row and no `overturned`.

const g = (cwd: string, args: string[], options: { input?: string; env?: NodeJS.ProcessEnv } = {}): string =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.hooksPath=/dev/null", ...args],
    { cwd, encoding: "utf8", stdio: "pipe", input: options.input, env: { ...process.env, ...unsetInheritedGitEnv(), ...options.env } }).trim();

/** A commit on `ref` (child of `from`) with `files` written and committer time `at`, by plumbing; HEAD is untouched. */
function commitAt(repo: string, ref: string, from: string, files: Record<string, string>, at: string): string {
  const parent = g(repo, ["rev-parse", from]);
  const env = { GIT_INDEX_FILE: join(repo, ".git", `orca-test-index-${process.pid}`), GIT_COMMITTER_DATE: at, GIT_AUTHOR_DATE: at };
  g(repo, ["read-tree", parent], { env });
  for (const [path, text] of Object.entries(files)) {
    const blob = g(repo, ["hash-object", "-w", "--stdin"], { input: text });
    g(repo, ["update-index", "--add", "--cacheinfo", `100644,${blob},${path}`], { env });
  }
  const commit = g(repo, ["commit-tree", g(repo, ["write-tree"], { env }), "-p", parent, "-m", `at ${at}`], { env });
  g(repo, ["update-ref", ref, commit]);
  return commit;
}

const decision = (id: string, question: string, chose: string): DecisionEvent => ({
  ev: "decision", id, at: "2026-10-01T00:00:00.000Z", run: id.split("/")[0]!, question, chose,
  alternatives: [{ option: "other", why_not: "w" }], because: "b", undo: { how: "git revert x", cost: "c", blast_radius: "r" }, scope: "repo", kind: "interface",
});
const CORRECTED_AT = "2026-10-22T00:00:00.000Z";
const DAY = 86_400_000;
const daysBefore = (days: number): string => new Date(Date.parse(CORRECTED_AT) - days * DAY).toISOString();
const coarse = (over: Partial<Correction> = {}): Correction => ({
  id: "c_0", projectKey: "example.invalid/o/r", kind: "wrong", because: "the export page lost its totals",
  at: CORRECTED_AT, by: "amy", ...over,
} as Correction);

/**
 * The webFixture store (repo id "repo", group `g`), with `landed` groups `g0..` each holding one landed run whose
 * landing commit is `daysAgo[i]` days before the correction and whose ledger reports one decision. `other` is a group
 * of another repository that landed yesterday and must never appear.
 */
async function world(daysAgo: number[], options: { bigDiff?: boolean } = {}) {
  const h = await webFixture();
  const repo = join(h.root, "repo");
  g(repo, ["init", "-q", "-b", "main"]);
  await writeFile(join(repo, "base.txt"), "base\n");
  g(repo, ["add", "base.txt"]); g(repo, ["commit", "-qm", "base"]);
  const template = JSON.parse(String(h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body)) as Record<string, any>;
  const groups: Array<{ id: string; base: string; landed: string; runId: string }> = [];
  const insert = (groupId: string, repoId: string, goal: string, runId: string, base: string, landed: string) => {
    h.store.db.prepare("INSERT INTO groups(id,revision,graph_version,projection_seq,body) VALUES (?,0,1,0,?)").run(groupId, JSON.stringify({
      ...template, groupId, projectKey: repoId, goal, plan: { ...template.plan, repoId, goal } }));
    h.store.db.prepare("INSERT INTO runs(id,group_id,work_item_id,generation,active,body) VALUES (?,?,?,?,0,?)").run(runId, groupId, "a", 1, JSON.stringify({
      runId, groupId, workItemId: "a", taskId: "a", generation: 1, graphVersion: 1, targetVersion: 1, state: "settled", agent: FIXTURE_AGENT, configHash: "h",
      drive: { base, attemptSha: landed, landedCommit: landed } }));
  };
  let tip = "main";
  daysAgo.forEach((days, i) => {
    const runId = `run-${i}`;
    const base = g(repo, ["rev-parse", tip]);
    const body = options.bigDiff ? `${"x".repeat(DEBUG_DIFF_INLINE_MAX_BYTES / 4)}\n` : `change ${i}\n`;
    const landed = commitAt(repo, `refs/heads/l${i}`, tip, { [`f${i}.txt`]: body, [`.decisions/${runId}.jsonl`]: `${JSON.stringify(decision(`${runId}/agent-0`, `question ${i}`, `chose ${i}`))}\n` }, daysBefore(days));
    tip = `refs/heads/l${i}`;
    insert(`g${i}`, "repo", `requirement ${i}`, runId, base, landed);
    groups.push({ id: `g${i}`, base, landed, runId });
  });
  const otherLanded = commitAt(repo, "refs/heads/other", "main", { "other.txt": "o\n" }, daysBefore(1));
  insert("other", "repo-2", "another repository", "run-other", g(repo, ["rev-parse", "main"]), otherLanded);
  // A group still in flight has no landed commit and is not a landed group.
  h.store.db.prepare("INSERT INTO runs(id,group_id,work_item_id,generation,active,body) VALUES (?,?,?,?,1,?)").run("run-open", "g", "a", 1, JSON.stringify({
    runId: "run-open", groupId: "g", workItemId: "a", taskId: "a", generation: 1, graphVersion: 1, targetVersion: 1, state: "accepted", agent: FIXTURE_AGENT, configHash: "h",
    drive: { base: g(repo, ["rev-parse", "main"]), attemptSha: null, landedCommit: null } }));
  return { ...h, repo, groups, deps: { store: h.store, repoPath: repo, repoId: "repo" } };
}

describe("repository + one sentence: the frozen debug input (spec §13.2)", () => {
  it("keeps at most the last REPO_CORRECTION_WINDOW.groups landed groups, newest first", async () => {
    expect(REPO_CORRECTION_WINDOW).toEqual({ groups: 10, days: 14 });
    const w = await world([12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]); try {
      const input = await collectDebugInput(w.deps, coarse());
      expect(input.schema).toBe(DEBUG_INPUT_SCHEMA);
      expect(input.correction.because).toBe("the export page lost its totals");
      expect(input.decision).toBeNull();
      expect(input.pending).toBeNull();
      expect(input.originalRun).toBeNull();
      expect(input.missing).toEqual([]);
      const window = input.window!;
      expect({ asOf: window.asOf, maxGroups: window.maxGroups, maxDays: window.maxDays }).toEqual({ asOf: CORRECTED_AT, maxGroups: 10, maxDays: 14 });
      // Twelve landed within 14 days; the count bound keeps the newest ten (g11 .. g2); `other` is another repository's.
      expect(window.groups.map((group) => group.groupId)).toEqual(["g11", "g10", "g9", "g8", "g7", "g6", "g5", "g4", "g3", "g2"]);
      const newest = window.groups[0]!;
      const g11 = w.groups[11]!;
      expect(newest).toEqual({
        groupId: "g11", title: "requirement 11", landedAt: daysBefore(1),
        ranges: [{ runId: "run-11", base: g11.base, landedCommit: g11.landed }],
        decisions: [{ id: "run-11/agent-0", question: "question 11", chose: "chose 11" }],
      });
      expect(window.diff.text).toContain("f11.txt");
      expect(window.diff.text).not.toContain("f1.txt");
      expect(window.diff.text).not.toContain(".decisions/");
      expect(window.diff.keptBytes).toBe(window.diff.totalBytes);
      // The frozen record is plain JSON.
      expect(JSON.parse(JSON.stringify(input))).toEqual(input);
    } finally { await w.dispose(); }
  });

  it("keeps only groups landed in the last REPO_CORRECTION_WINDOW.days days before the correction", async () => {
    const w = await world([30, 20, 15, 13, 2, -1]); try {
      const window = (await collectDebugInput(w.deps, coarse())).window!;
      // 30, 20 and 15 days ago are outside; one landing after the correction is not what the person was looking at.
      expect(window.groups.map((group) => group.groupId)).toEqual(["g4", "g3"]);
    } finally { await w.dispose(); }
  });

  it("caps the diff at the inline limit and records the cut", async () => {
    const w = await world([5, 4, 3, 2, 1], { bigDiff: true }); try {
      const { diff } = (await collectDebugInput(w.deps, coarse())).window!;
      expect(diff.totalBytes).toBeGreaterThan(DEBUG_DIFF_INLINE_MAX_BYTES);
      expect(diff.keptBytes).toBeLessThanOrEqual(DEBUG_DIFF_INLINE_MAX_BYTES);
      expect(Buffer.byteLength(diff.text, "utf8")).toBe(diff.keptBytes);
    } finally { await w.dispose(); }
  });

  it("puts the sentence, the window and the locate-first instruction into the goal", async () => {
    const w = await world([3, 2, 1]); try {
      const text = debugGoalText(await collectDebugInput(w.deps, coarse()));
      expect(text).toContain("The human's reason: the export page lost its totals");
      expect(text).toContain("requirement 2");
      expect(text).toContain("question 2 -> chose 2");
      expect(text).toContain(`${w.groups[2]!.base}..${w.groups[2]!.landed}`);
      expect(text).toContain("debug.located");
      expect(text).not.toContain("The corrected decision");
    } finally { await w.dispose(); }
  });
});

describe("bare run: the frozen debug input (spec §13.3)", () => {
  it("freezes the run's evidence and its reported decisions, with no decision row and no window", async () => {
    const w = await world([2, 1]); try {
      const input = await collectDebugInput(w.deps, coarse({ runId: "run-1" }));
      expect(input.decision).toBeNull();
      expect(input.pending).toBeNull();
      expect(input.window).toBeUndefined();
      expect(input.originalRun).toMatchObject({ runId: "run-1", groupId: "g1" });
      expect(input.commits).toMatchObject({ base: w.groups[1]!.base, attemptSha: w.groups[1]!.landed });
      expect(input.runDecisions).toEqual([{ id: "run-1/agent-0", question: "question 1", chose: "chose 1" }]);
      const text = debugGoalText(input);
      expect(text).toContain("run-1/agent-0");
      expect(text).toContain("The corrected run: run-1");
    } finally { await w.dispose(); }
  });

  it("a decision-target input is unchanged in shape: no window and no run decisions keys", async () => {
    const w = await world([1]); try {
      // The decision is read from the working tree's ledger (the landed branch is not one of its sources).
      await mkdir(join(w.repo, ".decisions"));
      await writeFile(join(w.repo, ".decisions", "run-0.jsonl"), `${JSON.stringify(decision("run-0/agent-0", "question 0", "chose 0"))}\n`);
      const input = await collectDebugInput(w.deps, coarse({ decisionId: "run-0/agent-0" }));
      expect(Object.keys(input)).toEqual(["schema", "correction", "decision", "decisionWhere", "pending", "originalRun", "commits", "contract", "missing"]);
    } finally { await w.dispose(); }
  });
});

describe("closing a coarse correction when its debug run lands (spec §13.4)", () => {
  const lines = (repo: string, commit: string, path: string): Record<string, any>[] =>
    hgit(repo, "show", `${commit}:${path}`).split("\n").filter((l) => l.trim().length > 0).map((l) => JSON.parse(l));

  for (const [label, row] of [["repository-only", {}], ["bare-run", { runId: "orig-run" }]] as const) {
    it(`a ${label} correction writes one decision row, no overturned, citing the located decision`, async () => {
      const base = coarse({ projectKey: "github.com/o/r", ...row });
      const { id: _id, ...fields } = base;
      const correction: Correction = { ...base, id: deriveCorrectionId(fields) };
      const fixRunId = deriveFixRunId(fields, correction.id);
      const located = { decisionId: "orig-run/agent-0", paths: ["src/export.ts"], because: "the totals row is dropped there" };
      const t = await driverHarness([{ taskId: "a" }], { debug: () => ({ choseInstead: "keep the totals row", located }) }); try {
        const input: DebugInputV1 = { schema: DEBUG_INPUT_SCHEMA, correction, decision: null, decisionWhere: null, pending: null, originalRun: null, commits: null, contract: null, missing: [] };
        const hash = sha256Canonical(input);
        writeCanonicalRecord(t.h.store, "g", hash, canonicalBytes(input).toString("utf8"));
        const mark = { correctionId: correction.id, ordinal: 1, inputHash: hash, missing: [], agentFallback: null, undoHow: null, closing: null, checks: { from: "named", namedBy: "human" } };
        const body = JSON.parse(String(t.h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body));
        t.h.store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify({ ...body, debug: mark }));
        // Spec §13.2: the driver asks the check to require a located correction (checkReproduction fails `not-located`).
        const asked: Array<boolean | undefined> = [];
        const passing = async (check: { requireLocated?: boolean }) => { asked.push(check.requireLocated); return { kind: "passed" as const, tests: [], command: "true" }; };
        const runId = await t.claim();
        await t.until(createExecutionDriver({ ...t.deps, checkReproduction: passing }), () => ["landed", "settled"].includes(t.body(runId).state));
        expect(asked).toEqual([true]);
        const rows = lines(t.repo, t.body(runId).drive.landedCommit, `.decisions/${fixRunId}.jsonl`);
        expect(rows.map((r) => r.ev)).toEqual(["decision"]);
        expect(rows[0]).toMatchObject({ id: `${fixRunId}/1`, importance: "major" });
        expect(rows[0]!.chose).toContain("keep the totals row");
        expect(rows[0]!.because).toContain("the export page lost its totals");
        expect(rows[0]!.because).toContain("orig-run/agent-0");
        const closing = JSON.parse(String(t.h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body)).debug.closing;
        expect(closing).toEqual({ state: "written", relPath: `.decisions/${fixRunId}.jsonl`, fixRunId });
      } finally { await t.h.dispose(); }
    });
  }
});

describe("recording and closing coarse corrections through the panel's verbs (spec §13.2, §13.4)", () => {
  const PANEL_KEY = "mykey";
  const REPO_ID = controlRepoKey(PANEL_KEY);
  const NOW = new Date(CORRECTED_AT);

  async function withPanel(fn: (ctx: { corrections: string; repo: string; command(path: string, payload: unknown, id: string): Promise<{ status: number; body: Record<string, any> }> }) => Promise<void>) {
    const root = await realpath(await mkdtemp(join(tmpdir(), "orca-coarse-")));
    const repo = await makeTargetRepo({ remote: "https://example.invalid/o/r.git" });
    try {
      const corrections = join(root, "corrections");
      await mkdir(corrections, { mode: 0o700 });
      const env: NodeJS.ProcessEnv = { ...process.env, ORCA_CONTROL_DIR: join(root, "control"), ORCA_CORRECTIONS_DIR: corrections };
      const panel = await createPanelServer({ ...parsePanelArgs(["--by", "tester", "--repo", `${PANEL_KEY}=${repo.path}`], env), now: () => NOW }, env);
      try {
        const session = await sessionFor(panel, env);
        const command = async (path: string, payload: unknown, commandId: string) => {
          const response = await session.fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ commandId, expectedRevision: 0, payload }) });
          return { status: response.status, body: await response.json() as Record<string, any> };
        };
        await fn({ corrections, repo: repo.path, command });
      } finally { await panel.close(); }
    } finally { await repo.cleanup(); await rm(root, { recursive: true, force: true }); }
  }

  it("records a repository-only correction from one sentence, and closes it with one decision row", async () => {
    await withPanel(async (ctx) => {
      const recorded = await ctx.command("/api/control/corrections", { repoId: REPO_ID, kind: "wrong", because: "the export page lost its totals" }, "rec-1");
      expect([recorded.status, recorded.body.result?.kind]).toEqual([200, "correction-recorded"]);
      const [row] = await readCorrections(ctx.corrections);
      expect(row).toEqual({ id: recorded.body.result.correctionId, projectKey: PANEL_KEY, kind: "wrong", because: "the export page lost its totals", at: CORRECTED_AT, by: "tester", via: "web" });
      // The reviews file is keyed by decision: a correction naming none leaves no review mark behind.
      expect(await readFile(reviewsFile(ctx.corrections), "utf8").catch(() => null)).toBeNull();
      const closed = await ctx.command(`/api/control/corrections/${row!.id}/close`, { correctionId: row!.id, choseInstead: "keep the totals row", undoHow: "git revert --no-edit HEAD" }, "close-1");
      expect([closed.status, closed.body.result?.kind]).toEqual([200, "correction-closed"]);
      const { id: _id, ...fields } = row!;
      const text = execFileSync("git", ["show", `HEAD:.decisions/${deriveFixRunId(fields, row!.id)}.jsonl`], { cwd: ctx.repo, encoding: "utf8" });
      const rows = text.trim().split("\n").map((line) => JSON.parse(line));
      expect(rows.map((r) => r.ev)).toEqual(["decision"]);
      expect(rows[0].chose).toBe("keep the totals row");
      // CLI v2 spec §16: the routed closer is named in the evidence, as on a decision or pending target's closing.
      expect(rows[0].evidence).toEqual([`correction ${row!.id}`, `repository ${PANEL_KEY}`, "closed by tester via web correction-close close-1"]);
    });
  });

  it("refuses a bare-run correction naming a run the control store does not hold", async () => {
    await withPanel(async (ctx) => {
      const refused = await ctx.command("/api/control/corrections", { repoId: REPO_ID, runId: "run-nowhere", kind: "wrong", because: "x" }, "rec-2");
      expect(refused.body.error?.code).toBe("run-not-found");
      expect(await readCorrections(ctx.corrections)).toEqual([]);
    });
  });
});

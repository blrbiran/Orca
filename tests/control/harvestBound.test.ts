/**
 * Off-plan writes #346, Task 4b (controller ruling, 2026-11-18): Orca's own bound on a task attempt's harvest. A v4
 * contract (its repository's `allowlistPaths` empty) is bounded by that repository's denylist -- protected paths and the
 * frozen sibling claims -- read with ccloop's matcher (exact, `<dir>/**`, `**`), so a write outside targetPaths is not
 * out-of-bounds, a write into a sibling's claim still is (a second line behind ccloop's own denylist). A v≤3 contract
 * keeps today's bound, targetPaths ∪ allowlistPaths. Collect (C) and accept-attempt both read it.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { withCommandContext } from "../../src/control/commandClient.js";
import { boundedHarvest, denylistMatches, extraHarvestBound, primaryHarvestBound } from "../../src/control/harvestBound.js";
import { readConfirmedTaskExecution } from "../../src/control/executionSnapshot.js";
import { writeSetOf } from "../../src/scheduler/writeSet.js";
import { driverHarness, git } from "./fixtures/driverHarness.js";
import type { WebFixtureTask } from "./fixtures/web.js";

type Contract = Parameters<typeof primaryHarvestBound>[0];
type Files = (id: string) => Record<string, string>;
const byTask = (files: Record<string, Record<string, string>>): Files => (id) => files[id] ?? {};
const contract = (safetyPolicy: { allowlistPaths: string[]; denylistPaths: string[] }, additionalRepos?: unknown[]): Contract => ({
  context: { repoPath: "/r", targetPaths: ["src/a.ts"], ...(additionalRepos === undefined ? {} : { repoKey: "main", additionalRepos }) },
  safetyPolicy: { maxFilesTouched: 5, humanGateConditions: [], ...safetyPolicy },
} as unknown as Contract);

describe("ccloop's denylist matcher, as Orca reads it", () => {
  it("exact, `<dir>/**` by prefix, `**` for everything", () => {
    expect(denylistMatches("src/b.ts", "src/b.ts")).toBe(true);
    expect(denylistMatches("src/b.ts", "src/b.tsx")).toBe(false);
    // mutation: drop the `/**` branch -> `src/board/**` never matches `src/board/cli.js`, red
    expect(denylistMatches("src/board/**", "src/board/cli.js")).toBe(true);
    expect(denylistMatches("src/board/**", "src/boardx.js")).toBe(false);
    // mutation: drop the `**` branch -> false, red
    expect(denylistMatches("**", "anything/at/all")).toBe(true);
  });
});

describe("a repository's bound", () => {
  it("v4 (empty allowlist): the denylist; v3: targetPaths ∪ allowlistPaths, exactly writeSetOf", () => {
    // mutation: always the write set -> red
    expect(primaryHarvestBound(contract({ allowlistPaths: [], denylistPaths: ["b", "docs/**"] }))).toEqual({ kind: "denylist", patterns: ["b", "docs/**"] });
    const v3 = contract({ allowlistPaths: ["src/a.ts"], denylistPaths: ["b"] });
    // mutation: always the denylist -> red
    expect(primaryHarvestBound(v3)).toEqual({ kind: "write-set", claims: writeSetOf(v3) });
  });

  it("an extra repository by its own policy; an absent allowlist is ccloop's default (its targetPaths), not none", () => {
    const multi = contract({ allowlistPaths: ["src/a.ts"], denylistPaths: [] }, [
      { key: "v4", repoPath: "/v4", targetPaths: ["src/**"], allowlistPaths: [], denylistPaths: ["shared/**"] },
      { key: "v3", repoPath: "/v3", targetPaths: ["src/**"], allowlistPaths: ["lib/**"] },
      { key: "absent", repoPath: "/absent", targetPaths: ["src/**"] },
    ]);
    // mutation: read the extra's bound from the primary's policy -> write-set, red
    expect(extraHarvestBound(multi, "v4")).toEqual({ kind: "denylist", patterns: ["shared/**"] });
    expect(extraHarvestBound(multi, "v3")).toEqual({ kind: "write-set", claims: [{ normalized: "src/", declared: "src/**" }, { normalized: "lib/", declared: "lib/**" }] });
    // mutation: treat an absent allowlist as empty -> denylist, red
    expect(extraHarvestBound(multi, "absent")).toEqual({ kind: "write-set", claims: [{ normalized: "src/", declared: "src/**" }] });
    expect(() => extraHarvestBound(multi, "nowhere")).toThrow("contract:nowhere");
  });
});

describe("the harvest under a bound, driven directly on git", () => {
  it("v4: only a denied path is out of bounds, an off-plan one is not; v3: today's bound", async () => {
    const root = await mkdtemp(join(tmpdir(), "orca-bound-")); try {
      git(root, "init", "-q", "-b", "main");
      await writeFile(join(root, "base.txt"), "b\n");
      git(root, "add", "base.txt"); git(root, "commit", "-qm", "base");
      const base = git(root, "rev-parse", "HEAD");
      for (const path of ["a.ts", "notes.md", "b.txt"]) await writeFile(join(root, path), `${path}\n`);
      git(root, "add", "-A"); git(root, "commit", "-qm", "attempt");
      const run = { runId: "r", workdir: root, outcome: "succeeded" as const, attemptSha: git(root, "rev-parse", "HEAD") };
      // As if ccloop let a write into a sibling's claim through: Orca's own check still names it.
      const v4 = await boundedHarvest(run, base, { kind: "denylist", patterns: ["b.txt"] }, root);
      // mutation: denylist bound treats nothing as out of bounds -> [], red
      expect(v4.outOfBounds).toEqual(["b.txt"]);
      expect(v4.actualPaths).toEqual(["a.ts", "b.txt", "notes.md"]);
      expect(v4.declaredNotProduced).toEqual([]);
      const v3 = await boundedHarvest(run, base, { kind: "write-set", claims: writeSetOf({ context: { targetPaths: ["a.ts"] }, safetyPolicy: { allowlistPaths: ["a.ts"] } }) }, root);
      expect(v3.outOfBounds).toEqual(["b.txt", "notes.md"]);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});

const LANDED = ["landed", "settled"];

describe("collect (C) bounds a v4 attempt by its denylist", () => {
  it("a v4 run writing an unlisted file in an unclaimed directory lands; one writing its sibling's claim blocks at C", async () => {
    // a and b run in parallel (no edge, no overlap): b's claim `b` is frozen into a's denylist at confirm.
    const files = byTask({ a: { a: "a\n", "docs/new.md": "n\n", b: "from a\n" }, b: { b: "b\n" } });
    const t = await driverHarness([{ taskId: "a" }, { taskId: "b" }], { files }); try {
      expect(readConfirmedTaskExecution(t.h.store, "g", "a").contract.safetyPolicy.denylistPaths).toEqual(["b"]);
      const runId = await t.claim();
      expect(t.body(runId).taskId).toBe("a");
      await t.until(t.driver(), () => t.body(runId).state === "blocked");
      // mutation: C keeps the targetPaths bound for v4 -> `out-of-bounds:b,docs/new.md`, red
      expect(t.body(runId).drive).toMatchObject({ blockedAt: "C", blockedReason: "out-of-bounds:b" });
    } finally { await t.h.dispose(); }
    const clean = await driverHarness([{ taskId: "a" }, { taskId: "b" }], { files: byTask({ a: { a: "a\n", "docs/new.md": "n\n" }, b: { b: "b\n" } }) }); try {
      const runId = await clean.claim();
      await clean.until(clean.driver(), () => LANDED.includes(clean.body(runId).state) || clean.body(runId).state === "blocked");
      // mutation: C keeps the targetPaths bound for v4 -> blocked `out-of-bounds:docs/new.md`, red
      expect(clean.body(runId).drive.blockedReason ?? null).toBe(null);
      expect(LANDED).toContain(clean.body(runId).state);
      expect(git(clean.repo, "show", "refs/heads/orca/g:docs/new.md")).toBe("n");
    } finally { await clean.h.dispose(); }
  }, 60_000);

  it("a v3-shaped contract keeps today's bound", async () => {
    const t = await driverHarness([{ taskId: "a", safetyPolicy: { allowlistPaths: ["a"] } }], { files: () => ({ a: "a\n", "docs/new.md": "n\n" }) }); try {
      const runId = await t.claim();
      await t.until(t.driver(), () => t.body(runId).state === "blocked");
      expect(t.body(runId).drive).toMatchObject({ blockedAt: "C", blockedReason: "out-of-bounds:docs/new.md" });
    } finally { await t.h.dispose(); }
  }, 30_000);
});

describe("accept-attempt bounds a v4 attempt by its denylist", { timeout: 120_000 }, () => {
  const OWNER = { client: "web", principal: "user:owner" };
  async function accepted(tasks: WebFixtureTask[], files: Files) {
    const t = await driverHarness(tasks, { behaviour: () => "failed", sealedOwnerProof: true, files });
    const runId = await t.claim(), driver = t.driver();
    await t.until(driver, () => t.body(runId).state === "blocked");
    const closed = t.service.closeRun(t.h.command("close-run", { runId }));
    if ("error" in closed) throw new Error(JSON.stringify(closed));
    await t.until(driver, () => t.body(runId).drive.cleanedUp === true);
    const command = t.h.command("accept-attempt", { taskId: "a", runId, note: "read the diff" }, "acc-1");
    await withCommandContext(command.commandId, OWNER, () => t.service.acceptAttempt(command));
    const deadline = Date.now() + 60_000;
    while (!["landed", "refused"].includes(t.body(runId).operatorAcceptance?.state) && Date.now() < deadline) {
      await driver.round(); await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return { t, runId, intent: t.body(runId).operatorAcceptance };
  }

  it("an off-plan file is accepted", async () => {
    const { t, runId, intent } = await accepted([{ taskId: "a" }, { taskId: "b" }], byTask({ a: { a: "a\n", "docs/new.md": "n\n" } }));
    try {
      // mutation: accept-attempt keeps the targetPaths bound for v4 -> refused `out-of-bounds:docs/new.md`, red
      expect(intent).toMatchObject({ state: "landed", reason: null });
      expect(git(t.repo, "show", "refs/heads/orca/g:docs/new.md")).toBe("n");
      // Spec W3 "when a run lands": an accepted attempt is a landing, recorded with it (fix round 1, item 1).
      // mutation: finish writes no off-plan row -> [], red
      const rows = t.h.store.db.prepare("SELECT body FROM activity WHERE group_id='g' AND kind='off-plan-write'").all().map((row) => JSON.parse(String(row.body)));
      expect(rows).toEqual([{ taskId: "a", runId, paths: ["docs/new.md"], count: 1 }]);
    } finally { await t.h.dispose(); }
  });

  it("a sibling's claimed file is refused", async () => {
    const { t, intent } = await accepted([{ taskId: "a" }, { taskId: "b" }], byTask({ a: { a: "a\n", b: "from a\n" } }));
    try {
      // mutation: the denylist bound denies nothing -> landed, red
      expect(intent).toMatchObject({ state: "refused", reason: "out-of-bounds:b" });
    } finally { await t.h.dispose(); }
  });
});

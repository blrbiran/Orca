import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { ExecutionDriver } from "../../src/control/executionDriver.js";
import { acceptGroups, acceptanceSatisfied, saveAcceptance, type GroupAcceptanceCheck } from "../../src/control/groupAcceptance.js";
import { driverHarness, git } from "./fixtures/driverHarness.js";

// Tester #278: five done groups whose `orca/<g>` had been deleted made the acceptance pass throw at `rev-parse` every
// driver round (~5 s), three log lines per group, forever (14k lines, ~10% panel CPU). A missing work branch is now a
// recorded state (`not-run: work-branch-missing`, keyed by the runs landed so far): later rounds skip the group without a
// git child, and a new landing checks it again. Any other git failure is still retried every round, but logged once. Git
// children are counted by a `git` shim on PATH (what is measured is what is asserted), never by reading the record back.

async function untilDeadline(driver: ExecutionDriver, predicate: () => boolean, deadlineMs = 20_000): Promise<void> {
  const deadline = Date.now() + deadlineMs;
  while (!predicate() && Date.now() < deadline) {
    await driver.round();
    if (!predicate()) await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (!predicate()) throw new Error("the driver did not reach the expected state before the deadline");
}

type Harness = Awaited<ReturnType<typeof driverHarness>>;
const group = (t: Harness) => JSON.parse(String(t.h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body));

/** A `git` on PATH that logs its arguments, then is the real git. */
function gitShim(): { dir: string; log: string } {
  const dir = mkdtempSync(join(tmpdir(), "orca-gitshim-")), log = join(dir, "calls");
  const real = execPathOfGit();
  writeFileSync(join(dir, "git"), `#!/bin/sh\nprintf '%s\\n' "$*" >> '${log}'\nexec '${real}' "$@"\n`);
  chmodSync(join(dir, "git"), 0o755);
  return { dir, log };
}
function execPathOfGit(): string {
  for (const dir of (process.env.PATH ?? "").split(":")) if (dir !== "" && existsSync(join(dir, "git"))) return join(dir, "git");
  throw new Error("no git on PATH");
}

/**
 * `rounds` acceptance rounds for one driver (one checks map), with the shim on PATH: the git children naming `orca/g` and
 * the stderr lines naming group `g`. `repo` overrides where the group's repository resolves (a transient failure).
 */
async function rounds(t: Harness, checks: Map<string, GroupAcceptanceCheck>, n: number, repo?: string): Promise<{ git: string[]; logged: string[] }> {
  const shim = gitShim();
  const path = process.env.PATH;
  const written: string[] = [];
  const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => { written.push(String(chunk)); return true; });
  process.env.PATH = `${shim.dir}:${path ?? ""}`;
  try {
    for (let i = 0; i < n; i += 1) {
      await acceptGroups({
        store: t.h.store, roots: t.deps.roots, resolveRepository: repo === undefined ? t.deps.resolveRepository : () => repo,
        write: (action) => action(), stopped: () => false,
      }, checks);
      // A check started this round settles before the next (the pass reads it back then).
      for (const check of checks.values()) await check.done;
    }
  } finally {
    process.env.PATH = path;
    spy.mockRestore();
  }
  const calls = existsSync(shim.log) ? readFileSync(shim.log, "utf8").split("\n").filter((line) => line.includes("orca/g")) : [];
  return { git: calls, logged: written.filter((line) => line.includes("group g:")) };
}

/** Two landed tasks, accepted (passed) and done; the driver stopped, so only the rounds below touch the group. */
async function doneGroup(): Promise<Harness> {
  const t = await driverHarness([{ taskId: "a" }, { taskId: "b" }]);
  await t.claim(); await t.claim();
  const driver = t.driver();
  await untilDeadline(driver, () => group(t).status === "done", 60_000);
  await driver.stop();
  expect(group(t).acceptance).toMatchObject({ result: "passed" });
  return t;
}

describe("a missing work branch is a recorded state, not an error retried every round (tester #278)", { timeout: 180_000 }, () => {
  it("a done group whose branch is gone: one git child and one log line over ten rounds; recorded not-run, still done", async () => {
    const t = await doneGroup(); try {
      git(t.repo, "update-ref", "-d", "refs/heads/orca/g");
      const { git: calls, logged } = await rounds(t, new Map(), 10);
      expect(calls).toHaveLength(1);
      expect(logged).toHaveLength(1);
      expect(logged[0]).toContain("orca/g does not exist");
      expect(group(t).acceptance).toMatchObject({ tip: null, result: "not-run", why: "work-branch-missing", landings: 2, commands: [] });
      expect(group(t).status).toBe("done");
      // A new driver (a restart) reads the record: still no git child.
      expect((await rounds(t, new Map(), 3)).git).toEqual([]);
    } finally { await t.h.dispose(); }
  });

  it("the branch back and a later landing (the record's landing count is behind): the tip is checked again", async () => {
    const t = await doneGroup(); try {
      const tip = git(t.repo, "rev-parse", "refs/heads/orca/g");
      git(t.repo, "update-ref", "-d", "refs/heads/orca/g");
      const checks = new Map<string, GroupAcceptanceCheck>();
      await rounds(t, checks, 1);
      expect(group(t).acceptance.why).toBe("work-branch-missing");
      // The branch alone coming back, with nothing landed since, is not looked for (no git child).
      git(t.repo, "update-ref", "refs/heads/orca/g", tip);
      expect((await rounds(t, checks, 3)).git).toEqual([]);
      // A landing since the record (stood in for by a record written one landing earlier): checked again, and passes.
      saveAcceptance(t.h.store, "g", { ...group(t).acceptance, landings: 1 });
      const again = await rounds(t, checks, 3);
      expect(again.git.length).toBeGreaterThan(0);
      expect(group(t).acceptance).toMatchObject({ result: "passed", tip });
    } finally { await t.h.dispose(); }
  });

  it("a git failure that is not a missing branch: retried every round, logged once, nothing recorded", async () => {
    const t = await doneGroup(); try {
      const before = group(t).acceptance;
      // Not a repository: git exits 128, as an unreadable repository would; never read as "branch missing".
      const notRepo = mkdtempSync(join(tmpdir(), "orca-notrepo-"));
      const checks = new Map<string, GroupAcceptanceCheck>();
      const { git: calls, logged } = await rounds(t, checks, 10, notRepo);
      expect(calls).toHaveLength(10);
      expect(logged).toHaveLength(1);
      expect(group(t).acceptance).toEqual(before);
      // A round without the failure clears it: the same failure coming back later is news again, and logged once more.
      expect((await rounds(t, checks, 1)).logged).toEqual([]);
      expect((await rounds(t, checks, 3, notRepo)).logged).toHaveLength(1);
    } finally { await t.h.dispose(); }
  });

  it("a missing branch satisfies the acceptance of a done group only; any other group has no tree to accept and waits", async () => {
    const t = await doneGroup(); try {
      const record = { tip: null, result: "not-run", why: "work-branch-missing", landings: 2, commands: [], at: 1 };
      expect(acceptanceSatisfied(t.h.store, "g", { status: "done", acceptance: record })).toBe(true);
      expect(acceptanceSatisfied(t.h.store, "g", { status: "running", acceptance: record })).toBe(false);
      expect(acceptanceSatisfied(t.h.store, "g", { status: "review", acceptance: record })).toBe(false);
    } finally { await t.h.dispose(); }
  });
});

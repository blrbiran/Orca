import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { acceptGroups, type GroupAcceptanceCheck } from "../../src/control/groupAcceptance.js";
import { landingWatchesSettled, watchLandings, type LandingWatchCheck } from "../../src/control/landingWatch.js";
import { reviewOf } from "../../src/control/requirementReviewRecord.js";
import { reviewRequirements, saveReview } from "../../src/control/requirementReview.js";
import { driverHarness, git } from "./fixtures/driverHarness.js";
import { reviewWorld } from "./fixtures/reviewWorld.js";

// Tester #278 rest (follow-up I): round H made a missing work branch a recorded acceptance state, but the landing watch and
// the requirement review still ran `git rev-parse orca/<g>` every driver round on such a group and wrote one stderr line
// each time (`landing watch: Command failed: git ... rev-parse --verify refs/heads/orca/<g>^{commit}`, 8 s -> 9 lines).
// Both now record it as the acceptance pass does (`not-run: work-branch-missing`, keyed by the runs landed so far) and skip
// the group without a git child until a new landing. Git children are counted by a `git` shim on PATH and log lines by a
// stderr spy (what is measured is what is asserted).

type Harness = Awaited<ReturnType<typeof driverHarness>>;
const group = (t: Harness) => JSON.parse(String(t.h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body));

function gitShim(): { dir: string; log: string } {
  const dir = mkdtempSync(join(tmpdir(), "orca-gitshim-")), log = join(dir, "calls");
  let real: string | null = null;
  for (const entry of (process.env.PATH ?? "").split(":")) if (real === null && entry !== "" && existsSync(join(entry, "git"))) real = join(entry, "git");
  if (real === null) throw new Error("no git on PATH");
  writeFileSync(join(dir, "git"), `#!/bin/sh\nprintf '%s\\n' "$*" >> '${log}'\nexec '${real}' "$@"\n`);
  chmodSync(join(dir, "git"), 0o755);
  return { dir, log };
}

/** `n` rounds of `pass` with the shim on PATH: the `rev-parse` children naming `orca/g`, and the stderr lines naming group g. */
async function rounds(n: number, pass: () => Promise<unknown>): Promise<{ revParse: string[]; logged: string[] }> {
  const shim = gitShim(), path = process.env.PATH, written: string[] = [];
  const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => { written.push(String(chunk)); return true; });
  process.env.PATH = `${shim.dir}:${path ?? ""}`;
  try { for (let i = 0; i < n; i += 1) await pass(); }
  finally { process.env.PATH = path; spy.mockRestore(); }
  const calls = existsSync(shim.log) ? readFileSync(shim.log, "utf8").split("\n").filter((line) => line.includes("rev-parse") && line.includes("orca/g")) : [];
  return { revParse: calls, logged: written.filter((line) => line.includes("group g:")) };
}

const passDeps = (t: Harness, repo?: string) => ({
  store: t.h.store, roots: t.deps.roots, resolveRepository: repo === undefined ? t.deps.resolveRepository : () => repo,
  write: <T>(action: () => T) => action(), stopped: () => false,
});

/** Task a landed on orca/g and b (after a) not yet run; the watch's record removed, so a's landing is one it has not covered. */
async function midGroup(): Promise<Harness> {
  const t = await driverHarness([{ taskId: "a" }, { taskId: "b", dependsOn: ["a"] }]);
  const runId = await t.claim();
  const driver = t.driver();
  await t.until(driver, () => t.body(runId).drive?.cleanedUp === true && typeof t.body(runId).drive?.landedCommit === "string");
  await driver.stop();
  await landingWatchesSettled();
  const body = group(t);
  delete body.landingWatch;
  t.h.store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify(body));
  return t;
}

async function watchRounds(t: Harness, checks: Map<string, LandingWatchCheck>, n: number, repo?: string) {
  return rounds(n, async () => { await watchLandings(passDeps(t, repo), checks); await landingWatchesSettled(); });
}

describe("the landing watch over a group whose work branch is gone (#278 rest)", { timeout: 180_000 }, () => {
  it("ten rounds: one rev-parse, one log line; recorded work-branch-missing for the runs landed so far", async () => {
    const t = await midGroup(); try {
      git(t.repo, "update-ref", "-d", "refs/heads/orca/g");
      const checks = new Map<string, LandingWatchCheck>();
      const { revParse, logged } = await watchRounds(t, checks, 10);
      // mutation L1: drop the workBranchKnownMissing skip in watchGroup -> a rev-parse every round, red
      expect(revParse).toHaveLength(1);
      // mutation L2: revParse instead of workBranchTip (a throw, logged per round) -> red
      expect(logged).toEqual(["orca-driver: group g: landing watch: not run, orca/g does not exist (checked again after a new landing)\n"]);
      expect(group(t).acceptance).toMatchObject({ tip: null, result: "not-run", why: "work-branch-missing", landings: 1 });
      // A restarted driver (a new checks map) reads the record: no git child.
      expect((await watchRounds(t, new Map(), 3)).revParse).toEqual([]);
    } finally { await t.h.dispose(); }
  });

  it("a git failure that is not a missing branch: retried every round, logged once, nothing recorded", async () => {
    const t = await midGroup(); try {
      const notRepo = mkdtempSync(join(tmpdir(), "orca-notrepo-"));
      const checks = new Map<string, LandingWatchCheck>();
      const { revParse, logged } = await watchRounds(t, checks, 10, notRepo);
      expect(revParse).toHaveLength(10);
      // mutation L3: the old per-round stderr write in watchLandings' catch -> ten lines, red
      expect(logged).toHaveLength(1);
      expect(group(t).acceptance).toBeUndefined();
    } finally { await t.h.dispose(); }
  });

  it("a group whose branch exists is watched as before", async () => {
    const t = await midGroup(); try {
      const tip = git(t.repo, "rev-parse", "refs/heads/orca/g");
      const checks = new Map<string, LandingWatchCheck>();
      const { logged } = await watchRounds(t, checks, 3);
      expect(logged).toEqual([]);
      expect(group(t).landingWatch).toMatchObject({ tip });
      expect(group(t).acceptance).toBeUndefined();
    } finally { await t.h.dispose(); }
  });
});

describe("the requirement review over a done group whose work branch is gone (#278 rest)", { timeout: 300_000 }, () => {
  /** A reviewed, done group whose review is due again (as a rerun leaves it): the review pass would claim a round. */
  async function dueAgain() {
    const w = await reviewWorld();
    await w.runAll();
    await w.t.until(w.driver, () => w.groupStatus() === "done", 120);
    await w.driver.stop();
    await landingWatchesSettled();
    const review = reviewOf(group(w.t))!;
    saveReview(w.t.h.store, "g", { ...review, state: "pending" });
    return w;
  }
  const reviewDeps = (t: Harness) => ({ store: t.h.store, resolveRepository: t.deps.resolveRepository, write: <T>(action: () => T) => action() });

  it("ten driver rounds (acceptance, then review): one rev-parse and one log line in all; the review claims nothing", async () => {
    const w = await dueAgain(); const t = w.t; try {
      git(t.repo, "update-ref", "-d", "refs/heads/orca/g");
      const checks = new Map<string, GroupAcceptanceCheck>();
      const { revParse, logged } = await rounds(10, async () => { await acceptGroups(passDeps(t), checks); await reviewRequirements(reviewDeps(t)); });
      // mutation R1: drop the workBranchKnownMissing skip in reviewRequirements -> a rev-parse every round, red
      expect(revParse).toHaveLength(1);
      // mutation R2: revParse instead of workBranchTip in the review (a throw, logged) -> red
      expect(logged).toEqual(["orca-driver: group g: acceptance: not run, orca/g does not exist (checked again after a new landing)\n"]);
      expect(reviewOf(group(t))?.state).toBe("pending");
      expect(group(t).status).toBe("done");
    } finally { await t.h.dispose(); }
  });

  it("the review alone finding it: recorded as acceptance records it, once", async () => {
    const w = await dueAgain(); const t = w.t; try {
      git(t.repo, "update-ref", "-d", "refs/heads/orca/g");
      const { revParse, logged } = await rounds(10, () => reviewRequirements(reviewDeps(t)));
      expect(revParse).toHaveLength(1);
      expect(logged).toEqual(["orca-driver: group g: requirement review: not run, orca/g does not exist (checked again after a new landing)\n"]);
      expect(group(t).acceptance).toMatchObject({ tip: null, result: "not-run", why: "work-branch-missing", landings: 2 });
    } finally { await t.h.dispose(); }
  });

  it("a git failure in the review that is not a missing branch: logged once", async () => {
    const w = await dueAgain(); const t = w.t; try {
      const notRepo = mkdtempSync(join(tmpdir(), "orca-notrepo-"));
      const { revParse, logged } = await rounds(10, () => reviewRequirements({ ...reviewDeps(t), resolveRepository: () => notRepo }));
      expect(revParse).toHaveLength(10);
      // mutation R3: the old per-round stderr write in reviewRequirements' catch -> ten lines, red
      expect(logged).toHaveLength(1);
    } finally { await t.h.dispose(); }
  });

  it("a done group whose branch exists: the due review claims its round as before", async () => {
    const w = await dueAgain(); const t = w.t; try {
      const { logged } = await rounds(1, () => reviewRequirements(reviewDeps(t)));
      expect(logged).toEqual([]);
      expect(reviewOf(group(t))?.state).toBe("reviewing");
    } finally { await t.h.dispose(); }
  });
});

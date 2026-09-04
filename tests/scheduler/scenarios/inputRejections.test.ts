import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  allRefShas,
  captureStreams,
  makeSandbox,
  porcelain,
  runCli,
  seedRejectablePlan,
  seedTwoTaskPlan,
  writeRawContract,
  writeScriptedConfig,
} from "../sandbox.js";

// The final whole-branch review's input-validation cluster: four different
// input errors that all belong on spec §9.3's exit-1 row and all reached the
// user as exit 3 plus a raw node stack instead — one of them only AFTER the
// person's worktree had already been checked out onto a new branch. This is
// the one place in the branch where the exit-code contract §6.3 spends a whole
// section defending was actually broken.
//
// Every case that goes through `orca run` asserts the same three things S11
// and S13 assert, for the same reasons: exit 1 (not 3), the SPECIFIC rejection
// code (many checks exit 1, so pinning only the code number cannot tell one
// from another), and the target repository byte-identical afterwards —
// measured as every ref's sha plus `git status --porcelain`, never `git diff`,
// which is blind to an untracked file's content.
//
// A real --adapter-config is passed throughout, exactly as S11/S13 do: without
// one, `options.adapterConfig === undefined` returns exit 1 on its own before
// `checkoutWorkBranch` is reached, and would mask a broken check here.
describe("input rejections that used to be exit 3 (spec §9.3 / §6.3)", () => {
  it("a contract path that does not exist is rejected as unreadable-contract at exit 1, target repo untouched", async () => {
    // A typo in a contract path is the purest exit-1 case there is. It used to
    // print `Error: ENOENT ... at async loadRound` and exit 3, because
    // `loadRound` reads and parses each contract with no error handling AND is
    // called outside both runRound's and runPlan's try blocks.
    const s = await makeSandbox();
    try {
      const planPath = await seedRejectablePlan(s, {
        tasks: [{ taskId: "T1", contract: join(s.root, "no-such-contract.json"), dependsOn: [] }],
      });

      const refsBefore = await allRefShas(s.targetRepo);
      const porcelainBefore = await porcelain(s.targetRepo);

      const adapterConfig = await writeScriptedConfig(s, "missing-contract", [{}]);
      const { result: rc, stderr } = await captureStreams(() =>
        // The rejection is CAPTURED, not awaited bare (the same shape
        // roundFailure.test.ts uses): with the guard under test removed, the
        // throw comes back out of runCli and a bare await would end this
        // criterion before any assertion ran — §0.3 does not accept a crash
        // as evidence about an assertion.
        runCli(["run", planPath, "--adapter-config", adapterConfig]).catch((err: Error) => err.message),
      );

      expect(rc).toBe(1);
      expect(stderr).toContain("rejected: unreadable-contract:");
      // Names the task and the path, so the typo is fixable from the message
      // alone rather than by re-reading the plan file.
      expect(stderr).toContain("T1");
      expect(stderr).toContain("no-such-contract.json");

      expect(await allRefShas(s.targetRepo)).toEqual(refsBefore);
      expect(await porcelain(s.targetRepo)).toBe(porcelainBefore);
    } finally {
      await s.cleanup();
    }
  });

  it("a contract that is not valid JSON is rejected as unreadable-contract at exit 1, target repo untouched", async () => {
    // The other half of the same guard, and a genuinely different code path:
    // the file opens fine and `JSON.parse` is what throws. A fix that only
    // wrapped the read would leave this one exiting 3.
    const s = await makeSandbox();
    try {
      const contract = await writeRawContract(s, "not-json", "{ this is not json");
      const planPath = await seedRejectablePlan(s, {
        tasks: [{ taskId: "T1", contract, dependsOn: [] }],
      });

      const refsBefore = await allRefShas(s.targetRepo);
      const porcelainBefore = await porcelain(s.targetRepo);

      const adapterConfig = await writeScriptedConfig(s, "bad-json-contract", [{}]);
      const { result: rc, stderr } = await captureStreams(() =>
        // The rejection is CAPTURED, not awaited bare (the same shape
        // roundFailure.test.ts uses): with the guard under test removed, the
        // throw comes back out of runCli and a bare await would end this
        // criterion before any assertion ran — §0.3 does not accept a crash
        // as evidence about an assertion.
        runCli(["run", planPath, "--adapter-config", adapterConfig]).catch((err: Error) => err.message),
      );

      expect(rc).toBe(1);
      expect(stderr).toContain("rejected: unreadable-contract:");
      expect(stderr).toContain("not valid JSON");

      expect(await allRefShas(s.targetRepo)).toEqual(refsBefore);
      expect(await porcelain(s.targetRepo)).toBe(porcelainBefore);
    } finally {
      await s.cleanup();
    }
  });

  it("a taskId that cannot become a run id is rejected as unusable-task-id at exit 1, before the worktree is touched", async () => {
    // The expensive one. `deriveRunId` throws for this input, but its first
    // call is deep inside the layer loop — so "team/alpha" used to cost a
    // branch creation, a checkout of the person's own worktree onto that
    // branch, and a ledger commit before failing with exit 3. The
    // byte-identical assertions below are the ones that were false: this is
    // the only case in the cluster where the repository had already been
    // modified by the time the error surfaced.
    const s = await makeSandbox();
    try {
      const planPath = await seedRejectablePlan(s, {
        tasks: [{ taskId: "team/alpha", contract: join(s.runsDir, "contract-T1.json"), dependsOn: [] }],
      });

      const refsBefore = await allRefShas(s.targetRepo);
      const porcelainBefore = await porcelain(s.targetRepo);

      const adapterConfig = await writeScriptedConfig(s, "bad-task-id", [{}]);
      const { result: rc, stderr } = await captureStreams(() =>
        // The rejection is CAPTURED, not awaited bare (the same shape
        // roundFailure.test.ts uses): with the guard under test removed, the
        // throw comes back out of runCli and a bare await would end this
        // criterion before any assertion ran — §0.3 does not accept a crash
        // as evidence about an assertion.
        runCli(["run", planPath, "--adapter-config", adapterConfig]).catch((err: Error) => err.message),
      );

      expect(rc).toBe(1);
      expect(stderr).toContain("rejected: unusable-task-id:");

      expect(await allRefShas(s.targetRepo)).toEqual(refsBefore);
      expect(await porcelain(s.targetRepo)).toBe(porcelainBefore);
    } finally {
      await s.cleanup();
    }
  });

  it("orca plan exits 1 when a runtime check fails, and 0 when none does", async () => {
    // spec §9.3: `plan` answers "is this plan legal". §4.2's three runtime
    // checks are up-front REJECTIONS, and §9.3 gives a rejected plan exit 1 —
    // so printing `[fail] dirty-worktree: …` and then exiting 0 was a broken
    // contract, not a warning. §9.3's "warnings do not affect the exit code"
    // carve-out is about DEGRADATION (a fully serial plan is legal), not about
    // a failed check.
    //
    // Both halves are asserted in one criterion deliberately: "return 1
    // always" satisfies the first half on its own, and the clean control is
    // what rules it out.
    const s = await makeSandbox();
    try {
      const planPath = await seedTwoTaskPlan(s);

      const clean = await captureStreams(() => runCli(["plan", planPath]));
      expect(clean.result).toBe(0);
      expect(clean.stdout).toContain("[pass] dirty-worktree");

      await writeFile(join(s.targetRepo, "untracked.txt"), "someone's uncommitted work\n");

      const dirty = await captureStreams(() => runCli(["plan", planPath]));
      // The report is still printed — a caller who only reads the exit status
      // must not lose the reason.
      expect(dirty.stdout).toContain("[fail] dirty-worktree:");
      expect(dirty.result).toBe(1);
    } finally {
      await s.cleanup();
    }
  });

  it("a targetRepo that is not a git repository is rejected, not thrown", async () => {
    // preflight's third check was the only one of the three that could fail
    // rather than answer: `git status --porcelain` throws where the other two
    // swallow their error and answer "no". So a targetRepo that is not a git
    // repository at all propagated a raw spawn error out of `orca plan`.
    //
    // Reported under `dirty-worktree` rather than a fourth check name: the
    // check's claim is "the worktree is verifiably clean before C checks a
    // real person's worktree out onto W", and a directory whose cleanliness
    // cannot be read fails that claim for real. The message says which of the
    // two happened, so the two are not conflated for a reader.
    const s = await makeSandbox();
    try {
      const notARepo = join(s.root, "not-a-repo");
      await mkdir(notARepo, { recursive: true });
      const planPath = await seedRejectablePlan(s, { targetRepo: notARepo });

      const { result: rc, stdout } = await captureStreams(() =>
        // Captured for the same reason as above: with preflight's guard
        // removed this rejects rather than returning a code.
        runCli(["plan", planPath]).catch((err: Error) => err.message),
      );

      expect(rc).toBe(1);
      expect(stdout).toContain("[fail] dirty-worktree:");
      expect(stdout).toContain("cannot determine whether the worktree");
    } finally {
      await s.cleanup();
    }
  });
});

import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { captureStreams, makeSandbox, runCli, seedRejectablePlan, writeScriptedConfig } from "../sandbox.js";

// spec (2026-09-05 corrections/overturned) §7 item 3, registered to C: `run`
// takes the repo lock at run.ts before preflight runs, and the lock is a
// non-recursive mkdir of `<targetRepo>/.git/orca-lock`. For a target that is
// not a git repository there is no `.git` to create it under, so the round
// died on node's own errno text -- `ENOENT: no such file or directory, mkdir
// '<target>/.git/orca-lock'` -- which names an implementation detail the user
// never asked for and never says the one thing that is actually wrong.
//
// ⚠️ The fix is NOT to move preflight ahead of the lock. run.ts's own comment
// records why the lock comes first (spec §1.2 rule 3): preflight's answers
// about the worktree are only meaningful while no second orca can be moving W
// underneath them. What goes ahead of the lock here is strictly narrower --
// whether the lock can be placed at all -- and that is not a question a
// concurrent orca can change the answer to.
//
// The code is `target-not-a-git-repo`, ruling 甲 of that spec's §1.2: a named
// rejection of its own rather than a side effect of the three §4.2 checks.
// ⚠️ This wires it into `run` only. `orca plan` on the same target still
// prints the three side-effect failures pinned by preflightUnreadableRepo --
// that half of ruling 甲 stays open, and this file does not touch it.
//
// The positive control is not in this file and does not need to be: S1, S2 and
// S21 all run a real round against a real repository through this same line,
// so a probe that rejected a valid target would take them red.
describe("run on a target that cannot hold the repo lock (spec §7 item 3)", () => {
  it("names the target as not a git repository instead of node's mkdir errno", async () => {
    const s = await makeSandbox();
    try {
      const notARepo = join(s.root, "not-a-repo");
      await mkdir(notARepo, { recursive: true });
      const before = (await readdir(notARepo)).sort();

      const planPath = await seedRejectablePlan(s, { targetRepo: notARepo });
      const adapterConfig = await writeScriptedConfig(s, "non-git-target", [{}]);
      const { result: rc, stderr } = await captureStreams(() =>
        runCli(["run", planPath, "--adapter-config", adapterConfig]),
      );

      expect(rc).toBe(1);
      expect(stderr).toContain("rejected: target-not-a-git-repo:");

      // The defect itself, pinned as two things the user must NOT be shown.
      // Asserted separately from the line above because a rejection that was
      // emitted and then followed by the raw failure anyway would satisfy the
      // first assertion on its own.
      expect(stderr).not.toContain("ENOENT");
      expect(stderr).not.toContain("orca-lock");

      // Which of the two failures it was, not merely that one of them was.
      // Without this the two branches of the message are indistinguishable
      // from the outside, and collapsing them into one string would go
      // unobserved in both criteria in this file.
      expect(stderr).toContain("is not a git repository");

      // The rejection has to happen before anything is created, not after:
      // `.git` must not have appeared under a directory orca just refused.
      expect((await readdir(notARepo)).sort()).toEqual(before);
    } finally {
      await s.cleanup();
    }
  });

  it("rejects a directory inside a repository but not at its root, for the same reason", async () => {
    const s = await makeSandbox();
    try {
      // The same defect class, reached a different way: `git rev-parse`
      // succeeds here -- this path IS in a repository -- while the lock still
      // has no `<targetRepo>/.git` to go under. A probe that only asked "does
      // git answer here" would let this one through to the same errno.
      const nested = join(s.targetRepo, "sub");
      await mkdir(nested, { recursive: true });

      const planPath = await seedRejectablePlan(s, { targetRepo: nested });
      const adapterConfig = await writeScriptedConfig(s, "nested-target", [{}]);
      const { result: rc, stderr } = await captureStreams(() =>
        runCli(["run", planPath, "--adapter-config", adapterConfig]),
      );

      expect(rc).toBe(1);
      expect(stderr).toContain("rejected: target-not-a-git-repo:");
      expect(stderr).not.toContain("ENOENT");

      // The other branch of the message, pinned by the half that only it can
      // produce. Asserting the target path instead would prove nothing: the
      // lock path printed in BOTH messages already contains it as a prefix.
      expect(stderr).toContain("is not the root of a git repository");
    } finally {
      await s.cleanup();
    }
  });
});

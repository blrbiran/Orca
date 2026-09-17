import { existsSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resume } from "../../src/checkpoint/resume.js";
import { writeCheckpoint } from "../../src/checkpoint/write.js";
import { ORCA_IDENTITY, git } from "../../src/scheduler/gitExec.js";
import { checkpointFixture, putCheckpoint } from "../helpers/checkpoint.js";
import { runCli } from "../helpers/runCli.js";
import { NOW, checkpointSession } from "../helpers/session.js";
import { commitFile, tempRepo } from "../helpers/tempRepo.js";
import { SESSION } from "../helpers/transcript.js";

async function written(draft: unknown) {
  const s = await checkpointSession(400_000, draft);
  const result = await writeCheckpoint({ repo: s.repo, sessionRef: SESSION, transcriptPath: s.transcriptPath, draftPath: s.draftPath, now: NOW });
  return { ...s, path: result.path, checkpoint: result.checkpoint };
}

describe("resume (D spec 5 step 4, 9 item 3)", () => {
  it("through the real process: judgment, later commits, stale re-run, failed publish check and the human queue", async () => {
    const s = await written({
      next: ["finish task 6"],
      open: ["which window for claude-opus-5"],
      awaitingHuman: [{ kind: "irreversible", what: "push main" }],
      measure: ["true"],
    });
    await commitFile(s.repo, "a.txt", "a\n", "later work");
    const out = await runCli(["resume", "--repo", s.repo]);
    expect(out.code).toBe(0);
    expect(out.stdout).toContain(`checkpoint: ${s.path}\n`);
    // E6-1: describeLevel has no assertion anywhere else in this plan. Asserted as a literal, not via
    // describeLevel itself (fix round 1: computing the expectation with the function under test means a
    // mutant that makes describeLevel return "" makes the expectation "" too, and toContain("") always
    // passes). checkpointSession(400_000, draft) yields promptTokens=400_000, outputTokens=1 (the
    // transcript helper's fixed output), so level=400_001 against the "[1m]" model's 1,000,000-token
    // window and the default 330,000/450,000 thresholds — band 1.
    expect(out.stdout).toContain("level 400001 of 1000000 (T1 330000, T2 450000, band 1)");
    expect(out.stdout).toContain("\n  1. finish task 6\n");
    expect(out.stdout).toContain("\n  - which window for claude-opus-5\n");
    expect(out.stdout).toContain(" later work\n");
    expect(out.stdout).toContain("measurements (stale (1 file(s) changed since)):\n");
    expect(out.stdout).toContain("  same exit 0 -> 0: true (output ");
    // E6-2: the ls-remote failure sentence (no origin remote in this fixture repo).
    expect(out.stdout).toContain("publish: ls-remote origin failed: ");
    expect(out.stdout).toContain("\n  - [irreversible] push main\n");
  });

  it("the checkpoint's own commit does not make its measurements stale", async () => {
    const s = await written({ next: ["n"], measure: ["true"] });
    expect((await resume({ repo: s.repo })).text).toContain("measurements (fresh):\n");

    // Final review M1: a located checkpoint is read from its commit. An uncommitted edit to the file in the
    // worktree must not be presented as the committed checkpoint.
    await writeFile(s.path, JSON.stringify({ ...s.checkpoint, next: ["uncommitted edit"] }));
    const text = (await resume({ repo: s.repo })).text;
    expect(text).toContain("\nnext:\n  1. n\nopen:\n");
    expect(text).not.toContain("uncommitted edit");
  });

  it("exits 2 naming the measurement whose exit code changed", async () => {
    const s = await written({ next: ["n"], measure: ["test -f flag.txt"] });
    await commitFile(s.repo, "flag.txt", "x\n", "add the flag");
    const result = await resume({ repo: s.repo });
    expect(result.exitCode).toBe(2);
    expect(result.text).toContain("  CHANGED exit 1 -> 0: test -f flag.txt (output ");
  });

  it("reports ahead and behind against origin, measured now", async () => {
    const repo = await tempRepo();
    const bare = await mkdtemp(join(tmpdir(), "orca-origin-"));
    await git(bare, ["init", "-q", "--bare"]);
    await git(repo, ["remote", "add", "origin", bare]);
    await git(repo, ["push", "-q", "origin", "main"]);
    const s = await checkpointSession(400_000, { next: ["n"] });
    // Reuse the session's transcript and draft against the repository that has an origin.
    await writeCheckpoint({ repo, sessionRef: SESSION, transcriptPath: s.transcriptPath, draftPath: s.draftPath, now: NOW });
    await commitFile(repo, "b.txt", "b\n", "after the checkpoint");
    // E6-2: the ls-remote success sentence, against a real local bare repo (never a network remote, GC4).
    expect((await resume({ repo })).text).toContain("; local ahead 2, behind 0 (measured now by ls-remote)\n");
  });

  it("refuses two checkpoint files in the latest checkpoint commit, naming --checkpoint", async () => {
    const repo = await tempRepo();
    const headSha = (await git(repo, ["rev-parse", "HEAD"])).trim();
    await putCheckpoint(repo, "orca-dev-0a1b2c3d.json", checkpointFixture({ head: headSha }));
    await putCheckpoint(repo, "orca-dev-ffffffff.json", checkpointFixture({ head: headSha, runId: "orca-dev-ffffffff" }));
    await git(repo, ["add", "--", ".orca"]);
    await git(repo, [...ORCA_IDENTITY, "commit", "-q", "-m", "two at once"]);
    await expect(resume({ repo })).rejects.toMatchObject({ code: "ambiguous-checkpoint" });
    await expect(resume({ repo })).rejects.toThrow("--checkpoint");
  });

  it("with --checkpoint reads the named file even when the latest commit is ambiguous", async () => {
    const repo = await tempRepo();
    const headSha = (await git(repo, ["rev-parse", "HEAD"])).trim();
    const first = await putCheckpoint(repo, "orca-dev-0a1b2c3d.json", checkpointFixture({ head: headSha, next: ["the named one"] }));
    await putCheckpoint(repo, "orca-dev-ffffffff.json", checkpointFixture({ head: headSha, runId: "orca-dev-ffffffff" }));
    await git(repo, ["add", "--", ".orca"]);
    await git(repo, [...ORCA_IDENTITY, "commit", "-q", "-m", "two at once"]);
    const text = (await resume({ repo, checkpointPath: first })).text;
    expect(text).toContain(`checkpoint: ${first}\n`);
    expect(text).toContain("\n  1. the named one\n");

    // E6-2: checkpoint-invalid, via --checkpoint pointing at a file that is not JSON at all.
    const badCheckpoint = join(repo, "not-a-checkpoint.txt");
    await writeFile(badCheckpoint, "not json");
    await expect(resume({ repo, checkpointPath: badCheckpoint })).rejects.toMatchObject({ code: "checkpoint-invalid" });

    // Fix round 1 (minor): checkpoint-invalid also fires for valid JSON of the wrong shape.
    const wrongShape = join(repo, "wrong-shape.json");
    await writeFile(wrongShape, JSON.stringify({}));
    await expect(resume({ repo, checkpointPath: wrongShape })).rejects.toMatchObject({ code: "checkpoint-invalid" });
  });

  it("refuses by name when no checkpoint is reachable from HEAD", async () => {
    await expect(resume({ repo: await tempRepo() })).rejects.toMatchObject({ code: "no-checkpoint" });
  });

  it("refuses a recorded measurement the Tier 0 gate blocks, without running it (Tier 0 gate spec 6.4)", async () => {
    const repo = await tempRepo();
    const outside = await mkdtemp(join(tmpdir(), "orca-gated-"));
    const sha = (await git(repo, ["rev-parse", "HEAD"])).trim();
    await putCheckpoint(
      repo,
      "orca-dev-0a1b2c3d.json",
      checkpointFixture({
        head: sha,
        measurements: [{ command: `git push origin main; touch ${outside}/ran`, exitCode: 0, commit: sha, observedAt: "2026-09-17T00:00:00.000Z", outputPath: "/nonexistent/1.txt" }],
      }),
    );
    await git(repo, ["add", "--", ".orca"]);
    await git(repo, [...ORCA_IDENTITY, "commit", "-q", "-m", "checkpoint"]);
    await expect(resume({ repo })).rejects.toMatchObject({ code: "measurement-gated" });
    expect(existsSync(join(outside, "ran"))).toBe(false);
  });
});

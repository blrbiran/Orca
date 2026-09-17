import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { writeCheckpoint } from "../../src/checkpoint/write.js";
import { git } from "../../src/scheduler/gitExec.js";
import { runCli } from "../helpers/runCli.js";
import { NOW, checkpointSession, writeTranscript } from "../helpers/session.js";
import { SESSION } from "../helpers/transcript.js";

const FILE = ".orca/checkpoints/orca-dev-0a1b2c3d.json";
const head = async (repo: string): Promise<string> => (await git(repo, ["rev-parse", "HEAD"])).trim();
const write = (s: { repo: string; transcriptPath: string; draftPath: string }) =>
  writeCheckpoint({ repo: s.repo, sessionRef: SESSION, transcriptPath: s.transcriptPath, draftPath: s.draftPath, now: NOW });

describe("writeCheckpoint (D spec 5 step 2, 9 item 1)", () => {
  it("writes what the code measured and commits exactly that one file", async () => {
    const s = await checkpointSession(400_000, { next: ["finish task 6"], measure: ["true", "exit 3"] });
    const before = await head(s.repo);
    const result = await write(s);
    const stored = JSON.parse(await readFile(join(s.repo, FILE), "utf8"));
    expect(result.path).toBe(join(s.repo, FILE));
    expect(stored.head).toBe(before);
    expect(stored.level).toEqual({ kind: "reading", level: 400_001, windowTokens: 1_000_000, t1: 330_000, t2: 450_000, band: 1 });
    expect(stored.measurements.map((m: { command: string; exitCode: number; commit: string }) => [m.command, m.exitCode, m.commit])).toEqual([
      ["true", 0, before],
      ["exit 3", 3, before],
    ]);
    expect(stored.next).toEqual(["finish task 6"]);
    expect((await git(s.repo, ["show", "--name-only", "--format=", "HEAD"])).trim()).toBe(FILE);
    expect(result.commit).toBe(await head(s.repo));
    expect(await git(s.repo, ["status", "--porcelain"])).toBe("");

    // E5-3: checkpoint-commit-refused / exit 5 — the temp repo's own .git/hooks/pre-commit refuses the
    // commit. The temp repo resolves core.hooksPath to the default .git/hooks (no global hooksPath is
    // configured on this machine, confirmed by probing a throwaway `git init` before writing this test),
    // so installing the hook there is effective for this repo only. The file is left written, not committed
    // — the same residue `orca correct`'s exit 5 leaves (schema.ts CheckpointRejection default exitCode 1,
    // this path passes 5 explicitly).
    const refused = await checkpointSession(400_000, { next: ["n"] });
    await writeFile(join(refused.repo, ".git", "hooks", "pre-commit"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    await expect(write(refused)).rejects.toMatchObject({ code: "checkpoint-commit-refused", exitCode: 5 });
    expect(existsSync(join(refused.repo, FILE))).toBe(true);
    expect(await git(refused.repo, ["status", "--porcelain"])).not.toBe("");
  });

  it("keeps each measurement's whole output where the checkpoint says", async () => {
    const s = await checkpointSession(1, { next: ["n"], measure: ["echo measured-output; echo to-stderr 1>&2"] });
    await write(s);
    const stored = JSON.parse(await readFile(join(s.repo, FILE), "utf8"));
    expect(await readFile(stored.measurements[0].outputPath, "utf8")).toBe("measured-output\nto-stderr\n");
  });

  it("refuses a dirty worktree and writes nothing", async () => {
    const s = await checkpointSession(400_000, { next: ["n"] });
    await writeFile(join(s.repo, "stray.txt"), "x");
    const before = await head(s.repo);
    await expect(write(s)).rejects.toMatchObject({ code: "dirty-worktree" });
    expect(existsSync(join(s.repo, ".orca"))).toBe(false);
    expect(await head(s.repo)).toBe(before);
  });

  it("refuses a measurement that dirties the worktree and writes nothing", async () => {
    const s = await checkpointSession(400_000, { next: ["n"], measure: ["touch made-by-measurement.txt"] });
    const before = await head(s.repo);
    await expect(write(s)).rejects.toMatchObject({ code: "measurement-dirtied-worktree" });
    expect(existsSync(join(s.repo, FILE))).toBe(false);
    expect(await head(s.repo)).toBe(before);

    // E5-3: head-moved — a measurement that commits leaves the worktree clean (so
    // measurement-dirtied-worktree does not fire) but moves HEAD out from under the reading just taken.
    const moved = await checkpointSession(400_000, {
      next: ["n"],
      measure: ["git -c user.name=x -c user.email=y commit -q --allow-empty -m x"],
    });
    const beforeMoved = await head(moved.repo);
    await expect(write(moved)).rejects.toMatchObject({ code: "head-moved" });
    expect(existsSync(join(moved.repo, FILE))).toBe(false);
    expect(await head(moved.repo)).not.toBe(beforeMoved);
  });

  it("refuses a draft with nothing to do next, by name", async () => {
    const s = await checkpointSession(400_000, { next: [] });
    await expect(write(s)).rejects.toMatchObject({ code: "draft-invalid" });

    // E5-3: session-ref-unusable — checked before the draft even, so it fires here regardless of the
    // (also invalid) draft above; "session-x" has no eight-hex-digit prefix to name a run.
    await expect(
      writeCheckpoint({ repo: s.repo, sessionRef: "session-x", transcriptPath: s.transcriptPath, draftPath: s.draftPath, now: NOW }),
    ).rejects.toMatchObject({ code: "session-ref-unusable" });
  });

  it("still writes when there is no reading, and says why", async () => {
    const s = await checkpointSession(1, { next: ["n"] });
    await writeCheckpoint({ repo: s.repo, sessionRef: SESSION, transcriptPath: "/nonexistent/t.jsonl", draftPath: s.draftPath, now: NOW });
    const stored = JSON.parse(await readFile(join(s.repo, FILE), "utf8"));
    expect(stored.level.kind).toBe("no-reading");
    expect(stored.level.reason).toContain("/nonexistent/t.jsonl");
  });

  it("a later write in the same session replaces the file in a new commit, at the new band", async () => {
    const s = await checkpointSession(400_000, { next: ["n"] });
    await write(s);
    // E5-1: leave an uncommitted checkpoint file in the checkpoint dir before the second write — the
    // residue a refused commit (exit 5) leaves. The dirty-worktree filter must still let this second
    // write through, or a session that hit exit 5 once could never retry.
    await writeFile(join(s.repo, FILE), "not committed\n");
    await writeTranscript(s.transcriptPath, 460_000);
    await write(s);
    const stored = JSON.parse(await readFile(join(s.repo, FILE), "utf8"));
    expect(stored.level.band).toBe(2);
    expect((await git(s.repo, ["log", "--format=%H", "--", ".orca/checkpoints"])).trim().split("\n")).toHaveLength(2);
  });

  it("through the real process: prints where it wrote and exits 0; a rejection exits 1 by name", async () => {
    const s = await checkpointSession(400_000, { next: ["n"] });
    const args = ["checkpoint", "write", "--repo", s.repo, "--session", SESSION, "--transcript", s.transcriptPath, "--draft", s.draftPath];
    const ok = await runCli(args);
    expect(ok.code).toBe(0);
    expect(ok.stdout.startsWith(`wrote ${join(s.repo, FILE)}\n`)).toBe(true);
    await writeFile(join(s.repo, "stray.txt"), "x");
    const refused = await runCli(args);
    expect(refused.code).toBe(1);
    expect(refused.stderr.startsWith("rejected: dirty-worktree: ")).toBe(true);
  });

  it("refuses a measurement the Tier 0 gate blocks without running it, after running the ones before it (Tier 0 gate spec 6.4)", async () => {
    const outside = await mkdtemp(join(tmpdir(), "orca-gated-"));
    const s = await checkpointSession(400_000, { next: ["n"], measure: [`touch ${outside}/first`, `git push origin main; touch ${outside}/ran`] });
    const before = await head(s.repo);
    await expect(write(s)).rejects.toMatchObject({ code: "measurement-gated" });
    expect(existsSync(join(outside, "first"))).toBe(true);
    expect(existsSync(join(outside, "ran"))).toBe(false);
    expect(existsSync(join(s.repo, FILE))).toBe(false);
    expect(await head(s.repo)).toBe(before);
  });
});

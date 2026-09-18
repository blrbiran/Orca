import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { exitCheckpointAtHead } from "../../src/checkpoint/covering.js";
import { ORCA_IDENTITY, git } from "../../src/scheduler/gitExec.js";
import { checkpointFixture, putCheckpoint } from "../helpers/checkpoint.js";
import { tempRepo } from "../helpers/tempRepo.js";
import { SESSION } from "../helpers/transcript.js";

const REL = ".orca/checkpoints/orca-dev-0a1b2c3d.json";
async function commitCheckpoint(repo: string, value: unknown): Promise<void> {
  await putCheckpoint(repo, "orca-dev-0a1b2c3d.json", value);
  await git(repo, ["add", "--", REL]);
  await git(repo, [...ORCA_IDENTITY, "commit", "-q", "-m", "checkpoint"]);
}

describe("exitCheckpointAtHead (D-launch spec §3.2, §3.5)", () => {
  it("X1 finds this session's checkpoint with a chain mark at HEAD", async () => {
    const repo = await tempRepo();
    await commitCheckpoint(repo, checkpointFixture({ chain: { status: "continue", why: "more" } }));
    const found = await exitCheckpointAtHead(repo, SESSION);
    expect(found.kind).toBe("found");
    expect(found.kind === "found" && [found.relPath, found.checkpoint.chain]).toEqual([REL, { status: "continue", why: "more" }]);
  });

  it("X2 a file only in the worktree is not at HEAD", async () => {
    const repo = await tempRepo();
    await putCheckpoint(repo, "orca-dev-0a1b2c3d.json", checkpointFixture({ chain: { status: "done", why: "w" } }));
    expect(await exitCheckpointAtHead(repo, SESSION)).toEqual({ kind: "absent", reason: `HEAD has no ${REL}` });
  });

  it("X3 a mid-session checkpoint (no chain) is not an exit checkpoint (review I9)", async () => {
    const repo = await tempRepo();
    await commitCheckpoint(repo, checkpointFixture());
    expect(await exitCheckpointAtHead(repo, SESSION)).toEqual({ kind: "absent", reason: `${REL} at HEAD has no chain field` });
  });

  it("X4 a file under this run id that names another session is not this session's", async () => {
    const repo = await tempRepo();
    const other = "0a1b2c3d-ffff-4000-8000-000000000000";
    await commitCheckpoint(repo, checkpointFixture({ sessionRef: other, chain: { status: "done", why: "w" } }));
    expect(await exitCheckpointAtHead(repo, SESSION)).toEqual({ kind: "absent", reason: `${REL} at HEAD belongs to session ${other}` });
  });

  it("X5 a file that is not JSON is absent with the reason", async () => {
    const repo = await tempRepo();
    await commitCheckpoint(repo, "{");
    const found = await exitCheckpointAtHead(repo, SESSION);
    expect(found.kind).toBe("absent");
    expect(found.kind === "absent" && found.reason.startsWith(`${REL} at HEAD is not JSON: `)).toBe(true);
  });

  it("X6 outside a git repository it is absent, never a throw", async () => {
    const dir = await mkdtemp(join(tmpdir(), "orca-not-a-repo-"));
    expect(await exitCheckpointAtHead(dir, SESSION)).toEqual({ kind: "absent", reason: `HEAD has no ${REL}` });
  });
});

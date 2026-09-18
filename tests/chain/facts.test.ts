import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { currentBranch, guardedChanges, headOf, isAncestor, progressCommits, worktreeClean } from "../../src/chain/facts.js";
import { ORCA_IDENTITY, git } from "../../src/scheduler/gitExec.js";
import { commitFile, tempRepo } from "../helpers/tempRepo.js";

const SID = "0a1b2c3d-0000-4000-8000-000000000000";
const commitAll = async (repo: string, message: string) => {
  await git(repo, ["add", "-A"]);
  await git(repo, [...ORCA_IDENTITY, "commit", "-q", "-m", message]);
};
async function guardedRepo(): Promise<{ repo: string; start: string }> {
  const repo = await tempRepo();
  await writeFile(join(repo, ".gitignore"), ".claude/settings.local.json\n");
  await mkdir(join(repo, ".claude"));
  await writeFile(join(repo, ".claude", "settings.json"), "{}\n");
  await mkdir(join(repo, "scripts"));
  await writeFile(join(repo, "scripts", "gate-prefilter.mjs"), "\n");
  await mkdir(join(repo, ".orca", "checkpoints"), { recursive: true });
  await writeFile(join(repo, ".orca", "chain.json"), "{}\n");
  await commitAll(repo, "guarded fixture");
  return { repo, start: await headOf(repo) };
}
const put = async (repo: string, rel: string, content = "x\n") => {
  await mkdir(join(repo, rel, ".."), { recursive: true });
  await writeFile(join(repo, rel), content);
};

describe("guardedChanges (D-launch spec §4.1, §8.2-11)", () => {
  it.each([
    ["G1 src/gate committed", async (r: string) => { await put(r, "src/gate/x.ts"); await commitAll(r, "g"); }, ["src/gate/x.ts"]],
    ["G2 .claude/settings.json edited, not committed", async (r: string) => put(r, ".claude/settings.json", "{\"a\":1}\n"), [".claude/settings.json"]],
    ["G3 scripts/gate-prefilter.mjs committed", async (r: string) => { await put(r, "scripts/gate-prefilter.mjs", "y\n"); await commitAll(r, "g"); }, ["scripts/gate-prefilter.mjs"]],
    ["G4 .orca/level.json created, untracked", async (r: string) => put(r, ".orca/level.json", "{}\n"), [".orca/level.json"]],
    ["G5 .orca/chain.json edited and committed", async (r: string) => { await put(r, ".orca/chain.json", "{\"model\":\"m\"}\n"); await commitAll(r, "g"); }, [".orca/chain.json"]],
    ["G6 another chain's record created, untracked", async (r: string) => put(r, ".orca/chains/chain-0000000f.json"), [".orca/chains/chain-0000000f.json"]],
    ["G7 another session's checkpoint committed", async (r: string) => { await put(r, ".orca/checkpoints/orca-dev-99999999.json"); await commitAll(r, "g"); }, [".orca/checkpoints/orca-dev-99999999.json"]],
    ["G8 .claude/settings.local.json exists (ignored, so git status never shows it)", async (r: string) => put(r, ".claude/settings.local.json", "{\"disableAllHooks\":true}\n"), [".claude/settings.local.json"]],
    ["G9 this session's own checkpoint committed twice (must not catch)", async (r: string) => {
      await put(r, ".orca/checkpoints/orca-dev-0a1b2c3d.json", "1\n"); await commitAll(r, "c1");
      await put(r, ".orca/checkpoints/orca-dev-0a1b2c3d.json", "2\n"); await commitAll(r, "c2");
    }, []],
    ["G10 an unrelated file committed (must not catch)", async (r: string) => { await put(r, "docs/a.md"); await commitAll(r, "g"); }, []],
  ] as const)("%s", async (_name, act, expected) => {
    const { repo, start } = await guardedRepo();
    await act(repo);
    expect(await guardedChanges(repo, start, SID)).toEqual(expected);
  });
});

describe("progressCommits (spec §4.1: commits touching something outside .orca/checkpoints/)", () => {
  it.each([
    ["N1 a commit touching only .orca/checkpoints is not progress", async (r: string) => { await put(r, ".orca/checkpoints/orca-dev-0a1b2c3d.json"); await commitAll(r, "c"); }, 0],
    ["N2 an empty commit is not progress", async (r: string) => { await git(r, [...ORCA_IDENTITY, "commit", "-q", "--allow-empty", "-m", "e"]); }, 0],
    ["N3 a commit outside .orca/checkpoints is progress", async (r: string) => { await put(r, "a.txt"); await commitAll(r, "a"); }, 1],
    ["N4 a commit touching both is progress", async (r: string) => { await put(r, "b.txt"); await put(r, ".orca/checkpoints/orca-dev-0a1b2c3d.json"); await commitAll(r, "b"); }, 1],
  ] as const)("%s", async (_name, act, expected) => {
    const { repo, start } = await guardedRepo();
    await act(repo);
    expect(await progressCommits(repo, start)).toBe(expected);
  });
});

describe("worktree, branch and ancestry", () => {
  it("F1 worktreeClean sees an untracked file", async () => {
    const repo = await tempRepo();
    expect(await worktreeClean(repo)).toBe(true);
    await writeFile(join(repo, "u.txt"), "u\n");
    expect(await worktreeClean(repo)).toBe(false);
  });
  it("F2 currentBranch is null when detached", async () => {
    const repo = await tempRepo();
    expect(await currentBranch(repo)).toBe("main");
    await git(repo, ["checkout", "-q", "--detach"]);
    expect(await currentBranch(repo)).toBeNull();
  });
  it("F3 isAncestor turns false after the start commit is amended", async () => {
    const repo = await tempRepo();
    await commitFile(repo, "a.txt", "a\n", "a");
    const start = await headOf(repo);
    await commitFile(repo, "b.txt", "b\n", "b");
    expect(await isAncestor(repo, start)).toBe(true);
    await git(repo, ["reset", "-q", "--soft", "HEAD~1"]);
    await git(repo, [...ORCA_IDENTITY, "commit", "-q", "--amend", "-m", "rewritten"]);
    expect(await isAncestor(repo, start)).toBe(false);
  });
});

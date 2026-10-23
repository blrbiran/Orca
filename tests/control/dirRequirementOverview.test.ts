/**
 * Dir-requirements spec §6.1-§6.2, criterion D2 (plan Task 2): a clarify call of a requirement on a `dir` project reads
 * the folder through its vault. The real driver step (A2 → the fake single-call port → Ce) takes round 1 to
 * awaiting-answers on a folder that is not a git repository; the overview's commit is an import of the folder
 * (`refs/orca/import/<n>`) without the folder's `.decisions/`; a second call on the unchanged folder names the same
 * import; a folder that is itself a git repository keeps its `.git` byte for byte and its HEAD is never the overview's.
 */
import { execFileSync } from "node:child_process";
import { existsSync, renameSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readRequirementGroup } from "../../src/control/requirementRecords.js";
import { vaultPathOfRepoId } from "../../src/flow/groups.js";
import { digestTree, dirRequirementHarness } from "./fixtures/dirRequirement.js";
import { ROUND_ONE } from "./fixtures/requirementOutputs.js";

const FILES = { "README.md": "# Notes\nA note-taking tool.\n", "src/a.ts": "export const a = 1;\n", ".decisions/x.jsonl": "{\"ev\":\"decision\"}\n" };
const bad = { ...ROUND_ONE, questions: [], frontierEmpty: false };

describe("a clarify call on a dir project reads an import of the folder (D2)", () => {
  it("reaches awaiting-answers on a non-git folder; both calls name one import commit without .decisions/", async () => {
    const x = await dirRequirementHarness({ answers: [{ purpose: "clarify", output: bad }, { purpose: "clarify", output: ROUND_ONE }], files: FILES });
    try {
      expect(await x.open()).toMatchObject({ result: { kind: "requirement-opened", groupId: "r" } });
      await x.until(() => x.round(1).state !== "drafting");
      expect(x.runs().map((run) => run.drive?.blockedReason ?? null)).toEqual([null, null]);
      expect(x.round(1).state).toBe("awaiting-answers");
      const calls = x.round(1).calls;
      expect(calls.map((call) => call.outcome)).toEqual(["invalid", "valid"]);
      const commit = calls[0]!.commit!;
      expect(calls[1]!.commit).toBe(commit);
      const vault = vaultPathOfRepoId(x.env, `flow-vault-${(x.body().dirWorkspace as { vaultId: string }).vaultId}`)!;
      const imports = x.vaultGit(vault, ["for-each-ref", "--format=%(objectname)", "refs/orca/import/"]).split("\n");
      expect(imports).toEqual([commit]);
      expect(x.vaultGit(vault, ["ls-tree", "-r", "--name-only", commit]).split("\n")).toEqual(["README.md", "src/a.ts"]);
      // The prompt was built from the import: the folder's README is in it.
      const sent = x.fake.calls.accept[0]!;
      expect(sent.work.kind === "single-call" && sent.work.prompt).toContain("A note-taking tool.");
      expect(readRequirementGroup(x.store, "r").requirement.repoId).toBe("repo");
    } finally { await x.dispose(); }
  });

  it("a folder moved away after open blocks the call as dir-folder-missing (named, with the folder), not repository-path", async () => {
    const x = await dirRequirementHarness({ answers: [{ purpose: "clarify", output: ROUND_ONE }], files: FILES });
    try {
      await x.open();
      renameSync(x.folder, `${x.folder}-moved`);
      await x.until(() => x.runs()[0]?.state === "blocked");
      expect(x.runs()[0]!.drive.blockedReason).toMatch(new RegExp(`^dir-folder-missing:${x.folder}: `));
      expect(x.fake.calls.accept).toHaveLength(0);
    } finally { await x.dispose(); }
  });

  it("a driver given no environment blocks the call (repository-path) and creates no vault anywhere", async () => {
    const x = await dirRequirementHarness({ answers: [{ purpose: "clarify", output: ROUND_ONE }], files: FILES });
    try {
      x.deps.env = undefined;
      await x.open();
      await x.until(() => x.runs()[0]?.state === "blocked");
      expect(x.runs()[0]!.drive.blockedReason).toBe("repository-path");
      expect(existsSync(x.env.ORCA_VAULT_DIR!)).toBe(false);
      expect(existsSync(join(x.env.HOME!, ".orca"))).toBe(false);
    } finally { await x.dispose(); }
  });

  it("a folder that is a git repository: its .git is byte-equal afterwards and its HEAD is not the overview's commit", async () => {
    const x = await dirRequirementHarness({ answers: [{ purpose: "clarify", output: ROUND_ONE }], files: FILES });
    try {
      const g = (...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.hooksPath=/dev/null", ...args], { cwd: x.folder, encoding: "utf8" }).trim();
      g("init", "-q", "-b", "main"); g("add", "-A"); g("commit", "-qm", "the person's own history");
      const head = g("rev-parse", "HEAD"), before = digestTree(join(x.folder, ".git"));
      await x.open();
      await x.until(() => x.round(1).state !== "drafting");
      expect(x.round(1).state).toBe("awaiting-answers");
      const commit = x.round(1).calls[0]!.commit;
      expect(commit).not.toBe(head);
      expect(commit).toMatch(/^[0-9a-f]{40}$/);
      expect(digestTree(join(x.folder, ".git"))).toBe(before);
      expect(g("rev-parse", "HEAD")).toBe(head);
    } finally { await x.dispose(); }
  });
});

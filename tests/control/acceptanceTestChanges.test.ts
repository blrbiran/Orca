import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { existingTestChanges } from "../../src/control/acceptanceTestChanges.js";

const roots: string[] = [];
const git = (cwd: string, ...args: string[]): string => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.hooksPath=/dev/null", ...args], { cwd, encoding: "utf8" }).trim();
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

async function repository(baseFiles: Record<string, string>): Promise<{ root: string; base: string; tip(changes: Record<string, string | null>): Promise<string> }> {
  const root = await mkdtemp(join(tmpdir(), "orca-test-change-diff-"));
  roots.push(root);
  git(root, "init", "-q", "-b", "main");
  for (const [path, text] of Object.entries(baseFiles)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
  git(root, "add", "-A");
  git(root, "commit", "-qm", "base");
  const base = git(root, "rev-parse", "HEAD");
  return {
    root, base,
    async tip(changes) {
      for (const [path, text] of Object.entries(changes)) {
        if (text === null) git(root, "rm", "-q", path);
        else { await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), text); }
      }
      git(root, "add", "-A");
      git(root, "commit", "-qm", "tip", "--allow-empty");
      return git(root, "rev-parse", "HEAD");
    },
  };
}

const TEST = "import { expect, it } from 'vitest';\nit('one', () => { expect(1).toBe(1); });\n";

describe("existing acceptance test changes", () => {
  it("requires disposition for any changed or deleted test that existed at the base", async () => {
    const repo = await repository({ "tests/a.test.ts": TEST });
    const edited = await repo.tip({ "tests/a.test.ts": `${TEST}it('two', () => { expect(2).toBe(2); });\n` });
    const deletedRepo = await repository({ "tests/a.test.ts": TEST });
    const deleted = await deletedRepo.tip({ "tests/a.test.ts": null });

    expect(await existingTestChanges(repo.root, repo.base, edited)).toMatchObject({ paths: ["tests/a.test.ts"], weakeningSignals: [] });
    expect(await existingTestChanges(deletedRepo.root, deletedRepo.base, deleted)).toMatchObject({ paths: ["tests/a.test.ts"], weakeningSignals: ["deleted:tests/a.test.ts"] });
  });

  it("does not gate a new test unless it adds a focus, skip, or todo signal", async () => {
    const repo = await repository({ "src/add.ts": "export const add = (a: number, b: number) => a + b;\n" });
    const additive = await repo.tip({ "tests/new.test.ts": "it('new', () => { expect(1).toBe(1); });\n" });
    expect(await existingTestChanges(repo.root, repo.base, additive)).toMatchObject({ paths: [], weakeningSignals: [] });

    const focusedRepo = await repository({ "src/add.ts": "export const add = (a: number, b: number) => a + b;\n" });
    const focused = await focusedRepo.tip({ "tests/new.test.ts": "it.only('new', () => { expect(1).toBe(1); });\n" });
    expect(await existingTestChanges(focusedRepo.root, focusedRepo.base, focused)).toMatchObject({ paths: ["tests/new.test.ts"], weakeningSignals: ["skip-added:tests/new.test.ts"] });

    // node:test's option form is a skip too; it must not slip in as an additive new test.
    const optionRepo = await repository({ "src/add.ts": "export const add = (a: number, b: number) => a + b;\n" });
    const option = await optionRepo.tip({ "tests/new.test.ts": "import { test } from 'node:test';\ntest('new', { skip: true }, () => {});\n" });
    expect(await existingTestChanges(optionRepo.root, optionRepo.base, option)).toMatchObject({ paths: ["tests/new.test.ts"], weakeningSignals: ["skip-added:tests/new.test.ts"] });
  });

  it("detects a removed test declaration even when the assertion count is unchanged", async () => {
    const before = "it('one', () => { expect(1).toBe(1); });\nit('two', () => { expect(2).toBe(2); });\n";
    const after = "it('one', () => { expect(1).toBe(1); });\nexpect(2).toBe(2);\n";
    const repo = await repository({ "tests/a.test.ts": before });
    const tip = await repo.tip({ "tests/a.test.ts": after });
    expect(await existingTestChanges(repo.root, repo.base, tip)).toMatchObject({
      paths: ["tests/a.test.ts"], weakeningSignals: ["test-declaration-removed:tests/a.test.ts:2->1"],
    });
  });

  it("sorts affected paths before hashing them and binds the digest to the checked tip", async () => {
    const repo = await repository({ "tests/a.test.ts": TEST, "tests/b.test.ts": TEST });
    const tip = await repo.tip({ "tests/b.test.ts": `${TEST}it('two', () => { expect(2).toBe(2); });\n`, "tests/a.test.ts": `${TEST}it('two', () => { expect(2).toBe(2); });\n` });
    const changes = await existingTestChanges(repo.root, repo.base, tip);
    expect(changes.paths).toEqual(["tests/a.test.ts", "tests/b.test.ts"]);
    expect(changes.digest).toMatch(/^[a-f0-9]{64}$/);
  });
});

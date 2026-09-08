import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { deriveCorrectionId } from "../../src/corrections/fields.js";
import { correctionsFile } from "../../src/corrections/paths.js";
import { readCorrections } from "../../src/corrections/store.js";
import {
  captureStreams,
  closeArgs,
  git,
  makeTargetRepo,
  runCli,
  withCorrectionsDir,
} from "./harness.js";
import type { TargetRepo } from "./harness.js";

async function ledgerFiles(decisionsDir: string): Promise<string[]> {
  return (await readdir(decisionsDir).catch(() => [] as string[]))
    .filter((n) => n.endsWith(".jsonl"))
    .sort();
}

async function readFixFile(decisionsDir: string, added: string[]): Promise<unknown[]> {
  const fix = added.find((f) => f.startsWith("orca-fix-"));
  if (fix === undefined) throw new Error(`no orca-fix-*.jsonl among ${JSON.stringify(added)}`);
  const text = await readFile(join(decisionsDir, fix), "utf8");
  return text
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
}

// A handful of criteria need to override --decision or --undo-how, which
// closeArgs's base already sets — appending a second value for the same flag
// via closeArgs's `overrides` array would hit args.ts's own
// "given more than once" guard instead of exercising what the criterion wants
// to test. These two small local variants exist only for that reason.
const closeArgsForDecision = (repo: string, decisionId: string): string[] => [
  "correct", "--repo", repo, "--by", "amy",
  "--decision", decisionId, "--kind", "not_my_taste", "--because", "进程内互斥跨进程无效",
  "--chose-instead", "改用文件租约",
  "--undo-how", "删掉 src/scheduler/pool.ts 里的那处互斥",
];

const closeArgsForUndoHow = (repo: string, undoHow: string): string[] => [
  "correct", "--repo", repo, "--by", "amy",
  "--decision", "orca-dev-1/1", "--kind", "not_my_taste", "--because", "进程内互斥跨进程无效",
  "--chose-instead", "改用文件租约",
  "--undo-how", undoHow,
];

// --- Step 0 fixtures (see task-9-report.md for the full measured table).
// Every one of these touches ONLY README.md, never `.decisions/`, so the
// seeded original decision stays readable regardless of which of these
// states the guard is meant to catch.

async function conflictOnReadme(target: TargetRepo): Promise<{ branch: string }> {
  const branch = (await git(target.path, ["symbolic-ref", "--short", "HEAD"])).trim();
  await git(target.path, ["checkout", "-b", "feature"]);
  await writeFile(join(target.path, "README.md"), "feature change\n");
  await git(target.path, ["add", "-A"]);
  await git(target.path, ["commit", "-m", "feature change"]);
  await git(target.path, ["checkout", branch]);
  await writeFile(join(target.path, "README.md"), "main change\n");
  await git(target.path, ["add", "-A"]);
  await git(target.path, ["commit", "-m", "main change"]);
  return { branch };
}

/** MERGE_HEAD present, conflict resolved via `git add`, NOT committed. Measured: git refuses a partial commit. */
async function withMergeInProgress(target: TargetRepo): Promise<void> {
  await conflictOnReadme(target);
  await git(target.path, ["merge", "feature"]).catch(() => undefined);
  await writeFile(join(target.path, "README.md"), "resolved\n");
  await git(target.path, ["add", "README.md"]);
}

/** CHERRY_PICK_HEAD present, conflict resolved via `git add`, NOT `--continue`d. Measured: git refuses a partial commit. */
async function withCherryPickInProgress(target: TargetRepo): Promise<void> {
  await conflictOnReadme(target);
  await git(target.path, ["cherry-pick", "feature"]).catch(() => undefined);
  await writeFile(join(target.path, "README.md"), "resolved\n");
  await git(target.path, ["add", "README.md"]);
}

/** A bare detached HEAD, nothing else in progress. Measured: git does NOT refuse a partial commit here. */
async function withDetachedHead(target: TargetRepo): Promise<void> {
  const head = (await git(target.path, ["rev-parse", "HEAD"])).trim();
  await git(target.path, ["checkout", "--detach", head]);
}

/**
 * REVERT_HEAD present (a clean, non-conflicting `revert -n`), HEAD still
 * attached. Measured: git does NOT refuse a partial commit here — the
 * negative control the ruling asked for. Reverts a throwaway commit that
 * only touches README.md, so `.decisions/` (and the seeded original
 * decision inside it) stays untouched.
 */
async function withRevertInProgress(target: TargetRepo): Promise<void> {
  await writeFile(join(target.path, "README.md"), "throwaway change to revert\n");
  await git(target.path, ["add", "-A"]);
  await git(target.path, ["commit", "-m", "throwaway change"]);
  await git(target.path, ["revert", "-n", "HEAD"]);
}

describe("orca correct --close / closing new — guards, lock, order, single write (§14.3 闭-1…闭-8)", () => {
  it("closes the loop end to end: one new orca-fix-*.jsonl, a decision then an overturned row", async () => {
    const target = await makeTargetRepo();
    try {
      await withCorrectionsDir(async () => {
        const before = await ledgerFiles(target.decisionsDir);
        const { result: rc } = await captureStreams(() => runCli(closeArgs(target.path)));
        expect(rc).toBe(0);

        const after = await ledgerFiles(target.decisionsDir);
        const added = after.filter((f) => !before.includes(f));
        expect(added).toHaveLength(1);
        expect(added[0]).toMatch(/^orca-fix-.*\.jsonl$/);

        const lines = await readFixFile(target.decisionsDir, added);
        expect(lines).toHaveLength(2);
        expect((lines[0] as { ev: unknown }).ev).toBe("decision");
        expect((lines[1] as { ev: unknown }).ev).toBe("overturned");
        expect((lines[1] as { replacedBy: unknown }).replacedBy).toBe((lines[0] as { id: unknown }).id);
        expect((lines[1] as { id: unknown }).id).toBe("orca-dev-1/1");
      });
    } finally {
      await target.cleanup();
    }
  });

  it("E16: both ledger rows carry a fresh `at`, bracketed by the call, distinct from the correction's own `at`", async () => {
    const target = await makeTargetRepo();
    try {
      await withCorrectionsDir(async (dir) => {
        const before = new Date().toISOString();
        const { result: rc } = await captureStreams(() => runCli(closeArgs(target.path)));
        const after = new Date().toISOString();
        expect(rc).toBe(0);

        const rows = await readCorrections(dir);
        expect(rows).toHaveLength(1);
        const correctionAt = rows[0].at;

        const files = await ledgerFiles(target.decisionsDir);
        const lines = await readFixFile(target.decisionsDir, files);
        for (const line of lines) {
          const at = (line as { at: string }).at;
          expect(at >= before && at <= after).toBe(true);
          expect(at).not.toBe(correctionAt);
        }
      });
    } finally {
      await target.cleanup();
    }
  });

  it("E21: --undo-cost overrides the inherited cost; without it, the cost names what it inherited from", async () => {
    const target = await makeTargetRepo();
    try {
      await withCorrectionsDir(async () => {
        const withCost = await captureStreams(() =>
          runCli(closeArgs(target.path, ["--undo-cost", "改一个文件"])),
        );
        expect(withCost.result).toBe(0);
        const filesA = await ledgerFiles(target.decisionsDir);
        const linesA = await readFixFile(target.decisionsDir, filesA);
        const decisionA = linesA.find((l) => (l as { ev: unknown }).ev === "decision") as { undo: { cost: string } };
        expect(decisionA.undo.cost).toBe("改一个文件");
        expect(decisionA.undo.cost).not.toContain("继承自");

        const filesBefore = filesA;
        const withoutCost = await captureStreams(() => runCli(closeArgs(target.path, ["--again"])));
        expect(withoutCost.result).toBe(0);
        const filesB = await ledgerFiles(target.decisionsDir);
        const addedB = filesB.filter((f) => !filesBefore.includes(f));
        const linesB = await readFixFile(target.decisionsDir, addedB);
        const decisionB = linesB.find((l) => (l as { ev: unknown }).ev === "decision") as { undo: { cost: string } };
        expect(decisionB.undo.cost).toContain("继承自 orca-dev-1/1");
      });
    } finally {
      await target.cleanup();
    }
  });

  it("E11(a): a mistyped --decision is refused by name, not by the ledger's own unknown-reference wording", async () => {
    const target = await makeTargetRepo();
    try {
      await withCorrectionsDir(async () => {
        const { result: rc, stderr } = await captureStreams(() =>
          runCli(closeArgsForDecision(target.path, "orca-dev-1/99")),
        );
        expect(stderr).toContain("rejected: original-decision-not-found:");
        expect(stderr).not.toContain("references unknown decision id");
        expect(rc).toBe(1);
      });
    } finally {
      await target.cleanup();
    }
  });

  it("E11(b) (the ordering pin): a mistyped --decision leaves nothing written anywhere", async () => {
    const target = await makeTargetRepo();
    try {
      await withCorrectionsDir(async (dir) => {
        const before = await ledgerFiles(target.decisionsDir);
        const { result: rc } = await captureStreams(() =>
          runCli(closeArgsForDecision(target.path, "orca-dev-1/99")),
        );
        expect(rc).toBe(1);
        expect(existsSync(join(dir, "corrections.jsonl"))).toBe(false);
        expect(await ledgerFiles(target.decisionsDir)).toEqual(before);
      });
    } finally {
      await target.cleanup();
    }
  });

  it("E8b: refuses while another process holds the repo lock, before the store is ever read", async () => {
    const target = await makeTargetRepo();
    try {
      await mkdir(join(target.path, ".git", "orca-lock"), { recursive: true });
      await withCorrectionsDir(async (dir) => {
        const before = await ledgerFiles(target.decisionsDir);
        const { result: rc, stderr } = await captureStreams(() => runCli(closeArgs(target.path)));
        expect(stderr).toContain("rejected: repo-locked:");
        expect(rc).toBe(4);
        expect(existsSync(join(dir, "corrections.jsonl"))).toBe(false);
        expect(await ledgerFiles(target.decisionsDir)).toEqual(before);
      });
    } finally {
      await target.cleanup();
    }
  });

  it("E19: an expected rejection AFTER the lock is taken still releases it", async () => {
    const target = await makeTargetRepo();
    try {
      await withCorrectionsDir(async () => {
        const pre = await captureStreams(() =>
          runCli([
            "correct", "--repo", target.path, "--by", "amy",
            "--decision", "orca-dev-1/1", "--kind", "wrong", "--because", "早就不成立了",
          ]),
        );
        expect(pre.result).toBe(0);

        const { result: rc, stderr } = await captureStreams(() => runCli(closeArgs(target.path)));
        expect(stderr).toContain("rejected: correction-already-recorded:");
        expect(rc).toBe(1);
        // The load-bearing assertion: a rejected --close must not brick the
        // repo for every future `orca run`.
        expect(existsSync(join(target.path, ".git", "orca-lock"))).toBe(false);
      });
    } finally {
      await target.cleanup();
    }
  });

  it("guard: refuses while a merge is unresolved, naming it, before reading or writing anything", async () => {
    const target = await makeTargetRepo();
    try {
      await withMergeInProgress(target);
      await withCorrectionsDir(async (dir) => {
        const before = await ledgerFiles(target.decisionsDir);
        const { result: rc, stderr } = await captureStreams(() => runCli(closeArgs(target.path)));
        expect(stderr).toContain("rejected: target-mid-git-operation:");
        expect(stderr).toContain("a merge");
        expect(rc).toBe(1);
        expect(existsSync(join(dir, "corrections.jsonl"))).toBe(false);
        expect(await ledgerFiles(target.decisionsDir)).toEqual(before);
      });
    } finally {
      await target.cleanup();
    }
  });

  it("E15: refuses a cherry-pick whose conflict is resolved but not --continue'd, naming it", async () => {
    const target = await makeTargetRepo();
    try {
      await withCherryPickInProgress(target);
      await withCorrectionsDir(async (dir) => {
        const before = await ledgerFiles(target.decisionsDir);
        const { result: rc, stderr } = await captureStreams(() => runCli(closeArgs(target.path)));
        expect(stderr).toContain("rejected: target-mid-git-operation:");
        expect(stderr).toContain("cherry-pick");
        expect(rc).toBe(1);
        expect(existsSync(join(dir, "corrections.jsonl"))).toBe(false);
        expect(await ledgerFiles(target.decisionsDir)).toEqual(before);
      });
    } finally {
      await target.cleanup();
    }
  });

  it("guard: refuses a detached HEAD — not because git refuses the commit, but because it would be unreachable", async () => {
    const target = await makeTargetRepo();
    try {
      await withDetachedHead(target);
      await withCorrectionsDir(async (dir) => {
        const before = await ledgerFiles(target.decisionsDir);
        const { result: rc, stderr } = await captureStreams(() => runCli(closeArgs(target.path)));
        expect(stderr).toContain("rejected: target-mid-git-operation:");
        expect(stderr).toContain("detached HEAD");
        expect(rc).toBe(1);
        expect(existsSync(join(dir, "corrections.jsonl"))).toBe(false);
        expect(await ledgerFiles(target.decisionsDir)).toEqual(before);
      });
    } finally {
      await target.cleanup();
    }
  });

  // 🔴 Negative control (the ruling's addition, no equivalent in the original
  // brief): without this, a later "tighten the guard" change could reintroduce
  // over-rejection on REVERT_HEAD and every other criterion here would still
  // pass. Measured: a `revert -n` in progress does not block a partial commit
  // and leaves HEAD attached — so --close must succeed exactly as if nothing
  // were happening.
  it("negative control: a revert -n in progress does NOT block --close (over-rejection would silently regress here)", async () => {
    const target = await makeTargetRepo();
    try {
      await withRevertInProgress(target);
      await withCorrectionsDir(async () => {
        const before = await ledgerFiles(target.decisionsDir);
        const { result: rc, stderr } = await captureStreams(() => runCli(closeArgs(target.path)));
        expect(stderr).not.toContain("rejected:");
        expect(rc).toBe(0);
        const after = await ledgerFiles(target.decisionsDir);
        expect(after.filter((f) => !before.includes(f))).toHaveLength(1);
      });
    } finally {
      await target.cleanup();
    }
  });

  it("E4′ (fault injection): a non-executable --undo-how leaves the correction on disk but writes no ledger file", async () => {
    const target = await makeTargetRepo();
    try {
      await withCorrectionsDir(async (dir) => {
        const before = await ledgerFiles(target.decisionsDir);
        await expect(runCli(closeArgsForUndoHow(target.path, "改一下"))).rejects.toThrow();
        const rows = await readCorrections(dir);
        expect(rows).toHaveLength(1);
        expect(await ledgerFiles(target.decisionsDir)).toEqual(before);
      });
    } finally {
      await target.cleanup();
    }
  });

  it("E3b: --close without --chose-instead refuses by name when the stored row has none either", async () => {
    const target = await makeTargetRepo();
    try {
      await withCorrectionsDir(async (dir) => {
        const rec = await captureStreams(() =>
          runCli([
            "correct", "--repo", target.path, "--by", "amy",
            "--decision", "orca-dev-1/1", "--kind", "wrong", "--because", "已经不成立了",
          ]),
        );
        expect(rec.result).toBe(0);
        const rows = await readCorrections(dir);
        expect(rows).toHaveLength(1);
        const id = rows[0].id;

        const before = await ledgerFiles(target.decisionsDir);
        const { result: rc, stderr } = await captureStreams(() =>
          runCli([
            "correct", "--repo", target.path, "--by", "amy", "--close", id,
            "--undo-how", "删掉 src/scheduler/pool.ts 里的那处互斥",
          ]),
        );
        expect(stderr).toContain("rejected: no-chose-instead:");
        expect(stderr).toContain("--chose-instead");
        expect(rc).toBe(1);
        expect(await ledgerFiles(target.decisionsDir)).toEqual(before);
      });
    } finally {
      await target.cleanup();
    }
  });

  it("--close conflicts when the stored row already has chose_instead and --close supplies another one", async () => {
    const target = await makeTargetRepo();
    try {
      await withCorrectionsDir(async (dir) => {
        const rec = await captureStreams(() =>
          runCli([
            "correct", "--repo", target.path, "--by", "amy",
            "--decision", "orca-dev-1/1", "--kind", "not_my_taste", "--because", "进程内互斥跨进程无效",
            "--chose-instead", "改用文件租约", "--record-only",
          ]),
        );
        expect(rec.result).toBe(0);
        const rows = await readCorrections(dir);
        const id = rows[0].id;

        const { result: rc, stderr } = await captureStreams(() =>
          runCli([
            "correct", "--repo", target.path, "--by", "amy", "--close", id,
            "--chose-instead", "改用别的方案",
            "--undo-how", "删掉 src/scheduler/pool.ts 里的那处互斥",
          ]),
        );
        expect(stderr).toContain("rejected: close-argument-conflict:");
        expect(rc).toBe(1);
      });
    } finally {
      await target.cleanup();
    }
  });

  // 🔴 E6: the corrections file is written DIRECTLY, two rows differing only in
  // `by`, with byte-identical `at` — see the task's own ruling on this fixture.
  // The path under test is `--close`, whose input IS the stored row.
  it("E6: two people's byte-identical-but-for-`by` corrections close into two different files", async () => {
    const target = await makeTargetRepo();
    try {
      await withCorrectionsDir(async (dir) => {
        const shared = {
          projectKey: "github.com/biran/orca",
          decisionId: "orca-dev-1/1",
          kind: "not_my_taste" as const,
          chose_instead: "改用文件租约",
          because: "进程内互斥跨进程无效",
          at: "2026-09-01T12:00:00.000Z",
        };
        const rowAmy = { ...shared, by: "amy" };
        const rowBob = { ...shared, by: "bob" };
        const idAmy = deriveCorrectionId(rowAmy);
        const idBob = deriveCorrectionId(rowBob);
        const lineAmy = JSON.stringify({ id: idAmy, ...rowAmy });
        const lineBob = JSON.stringify({ id: idBob, ...rowBob });
        await writeFile(correctionsFile(dir), `${lineAmy}\n${lineBob}\n`);

        const closeAmy = await captureStreams(() =>
          runCli([
            "correct", "--repo", target.path, "--by", "amy", "--close", idAmy,
            "--undo-how", "删掉 src/scheduler/pool.ts 里的那处互斥",
          ]),
        );
        expect(closeAmy.result).toBe(0);

        const closeBob = await captureStreams(() =>
          runCli([
            "correct", "--repo", target.path, "--by", "bob", "--close", idBob,
            "--undo-how", "删掉 src/scheduler/pool.ts 里的那处互斥",
          ]),
        );
        expect(closeBob.result).toBe(0);

        const files = await ledgerFiles(target.decisionsDir);
        const fixFiles = files.filter((f) => f.startsWith("orca-fix-"));
        expect(fixFiles).toHaveLength(2);
        for (const f of fixFiles) {
          const lines = await readFixFile(target.decisionsDir, [f]);
          expect(lines.some((l) => (l as { ev: unknown }).ev === "overturned")).toBe(true);
        }
      });
    } finally {
      await target.cleanup();
    }
  });
});

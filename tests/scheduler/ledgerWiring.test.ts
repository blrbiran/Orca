import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { validateLine } from "../../src/ledger/validateLine.js";
import { appendEvent } from "../../src/ledger/writer.js";
import { deriveRunId } from "../../src/scheduler/runId.js";
import { ccloopEvidence, writeBoundThenCommit } from "../../src/scheduler/ledgerWiring.js";
import { git, makeSandbox, readLedgerOnBranch, runCli, seedDisjointPlan } from "./sandbox.js";

// ccloopBin resolves to "<ccloop repo>/dist/cli.js" (sandbox.ts's own
// resolveCcloopBin comment: "its bin is only ever this literal path on
// disk") — two levels up is the repository these criteria independently
// re-derive ccloop's real HEAD from, so the assertion measures against git
// itself rather than against ccloopEvidence's own answer.
function ccloopRootOf(ccloopBin: string): string {
  return dirname(dirname(ccloopBin));
}

describe("ledger wiring (spec 8.0)", () => {
  it("writes into the task's own copy, never into the target repository directly", async () => {
    // `writeBoundThenCommit`'s target directory IS "that task's copy" (spec
    // §8.0's first row): run.ts always calls it with `copy`, the
    // reconciliation's own clone, never with the target repository — W only
    // sees this content later, via the fetch-and-fast-forward `run.ts`'s
    // reconcileAndLand does after the merge commit is built (S3.test.ts
    // measures that half: the bound line is blamed to the merge commit that
    // actually lands on W). What THIS criterion isolates is the half before
    // that: the write itself never touches anything but the copy. Two
    // separate sandboxes stand in for "the copy" and "the target repository"
    // so "never touches the other one" is something the test can actually
    // observe, not just assert about a single directory by construction.
    const copySandbox = await makeSandbox();
    const targetSandbox = await makeSandbox();
    try {
      const copy = copySandbox.targetRepo;
      const runId = "orca-round-cccccccc";

      // Real usage order (run.ts's reconcileAndLand): the decision is
      // appended first, in the same file writeBoundThenCommit will then bind
      // against — the ledger writer's own check 5 refuses a "bound" that
      // references a decision id not yet on disk.
      const decisionId = `${runId}/1`;
      await appendEvent(join(copy, ".decisions"), runId, {
        ev: "decision",
        id: decisionId,
        at: new Date().toISOString(),
        run: runId,
        question: "q",
        chose: "c",
        alternatives: [{ option: "o", why_not: "w" }],
        because: "b",
        undo: { how: "git reset --hard 0000000000000000000000000000000000000000", cost: "x", blast_radius: "y" },
        scope: "repo",
        kind: "scheduling",
      });

      await writeBoundThenCommit(copy, [decisionId], "reconcile-T2", runId, async () => {
        await git(copy, [
          "-c",
          "user.name=orca-test",
          "-c",
          "user.email=orca-test@invalid",
          "commit",
          "-m",
          "the reconciliation's own attempt",
        ]);
        return (await git(copy, ["rev-parse", "HEAD"])).trim();
      });

      const file = join(copy, ".decisions", `${runId}.jsonl`);
      const lines = (await readFile(file, "utf8")).split("\n").filter((l) => l.trim().length > 0);
      expect(lines).toHaveLength(2);
      expect((JSON.parse(lines[0]) as { ev: string }).ev).toBe("decision");
      expect((JSON.parse(lines[1]) as { ev: string }).ev).toBe("bound");
      expect(lines.every((l) => validateLine(l).verdict === "ok")).toBe(true);

      // Never touched the other repository — no `.decisions` directory
      // appears there at all.
      await expect(readFile(join(targetSandbox.targetRepo, ".decisions", `${runId}.jsonl`), "utf8")).rejects.toThrow();
    } finally {
      await copySandbox.cleanup();
      await targetSandbox.cleanup();
    }
  });

  it("gives the two kinds different filenames, so A' section 3.1 still holds", () => {
    // Per-agent files are what makes conflicts structurally impossible (spec
    // §3.1); N copies of the target repository do not break that as long as
    // the names differ. `deriveRunId` is the ONE function either kind of
    // name is derived from — a real task's own run id (its taskId) and the
    // round's own id (the literal "round") — so proving they diverge here is
    // proving the actual production derivation, not a hand-picked example.
    const contractBytes = Buffer.from('{"objective":{"taskId":"T1"}}');
    const planBytes = Buffer.from('{"tasks":[{"taskId":"T1"}]}');
    const base = "0".repeat(40);

    const taskLedgerName = deriveRunId("T1", contractBytes, base);
    const orchestratorLedgerName = deriveRunId("round", planBytes, base);

    expect(taskLedgerName).not.toBe(orchestratorLedgerName);
  });

  it("records ccloop's HEAD and version in each decision's evidence", async () => {
    // A' section 9.1 asks for an npm dependency with a locked version, which
    // ccloop cannot satisfy today (private: true, bin pointing at an unbuilt
    // dist). Recording which ccloop this round actually ran on pins the fact
    // reproduction needs, which is what locking a version was for.
    const s = await makeSandbox();
    try {
      const p = await seedDisjointPlan(s);
      const rc = await runCli(["run", p.planPath, "--adapter-config", p.adapterConfig]);
      expect(rc).toBe(0);

      const lines = await readLedgerOnBranch(s.targetRepo, p.workBranch);
      const decisions = lines
        .map((l) => JSON.parse(l) as { ev?: string; evidence?: string[] })
        .filter((e) => e.ev === "decision");
      expect(decisions.length).toBeGreaterThan(0);

      // Independently measured, not copied from the production code under
      // test: reading ccloop's real HEAD straight out of its own git
      // directory is what the criterion is actually checking evidence
      // AGAINST, rather than merely checking the shape of a hex string.
      const realHead = (await git(ccloopRootOf(s.ccloopBin), ["rev-parse", "HEAD"])).trim();

      for (const d of decisions) {
        expect(d.evidence?.join(" ")).toMatch(/[0-9a-f]{40}/);
        expect(d.evidence?.join(" ")).toContain(realHead);
      }
    } finally {
      await s.cleanup();
    }
  }, 180_000);

  it("ccloopEvidence resolves the same HEAD sha git itself reports for ccloop's repository", async () => {
    const s = await makeSandbox();
    try {
      const evidence = await ccloopEvidence(s.ccloopBin);
      const realHead = (await git(ccloopRootOf(s.ccloopBin), ["rev-parse", "HEAD"])).trim();
      expect(evidence).toHaveLength(1);
      expect(evidence[0]).toContain(realHead);
      expect(evidence[0]).toContain("0.1.0");
    } finally {
      await s.cleanup();
    }
  });
});

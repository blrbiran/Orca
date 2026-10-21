import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { deriveCorrectionId } from "../../src/corrections/fields.js";
import type { CorrectionRow } from "../../src/corrections/fields.js";
import { recordNewCorrection } from "../../src/corrections/record.js";
import { correctionSchema } from "../../src/corrections/schema.js";
import { readCorrections } from "../../src/corrections/store.js";
import { collect } from "../../src/metrics/collect.js";
import { computeMetrics } from "../../src/metrics/compute.js";
import { captureStreams, git, makeTargetRepo, runCli, withCorrectionsDir } from "./harness.js";

// Control run decisions plan Task 10 / debug-task design §12.3: a correction names either a recorded decision
// (`decisionId`) or a decision a landing refused (`{ runId, pendingId }`, from reject-pending-decision).
const AT = "2026-10-18T00:00:00.000Z";
const PENDING: CorrectionRow = {
  projectKey: "example.invalid/o/r", runId: "run-a", pendingId: "pending-orca-t1-0123abcd-0",
  kind: "wrong", because: "question: q0\nchose: c", at: AT, by: "owner@example.invalid",
};

describe("the corrections store's pending target (control run decisions Task 10)", () => {
  it("keeps every existing correction id byte-identical", () => {
    // Captured at the base commit b362e92e, before runId/pendingId existed, with
    //   npx tsx scratchpad/t10-capture.ts  (deriveCorrectionId over these two rows) -> c_ec595bedddeed289, c_30fda1a1a411fde1
    // An absent optional field is omitted from the canonical JSON, so appending fields to CORRECTION_FIELDS moves none.
    const wrong: CorrectionRow = { projectKey: "example.invalid/o/r", decisionId: "orca-t1-0123abcd/agent-0", kind: "wrong", because: "the facts were wrong", at: AT, by: "owner@example.invalid" };
    const taste: CorrectionRow = { projectKey: "example.invalid/o/r", decisionId: "orca-t1-0123abcd/1", kind: "not_my_taste", chose_instead: "the other one", because: "taste", at: AT, by: "owner@example.invalid" };
    expect([deriveCorrectionId(wrong), deriveCorrectionId(taste)]).toEqual(["c_ec595bedddeed289", "c_30fda1a1a411fde1"]);
    // The new fields reach the id: two pending items of one run are two corrections.
    expect(deriveCorrectionId(PENDING)).not.toBe(deriveCorrectionId({ ...PENDING, pendingId: "pending-orca-t1-0123abcd-1" }));
    expect(deriveCorrectionId(PENDING)).not.toBe(deriveCorrectionId({ ...PENDING, runId: "run-b" }));
  });

  it("accepts { runId, pendingId } and refuses decisionId together with pendingId", () => {
    const issues = (row: Record<string, unknown>) => {
      const parsed = correctionSchema.safeParse({ id: "c_0", ...row });
      return parsed.success ? [] : parsed.error.issues.map((issue) => issue.message);
    };
    const { runId: _r, pendingId: _p, ...bare } = PENDING;
    expect(issues(PENDING)).toEqual([]);
    expect(issues({ ...bare, decisionId: "orca-t1-0123abcd/1" })).toEqual([]);
    const target = "exactly one target: decisionId, or both runId and pendingId";
    expect(issues({ ...PENDING, decisionId: "orca-t1-0123abcd/1" })).toEqual([target]);
    expect(issues({ ...bare, decisionId: "orca-t1-0123abcd/1", runId: "run-a" })).toEqual([target]);
    expect(issues({ ...bare, runId: "run-a" })).toEqual([target]);
    expect(issues({ ...bare, pendingId: PENDING.pendingId })).toEqual([target]);
    expect(issues(bare)).toEqual([target]);
  });

  it("records one person's corrections of two pending items of one run as two rows", async () => {
    // store.ts's "already corrected" key widened with the target: without runId/pendingId in it, every pending-target
    // row of one person in one project would look like the same correction (all their decisionIds are absent).
    await withCorrectionsDir(async (dir) => {
      await recordNewCorrection(dir, PENDING, { again: false });
      await recordNewCorrection(dir, { ...PENDING, pendingId: "pending-orca-t1-0123abcd-1" }, { again: false });
      expect((await readCorrections(dir)).map((row) => row.pendingId)).toEqual([PENDING.pendingId, "pending-orca-t1-0123abcd-1"]);
      await expect(recordNewCorrection(dir, { ...PENDING, at: "2026-10-18T00:00:01.000Z" }, { again: false }))
        .rejects.toMatchObject({ code: "correction-already-recorded" });
    });
  });

  it("refuses orca dev correct --close on a pending-target correction by name", async () => {
    const target = await makeTargetRepo();
    try {
      await withCorrectionsDir(async (dir) => {
        const stored = await recordNewCorrection(dir, { ...PENDING, projectKey: "github.com/biran/orca", by: "amy" }, { again: false });
        const before = await readdir(target.decisionsDir);
        const { result: rc, stderr } = await captureStreams(() =>
          runCli(["dev", "correct", "--repo", target.path, "--by", "amy", "--close", stored.id, "--chose-instead", "x", "--undo-how", "git revert --no-edit HEAD"]),
        );
        expect(stderr).toContain("rejected: correction-target-not-a-decision:");
        expect(rc).toBe(1);
        expect(await readdir(target.decisionsDir)).toEqual(before);
      });
    } finally {
      await target.cleanup();
    }
  });

  it("leaves pending-target rows out of the metrics' decision rates", async () => {
    // debug-task design §12.3: they are reported on their own line by that plan; until then no rate counts them, and
    // no "unresolved decision" with an absent id is invented for them.
    await withCorrectionsDir(async (dir) => {
      const root = await mkdtemp(join(tmpdir(), "orca-metrics-root-"));
      try {
        const repo = join(root, "a");
        await mkdir(join(repo, ".decisions"), { recursive: true });
        await git(repo, ["init", "-q"]);
        await git(repo, ["remote", "add", "origin", "https://github.com/biran/a.git"]);
        await recordNewCorrection(dir, { ...PENDING, projectKey: "github.com/biran/a" }, { again: false });
        const obs = await collect({ root, repos: [], correctionsDir: dir, now: () => "2026-10-19T00:00:00.000Z" });
        expect({ corrections: obs.corrections.length, unresolved: obs.unresolvedDecisions.length }).toEqual({ corrections: 0, unresolved: 0 });
        const report = computeMetrics(obs);
        expect([report.correction_rate.corrections_total_including_stale, report.backlog.open_corrections]).toEqual([0, 0]);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  });
});

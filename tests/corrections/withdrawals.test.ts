import { readFile, stat, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { deriveCorrectionId } from "../../src/corrections/fields.js";
import { CORRECTIONS_FILE_MODE, correctionsFile, withdrawalsFile } from "../../src/corrections/paths.js";
import { CorrectRejection } from "../../src/corrections/rejection.js";
import type { Correction, DecisionCorrection } from "../../src/corrections/schema.js";
import { recordCorrection } from "../../src/corrections/store.js";
import {
  CORRECTION_ALREADY_WITHDRAWN,
  CORRECTION_CLOSED,
  CORRECTION_NOT_YOURS,
  CORRECTION_WITHDRAWALS_UNREADABLE,
  readWithdrawals,
  withdrawCorrection,
  withdrawnIds,
} from "../../src/corrections/withdrawals.js";
import { withCorrectionsDir } from "./harness.js";

// Decisions review and correction withdraw spec §5.1–§5.3: a withdrawal is a row in its own append-only file beside
// corrections.jsonl, so that file never sees a new row shape and its strict readers in older builds keep working.

const AT = "2026-10-18T00:00:00.000Z";
const LATER = "2026-10-18T01:00:00.000Z";

function correction(overrides: Partial<Correction> = {}): Correction {
  const base = {
    projectKey: "github.com/biran/orca",
    decisionId: "orca-dev-1/1",
    kind: "not_my_taste" as const,
    chose_instead: "改用文件租约",
    because: "进程内互斥跨进程无效",
    at: AT,
    by: "amy",
    ...overrides,
  };
  return { id: deriveCorrectionId(base), ...base };
}

const open = (_c: DecisionCorrection) => false;
const closed = (_c: DecisionCorrection) => true;

async function refusal(promise: Promise<unknown>): Promise<CorrectRejection> {
  const error = await promise.then(
    () => { throw new Error("the withdrawal went through where it should have been refused"); },
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(CorrectRejection);
  return error as CorrectRejection;
}

const readOrEmpty = (file: string) => readFile(file, "utf8").catch(() => "");

describe("correction withdrawals (decisions review spec §5.1–§5.3)", () => {
  // §5.2's order, one refusal per step. Each fixture is built so that the NEXT step's refusal would also apply,
  // which is what makes the order itself observable rather than only the set of codes.
  it("refuses an unknown id as correction-not-found", async () => {
    await withCorrectionsDir(async (dir) => {
      const error = await refusal(withdrawCorrection(dir, { correctionId: "c_nope", by: "amy", at: LATER, isClosed: open }));
      expect(error.code).toBe("correction-not-found");
      expect(await readOrEmpty(withdrawalsFile(dir))).toBe("");
    });
  });

  it("refuses a pending-target correction as correction-target-not-a-decision, ahead of not-yours", async () => {
    await withCorrectionsDir(async (dir) => {
      const { id: _id, decisionId: _d, ...bare } = correction();
      const pendingBase = { ...bare, runId: "run-a", pendingId: "pending-orca-t1-0123abcd-0", by: "bob" };
      const pending = { id: deriveCorrectionId(pendingBase), ...pendingBase };
      await recordCorrection(dir, pending, { again: false });
      const error = await refusal(withdrawCorrection(dir, { correctionId: pending.id, by: "amy", at: LATER, isClosed: open }));
      expect(error.code).toBe("correction-target-not-a-decision");
      expect(await readOrEmpty(withdrawalsFile(dir))).toBe("");
    });
  });

  it("refuses someone else's correction as correction-not-yours, ahead of already-withdrawn", async () => {
    await withCorrectionsDir(async (dir) => {
      const row = correction();
      await recordCorrection(dir, row, { again: false });
      await withdrawCorrection(dir, { correctionId: row.id, by: "amy", at: LATER, isClosed: open });
      const before = await readFile(withdrawalsFile(dir), "utf8");

      // Both apply: bob is not amy, and amy already withdrew it. §5.2 names not-yours first.
      const error = await refusal(withdrawCorrection(dir, { correctionId: row.id, by: "bob", at: LATER, isClosed: closed }));
      expect(error.code).toBe(CORRECTION_NOT_YOURS);
      expect(CORRECTION_NOT_YOURS).toBe("correction-not-yours");
      expect(await readFile(withdrawalsFile(dir), "utf8")).toBe(before);
    });
  });

  it("refuses a second withdrawal as correction-already-withdrawn, ahead of closed", async () => {
    await withCorrectionsDir(async (dir) => {
      const row = correction();
      await recordCorrection(dir, row, { again: false });
      await withdrawCorrection(dir, { correctionId: row.id, by: "amy", at: LATER, isClosed: open });
      const before = await readFile(withdrawalsFile(dir), "utf8");

      const error = await refusal(withdrawCorrection(dir, { correctionId: row.id, by: "amy", at: LATER, isClosed: closed }));
      expect(error.code).toBe(CORRECTION_ALREADY_WITHDRAWN);
      expect(CORRECTION_ALREADY_WITHDRAWN).toBe("correction-already-withdrawn");
      expect(await readFile(withdrawalsFile(dir), "utf8")).toBe(before);
    });
  });

  it("refuses a closed correction as correction-closed and says to record a new one", async () => {
    await withCorrectionsDir(async (dir) => {
      const row = correction();
      await recordCorrection(dir, row, { again: false });
      const seen: string[] = [];
      const error = await refusal(
        withdrawCorrection(dir, {
          correctionId: row.id, by: "amy", at: LATER,
          isClosed: (c) => { seen.push(c.id); return true; },
        }),
      );
      expect(error.code).toBe(CORRECTION_CLOSED);
      expect(CORRECTION_CLOSED).toBe("correction-closed");
      expect(error.message).toContain("record a new correction");
      // The predicate is asked about THIS correction, not some other row.
      expect(seen).toEqual([row.id]);
      expect(await readOrEmpty(withdrawalsFile(dir))).toBe("");
    });
  });

  it("writes one 0600 line, returns it, and leaves corrections.jsonl byte-identical", async () => {
    await withCorrectionsDir(async (dir) => {
      const row = correction();
      await recordCorrection(dir, row, { again: false });
      const correctionsBefore = await readFile(correctionsFile(dir));

      const previousUmask = process.umask(0o022);
      let result: Awaited<ReturnType<typeof withdrawCorrection>>;
      try {
        result = await withdrawCorrection(dir, { correctionId: row.id, by: "amy", at: LATER, isClosed: open });
        // The literal, not CORRECTIONS_FILE_MODE (store.test.ts's E17 records why: comparing against the constant
        // under test stays green if the constant itself is loosened). Under umask 022 an inherited mode is 0644.
        expect((await stat(withdrawalsFile(dir))).mode & 0o777).toBe(0o600);
      } finally {
        process.umask(previousUmask);
      }

      const expected = { correctionId: row.id, projectKey: row.projectKey, by: "amy", at: LATER };
      expect(result.withdrawal).toEqual(expected);
      expect(result.correction).toEqual(row);
      expect(await readFile(withdrawalsFile(dir), "utf8")).toBe(`${JSON.stringify(expected)}\n`);
      expect(await readWithdrawals(dir)).toEqual([expected]);
      expect(withdrawnIds(await readWithdrawals(dir))).toEqual(new Set([row.id]));
      expect(Buffer.compare(await readFile(correctionsFile(dir)), correctionsBefore)).toBe(0);
    });
  });

  it("does not glue a withdrawal onto a file whose last line has no newline", async () => {
    await withCorrectionsDir(async (dir) => {
      const mine = correction();
      const theirs = correction({ by: "bob" });
      await recordCorrection(dir, mine, { again: false });
      await recordCorrection(dir, theirs, { again: false });
      const existing = { correctionId: theirs.id, projectKey: theirs.projectKey, by: "bob", at: AT };
      await writeFile(withdrawalsFile(dir), JSON.stringify(existing), { mode: CORRECTIONS_FILE_MODE });

      await withdrawCorrection(dir, { correctionId: mine.id, by: "amy", at: LATER, isClosed: open });

      expect((await readWithdrawals(dir)).map((w) => w.correctionId)).toEqual([theirs.id, mine.id]);
    });
  });

  it("reads a missing withdrawals file as none, and a garbage line as a refusal, never as none", async () => {
    await withCorrectionsDir(async (dir) => {
      expect(await readWithdrawals(dir)).toEqual([]);

      const row = correction();
      await recordCorrection(dir, row, { again: false });
      await writeFile(withdrawalsFile(dir), "{not json\n", { mode: CORRECTIONS_FILE_MODE });

      await expect(readWithdrawals(dir)).rejects.toMatchObject({ code: CORRECTION_WITHDRAWALS_UNREADABLE });
      const error = await refusal(withdrawCorrection(dir, { correctionId: row.id, by: "amy", at: LATER, isClosed: open }));
      expect(error.code).toBe("correction-withdrawals-unreadable");
      expect(await readFile(withdrawalsFile(dir), "utf8")).toBe("{not json\n");

      // A row that parses as JSON but is not the strict shape is the same refusal.
      await writeFile(withdrawalsFile(dir), `${JSON.stringify({ correctionId: row.id, projectKey: row.projectKey, by: "amy", at: AT, extra: 1 })}\n`);
      await expect(readWithdrawals(dir)).rejects.toMatchObject({ code: CORRECTION_WITHDRAWALS_UNREADABLE });
    });
  });
});

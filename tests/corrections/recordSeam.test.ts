import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { deriveCorrectionId } from "../../src/corrections/fields.js";
import { CORRECTION_ROW_INVALID, recordNewCorrection } from "../../src/corrections/record.js";
import type { CorrectionRow } from "../../src/corrections/fields.js";
import { CorrectRejection } from "../../src/corrections/rejection.js";
import { readCorrections } from "../../src/corrections/store.js";
import { captureStreams, closeArgs, makeTargetRepo, runCli, withCorrectionsDir } from "./harness.js";

const ROW: CorrectionRow = {
  projectKey: "github.com/biran/orca",
  decisionId: "orca-dev-1/1",
  kind: "wrong",
  because: "那个前提当时就不成立",
  at: "2026-09-01T00:00:00.000Z",
  by: "amy",
};

const recordArgs = (repo: string, overrides: string[] = []) => [
  "correct", "--repo", repo, "--by", "amy",
  "--decision", "orca-dev-1/1", "--kind", "wrong", "--because", "那个前提当时就不成立",
  ...overrides,
];

/**
 * 🔴 E3 spec §2.3 / §9 item 6. The panel cannot call `correct(argv)` — that one
 * parses argv and writes stdout — so the row-building and id-deriving half is
 * pulled out here, and BOTH the CLI and the panel go through it.
 *
 * What this file pins is the reason §2.3 gives for the extraction: with the
 * construction written twice, no mutation can make "the two paths agree" go
 * red, because there is no single place to mutate.
 */
describe("recordNewCorrection — the one construction point (E3 spec §2.3)", () => {
  it("returns the stored row, and its id is the derivation of that row", async () => {
    await withCorrectionsDir(async (dir) => {
      const stored = await recordNewCorrection(dir, ROW, { again: false });

      expect(stored.id).toBe(deriveCorrectionId(ROW));
      expect(stored.id).toMatch(/^c_[0-9a-f]{16}$/);
      const rows = await readCorrections(dir);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual(stored);
    });
  });

  /**
   * 🔴 §2.3's named toxicity, and it is reachable from the CLI TODAY, not only
   * from a future panel: `--chose-instead ""` currently reaches
   * appendCorrectionLocked's schema parse and throws a raw ZodError, which
   * carries no code and so exits 3 with a Zod dump. An empty optional field is
   * refused BY NAME here instead, before anything is written.
   *
   * Not normalised to "absent": silently treating an empty box as "you said
   * nothing" lets a panel user believe they said something (Rule 12).
   */
  it("refuses an empty optional field by name, and writes nothing", async () => {
    await withCorrectionsDir(async (dir) => {
      const error = await recordNewCorrection(dir, { ...ROW, chose_instead: "" }, { again: false }).then(
        () => {
          throw new Error("an empty chose_instead was accepted");
        },
        (e: unknown) => e,
      );

      expect(error).toBeInstanceOf(CorrectRejection);
      expect((error as CorrectRejection).code).toBe(CORRECTION_ROW_INVALID);
      expect((error as Error).message).toContain("chose_instead");
      // The advice belongs on THIS path, where a field really did arrive as "".
      expect((error as Error).message).toContain("must be left out, not sent empty");
      expect(existsSync(join(dir, "corrections.jsonl"))).toBe(false);
    });
  });

  /**
   * The other way this schema refuses, and it asks for the OPPOSITE thing.
   * superRefine forces chose_instead for `not_my_taste`, so telling that person
   * to leave the field out is advice that cannot be followed. Measured on the
   * real CLI before this criterion existed: both sentences came back in one
   * refusal, on a path the argument parser does not guard (correct.ts's own
   * no-chose-instead check sits after the seam call, not before it).
   *
   * Giving someone who mistyped one flag something they can act on is the whole
   * reason this guard exists rather than letting a bare ZodError reach exit 3.
   */
  it("does not tell a not_my_taste row to leave chose_instead out", async () => {
    await withCorrectionsDir(async (dir) => {
      const error = await recordNewCorrection(
        dir,
        { ...ROW, kind: "not_my_taste" },
        { again: false },
      ).then(
        () => {
          throw new Error("a not_my_taste row with no chose_instead was accepted");
        },
        (e: unknown) => e,
      );

      expect((error as CorrectRejection).code).toBe(CORRECTION_ROW_INVALID);
      expect((error as Error).message).toContain("required when kind is not_my_taste");
      expect((error as Error).message).not.toContain("must be left out");
      expect(existsSync(join(dir, "corrections.jsonl"))).toBe(false);
    });
  });

  it("hands `again` through to the store rather than deciding it here", async () => {
    await withCorrectionsDir(async (dir) => {
      await recordNewCorrection(dir, ROW, { again: false });

      const refused = await recordNewCorrection(dir, { ...ROW, at: "2026-09-02T00:00:00.000Z" }, { again: false }).then(
        () => {
          throw new Error("a second correction on the same key was accepted without --again");
        },
        (e: unknown) => e,
      );
      expect((refused as CorrectRejection).code).toBe("correction-already-recorded");

      await recordNewCorrection(dir, { ...ROW, at: "2026-09-02T00:00:00.000Z" }, { again: true });
      expect(await readCorrections(dir)).toHaveLength(2);
    });
  });
});

/**
 * 🔴 The half that makes the extraction worth doing: both CLI modes reach the
 * store through the same construction. `at` is stamped from the wall clock and
 * cannot be injected, so the invariant is checked against the row as stored —
 * a mode that built its row from a different field set would store an id that
 * is not the derivation of what sits next to it.
 */
describe("both CLI modes construct their correction the same way (E3 spec §2.3)", () => {
  for (const [label, argsOf] of [
    ["record mode", recordArgs],
    ["close mode", closeArgs],
  ] as const) {
    it(`${label}: the stored id is the derivation of the stored row`, async () => {
      const target = await makeTargetRepo();
      try {
        await withCorrectionsDir(async (dir) => {
          const { result: rc } = await captureStreams(() => runCli(argsOf(target.path)));
          expect(rc).toBe(0);

          const rows = await readCorrections(dir);
          expect(rows).toHaveLength(1);
          const { id, ...fields } = rows[0];
          expect(id).toBe(deriveCorrectionId(fields));
        });
      } finally {
        await target.cleanup();
      }
    });
  }

  /**
   * 🔴 Found by the mutation survey for this file: nothing anywhere pinned the
   * FIELD VALUES of the row the closing path stores. "the stored id is the
   * derivation of the stored row" above stays green under any mutation that
   * changes the row and the id together, and record.test.ts only ever looks at
   * the recording path's row -- so a mutation to the one literal both modes
   * share could only ever be seen from one side of it.
   */
  it("close mode stores the row the person described, not just a self-consistent one", async () => {
    const target = await makeTargetRepo();
    try {
      await withCorrectionsDir(async (dir) => {
        expect((await captureStreams(() => runCli(closeArgs(target.path)))).result).toBe(0);

        const rows = await readCorrections(dir);
        expect(rows).toHaveLength(1);
        expect(rows[0].projectKey).toBe("github.com/biran/orca");
        expect(rows[0].decisionId).toBe("orca-dev-1/1");
        expect(rows[0].kind).toBe("not_my_taste");
        expect(rows[0].by).toBe("amy");
        expect(rows[0].because).toBe("进程内互斥跨进程无效");
        expect(rows[0].chose_instead).toBe("改用文件租约");
      });
    } finally {
      await target.cleanup();
    }
  });

  it("gives a named rejection for --chose-instead '', not a Zod dump", async () => {
    const target = await makeTargetRepo();
    try {
      await withCorrectionsDir(async (dir) => {
        const { result: rc, stderr } = await captureStreams(() =>
          runCli(closeArgs(target.path, [])
            .map((a) => (a === "改用文件租约" ? "" : a))),
        );

        expect(stderr).toContain(`rejected: ${CORRECTION_ROW_INVALID}:`);
        expect(stderr).not.toContain("too_small");
        expect(rc).toBe(1);
        expect(existsSync(join(dir, "corrections.jsonl"))).toBe(false);
      });
    } finally {
      await target.cleanup();
    }
  });
});

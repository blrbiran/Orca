import { describe, expect, it } from "vitest";
import { correct } from "../../src/corrections/correct.js";
import { correctionRowFrom } from "../../src/corrections/record.js";
import { readCorrections } from "../../src/corrections/store.js";
import { captureStreams, closeArgs, makeTargetRepo, withCorrectionsDir } from "./harness.js";

/**
 * 🔴 Task P (E3 spec §2.3, human authorisation 2026-09-10): the correction
 * clock is now a function parameter, not a call to `new Date()` buried inside
 * the row constructor. These criteria pin that the injected clock is what
 * actually governs `at` — on the shared constructor directly, and through
 * both CLI modes of `correct(argv, { now })`, which is the same function the
 * panel (Task 7) will call.
 */

const INSTANT = "2026-09-01T12:34:56.000Z";

// src/cli.ts's `runCorrect` calls `correct(args)` where `args` is argv with
// the leading "correct" token already stripped off by `main`'s own
// destructuring — parseCorrectArgs would reject "correct" itself as an
// unknown argument. These two arg-builders mirror that shape exactly, so
// calling `correct(...)` directly below reaches it the same way the real CLI
// does.
const recordArgs = (repo: string): string[] => [
  "--repo", repo, "--by", "amy",
  "--decision", "orca-dev-1/1", "--kind", "wrong", "--because", "那个前提当时就不成立",
];

const closeArgsForCorrect = (repo: string): string[] => closeArgs(repo).slice(1);

/**
 * The golden id `correct(recordArgs(...), { now: () => new Date(INSTANT) })`
 * actually stored, observed once (measured 2026-09-10 against this file's own
 * fixture, commit a801200 base) and pasted here as a literal rather than
 * recomputed with `deriveCorrectionId` in the test — Task 7 (the panel) will
 * assert its own row-construction output against this exact literal, so this
 * is the criterion that pins "panel and CLI produce the same correction id
 * for the same input" (E3 spec §2.3).
 */
const GOLDEN_ID = "c_ed266d26d170dd27";

describe("the correction clock is injectable (Task P, E3 spec §2.3)", () => {
  it("correctionRowFrom stamps `at` from the injected clock, not the wall clock", () => {
    // Why it matters: this is the ONE row constructor the panel and CLI both
    // call. If `at` came from the wall clock instead of the injected `now`,
    // two calls with identical input could never derive the same id, and the
    // "panel and CLI agree" criterion below (and Task 7's) could not hold.
    const row = correctionRowFrom(
      {
        projectKey: "github.com/biran/orca",
        decisionId: "orca-dev-1/1",
        kind: "wrong",
        chose_instead: "改用文件租约",
        because: "那个前提当时就不成立",
        by: "amy",
      },
      () => new Date(INSTANT),
    );

    // Every expected value below is a literal written here, never computed by
    // the function under test.
    expect(row.at).toBe(INSTANT);
    expect(row.projectKey).toBe("github.com/biran/orca");
    expect(row.decisionId).toBe("orca-dev-1/1");
    expect(row.kind).toBe("wrong");
    expect(row.chose_instead).toBe("改用文件租约");
    expect(row.because).toBe("那个前提当时就不成立");
    expect(row.by).toBe("amy");
  });

  it("record mode through correct(argv, { now }) stores at === INSTANT", async () => {
    // Why it matters: src/cli.ts calls this exact function; the panel (Task
    // 7) will call it too, passing its own `now`. If `opts.now` were accepted
    // but not plumbed through to the row constructor, the CLI's record path
    // would keep stamping the wall clock and this would catch it.
    const target = await makeTargetRepo();
    try {
      await withCorrectionsDir(async (dir) => {
        const { result: rc } = await captureStreams(() =>
          correct(recordArgs(target.path), { now: () => new Date(INSTANT) }),
        );
        expect(rc).toBe(0);

        const rows = await readCorrections(dir);
        expect(rows).toHaveLength(1);
        expect(rows[0].at).toBe(INSTANT);
      });
    } finally {
      await target.cleanup();
    }
  });

  it("close mode through correct(argv, { now }) stores at === INSTANT", async () => {
    // Why it matters: the close-new branch calls correctionRowFrom on a
    // separate code path from record mode (§14.4's own construction of
    // ParsedCorrect) — this pins that the SAME injected clock governs that
    // path too, not just the record-mode one above.
    const target = await makeTargetRepo();
    try {
      await withCorrectionsDir(async (dir) => {
        const { result: rc } = await captureStreams(() =>
          correct(closeArgsForCorrect(target.path), { now: () => new Date(INSTANT) }),
        );
        expect(rc).toBe(0);

        const rows = await readCorrections(dir);
        expect(rows).toHaveLength(1);
        expect(rows[0].at).toBe(INSTANT);
      });
    } finally {
      await target.cleanup();
    }
  });

  it("the same input with the same injected clock yields the same stored id, matching the golden Task 7 will assert against", async () => {
    // Why it matters: this IS E3 spec §2.3's actual criterion — "panel and
    // CLI produce the same correction id for the same input" — checked here
    // by running record mode twice, each with its own fresh corrections dir
    // and its own fresh target repo (same remote, so the same projectKey).
    // Before the clock was injectable this could never be made to pass: two
    // wall-clock reads necessarily differ, so `at` (CORRECTION_FIELDS' sixth
    // entry) necessarily differed too, and so did the derived id.
    const ids: string[] = [];
    for (let i = 0; i < 2; i++) {
      const target = await makeTargetRepo();
      try {
        await withCorrectionsDir(async (dir) => {
          const { result: rc } = await captureStreams(() =>
            correct(recordArgs(target.path), { now: () => new Date(INSTANT) }),
          );
          expect(rc).toBe(0);

          const rows = await readCorrections(dir);
          expect(rows).toHaveLength(1);
          ids.push(rows[0].id);
        });
      } finally {
        await target.cleanup();
      }
    }

    expect(ids[0]).toBe(ids[1]);
    expect(ids[0]).toBe(GOLDEN_ID);
  });
});

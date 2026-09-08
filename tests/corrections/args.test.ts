import { describe, expect, it } from "vitest";
import { CorrectRejection } from "../../src/corrections/rejection.js";
import {
  CLOSE_ARG_CONFLICT,
  MALFORMED_ARGUMENT,
  MISSING_CLOSING_HALF,
  MISSING_IDENTITY,
  MISSING_REQUIRED_ARGUMENT,
  parseCorrectArgs,
  type ParseCorrectArgsOptions,
} from "../../src/corrections/args.js";

const base = ["--repo", "/tmp/r", "--by", "amy", "--decision", "orca-dev-1/1", "--kind", "wrong", "--because", "错了"];

const rejectionOf = async (
  argv: string[],
  options?: ParseCorrectArgsOptions,
): Promise<CorrectRejection> =>
  parseCorrectArgs(argv, options).then(
    () => {
      throw new Error(`parse accepted ${argv.join(" ")}`);
    },
    (e: unknown) => e as CorrectRejection,
  );

describe("orca correct argument surface (spec §3 as revised by §14.4 / §14.24, plus the --record-only ruling)", () => {
  it("records only, when neither closing argument is given", async () => {
    const parsed = await parseCorrectArgs(base);
    expect(parsed.mode).toBe("record");
  });

  it("closes the loop when both closing arguments are given", async () => {
    const parsed = await parseCorrectArgs([...base, "--chose-instead", "别的", "--undo-how", "删掉 src/a.ts 那处"]);
    expect(parsed.mode).toBe("close-new");
  });

  // 🔴 E3 — the defect this replaces: with mode inferred from "are both
  // present", mistyping `--undo-hwo` silently produced a record-only run that
  // exited 0, and the person believed they had closed the loop. The message
  // has to name which half is missing; both branches exit non-zero, so the
  // message is the ONLY thing that distinguishes the fixed behaviour.
  it("refuses a half-expressed closing intent and names the missing half", async () => {
    const missingUndo = await rejectionOf([...base, "--chose-instead", "别的"]);
    expect(missingUndo.message).toContain("--undo-how");
    expect(missingUndo.code).toBe(MISSING_CLOSING_HALF);
    expect(missingUndo.exitCode).toBe(1);

    const missingChose = await rejectionOf([...base, "--undo-how", "删掉 src/a.ts 那处"]);
    expect(missingChose.message).toContain("--chose-instead");
    expect(missingChose.code).toBe(MISSING_CLOSING_HALF);
  });

  // Ruling 2: the missing-half message must also name --record-only, so
  // nobody has to remember the flag exists to be told they need it.
  it("names --record-only in the missing-half message, as the alternative to closing", async () => {
    const missingUndo = await rejectionOf([...base, "--chose-instead", "别的"]);
    expect(missingUndo.message).toContain("--record-only");

    const missingChose = await rejectionOf([...base, "--undo-how", "删掉 src/a.ts 那处"]);
    expect(missingChose.message).toContain("--record-only");
  });

  // Ruling 2 / criterion E3c: --record-only suppresses inferred closing
  // intent, so a not_my_taste-shaped correction (which needs chose_instead
  // just to satisfy the schema) can still be recorded WITHOUT being coerced
  // into inventing an undo.how for the append-only ledger.
  it("E3c: --chose-instead plus --record-only parses to record, and does not refuse", async () => {
    const parsed = await parseCorrectArgs([...base, "--chose-instead", "别的", "--record-only"]);
    expect(parsed.mode).toBe("record");
    expect(parsed).toMatchObject({ mode: "record", choseInstead: "别的" });
  });

  // Ruling 2: --record-only contradicts --close (finish vs. explicitly not).
  it("refuses --close together with --record-only", async () => {
    const error = await rejectionOf([
      "--repo", "/tmp/r", "--by", "amy", "--close", "c_1", "--undo-how", "x", "--record-only",
    ]);
    expect(error.code).toBe(CLOSE_ARG_CONFLICT);
  });

  // §14.4: --close is exclusive with the values that already live on the
  // stored row...
  it("refuses --close together with the fields that are already on the stored row", async () => {
    const error = await rejectionOf([
      "--repo", "/tmp/r", "--by", "amy", "--close", "c_1", "--undo-how", "删掉 src/a.ts 那处", "--kind", "wrong",
    ]);
    expect(error.message).toContain("--kind");
    expect(error.code).toBe(CLOSE_ARG_CONFLICT);
  });

  // ...but NOT with the three undo fields, which are not among the
  // correction's eight fields and therefore cannot be on that row.
  it("accepts --close together with the three undo arguments", async () => {
    const parsed = await parseCorrectArgs([
      "--repo", "/tmp/r", "--by", "amy", "--close", "c_1",
      "--undo-how", "删掉 src/a.ts 那处", "--undo-cost", "改一个文件", "--undo-blast-radius", "仅本仓库",
    ]);
    expect(parsed).toMatchObject({
      mode: "close-existing",
      correctionId: "c_1",
      undo: { how: "删掉 src/a.ts 那处", cost: "改一个文件", blastRadius: "仅本仓库" },
    });
  });

  it("refuses --close without --undo-how, which the stored row cannot supply", async () => {
    const error = await rejectionOf(["--repo", "/tmp/r", "--by", "amy", "--close", "c_1"]);
    expect(error.message).toContain("--undo-how");
    expect(error.code).toBe(MISSING_CLOSING_HALF);
  });

  // spec §3 / §12 finding 2: `by` is min(1) in the schema, so an unset git
  // identity would otherwise fail four layers down with "field missing" — a
  // message that never mentions the machine's git config. Uses the test
  // seam (parseCorrectArgs's second parameter) rather than a real flag.
  it("says the machine has no git identity rather than letting the schema complain", async () => {
    const error = await rejectionOf(
      ["--repo", "/tmp/r", "--decision", "orca-dev-1/1", "--kind", "wrong", "--because", "错了"],
      { gitUserName: async () => undefined },
    );
    expect(error.message).toContain("git config user.name");
    expect(error.code).toBe(MISSING_IDENTITY);
  });

  // Second guard behind the E3 defect: an unknown flag (the exact shape of
  // the original typo) must be a named refusal, never silently dropped —
  // dropping it is what let the typo look like a successful record-only run.
  it("refuses an unknown flag instead of ignoring it", async () => {
    const error = await rejectionOf([...base, "--undo-hwo", "删掉 src/a.ts 那处"]);
    expect(error.message).toContain("--undo-hwo");
  });

  // Fix round 1, finding 1: `argv[index + 1]` reading past the end of the
  // array silently returns `undefined`, which used to read exactly like
  // "flag not given at all" — the same silent mode-flip this whole task
  // exists to eliminate, arriving through a different door. A shell script
  // writing `--close $id` with `$id` unset produces exactly this shape.
  it("refuses --close as the trailing token instead of dropping it and falling back to record", async () => {
    const error = await rejectionOf([...base, "--close"]);
    expect(error.message).toContain("--close");
    expect(error.code).toBe(MALFORMED_ARGUMENT);
  });

  it("refuses --chose-instead as the trailing token instead of dropping it", async () => {
    const error = await rejectionOf([...base, "--chose-instead"]);
    expect(error.message).toContain("--chose-instead");
    expect(error.code).toBe(MALFORMED_ARGUMENT);
  });

  // A value slot that is EXACTLY another recognised flag's name means the
  // flag before it never got a value at all — name the flag that is missing
  // its value (`--decision` here), not the flag that happened to land in
  // its slot.
  it("refuses a value slot that is exactly another known flag, naming the flag left without a value", async () => {
    const error = await rejectionOf([
      "--repo", "/tmp/r", "--by", "amy", "--decision", "--kind", "wrong", "--because", "x",
    ]);
    expect(error.message).toContain("--decision");
    expect(error.code).toBe(MALFORMED_ARGUMENT);
  });

  // 🔴 Negative control: the fix above must be an EXACT match against known
  // flag names, not "starts with --" — a human's reason may legitimately
  // begin with dashes, and that has to keep parsing.
  it("still parses a --because value that itself starts with dashes", async () => {
    const parsed = await parseCorrectArgs([
      "--repo", "/tmp/r", "--by", "amy", "--decision", "orca-dev-1/1", "--kind", "wrong",
      "--because", "--not a flag, a reason",
    ]);
    expect(parsed).toMatchObject({ mode: "record", because: "--not a flag, a reason" });
  });

  // Finding 2: MISSING_REQUIRED_ARGUMENT had zero criteria before this round
  // — every existing test supplied --decision/--kind/--because via `base`.
  // A rejection path with no criterion is as good as absent.
  it("refuses a missing --decision, naming it", async () => {
    const error = await rejectionOf(["--repo", "/tmp/r", "--by", "amy", "--kind", "wrong", "--because", "错了"]);
    expect(error.message).toContain("--decision");
    expect(error.code).toBe(MISSING_REQUIRED_ARGUMENT);
  });

  it("refuses a missing --because, naming it", async () => {
    const error = await rejectionOf([
      "--repo", "/tmp/r", "--by", "amy", "--decision", "orca-dev-1/1", "--kind", "wrong",
    ]);
    expect(error.message).toContain("--because");
    expect(error.code).toBe(MISSING_REQUIRED_ARGUMENT);
  });

  it("refuses an invalid --kind value, naming --kind", async () => {
    const error = await rejectionOf([
      "--repo", "/tmp/r", "--by", "amy", "--decision", "orca-dev-1/1", "--kind", "bogus", "--because", "错了",
    ]);
    expect(error.message).toContain("--kind");
    expect(error.code).toBe(MISSING_REQUIRED_ARGUMENT);
  });

  // Finding 3: `argv.indexOf` silently kept the first of a repeated flag.
  // Rule 12 — fail loud rather than silently reinterpret malformed input.
  it("refuses a repeated --kind instead of silently keeping the first one", async () => {
    const error = await rejectionOf([...base, "--kind", "stale"]);
    expect(error.message).toContain("--kind");
    expect(error.code).toBe(MALFORMED_ARGUMENT);
  });
});

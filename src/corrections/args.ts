import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { CORRECTION_KINDS } from "./schema.js";
import type { CorrectionKind } from "./schema.js";
import { CorrectRejection } from "./rejection.js";

const execFileAsync = promisify(execFile);

export type UndoArgs = { how: string; cost?: string; blastRadius?: string };

export type ParsedCorrect =
  | {
      mode: "record";
      repo: string;
      by: string;
      decisionId: string;
      kind: CorrectionKind;
      because: string;
      choseInstead?: string;
      again: boolean;
    }
  | {
      mode: "close-new";
      repo: string;
      by: string;
      decisionId: string;
      kind: CorrectionKind;
      because: string;
      choseInstead: string;
      again: boolean;
      undo: UndoArgs;
    }
  | {
      mode: "close-existing";
      repo: string;
      by: string;
      correctionId: string;
      choseInstead?: string;
      undo: UndoArgs;
    };

/**
 * §14.24: either closing argument expresses closing intent. The defect this
 * replaces inferred "closing" from "both present" -- a typo in either half
 * (`--undo-hwo`) silently fell back to record-only and exited 0, and the
 * person believed they had closed the loop. Naming the missing half is the
 * whole point: both branches now exit non-zero, so the message is the only
 * thing telling the two apart.
 */
export const MISSING_CLOSING_HALF = "incomplete-closing-intent";

/** --close identifies an already-stored row; re-supplying fields that live on that row is a contradiction, not an update. */
export const CLOSE_ARG_CONFLICT = "close-argument-conflict";

/** spec §3 / §12 finding 2: `by` is required by the schema, but "field missing" four layers down never mentions git config. */
export const MISSING_IDENTITY = "no-git-identity";

/** A flag this parser does not know, or a stray positional -- refused, never silently dropped (the second guard behind the typo defect above). */
export const UNKNOWN_ARGUMENT = "unknown-argument";

/** A flag whose value this parser needs but was not given. */
export const MISSING_REQUIRED_ARGUMENT = "missing-required-argument";

const VALUE_FLAGS = [
  "--repo",
  "--by",
  "--decision",
  "--kind",
  "--because",
  "--chose-instead",
  "--undo-how",
  "--undo-cost",
  "--undo-blast-radius",
  "--close",
] as const;

const BOOLEAN_FLAGS = ["--again", "--record-only"] as const;

/**
 * Every token must be a known boolean flag, or a known value flag followed by
 * its value -- anything else (an unknown flag, or a stray positional) is
 * refused. Walking the array and skipping a value flag's next slot, rather
 * than just checking "does every `--`-prefixed token appear in a known set",
 * is what lets a flag's own value read like a flag name without being
 * misclassified as one.
 */
function findUnknownToken(argv: string[]): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if ((BOOLEAN_FLAGS as readonly string[]).includes(token)) continue;
    if ((VALUE_FLAGS as readonly string[]).includes(token)) {
      i++; // its value; not itself an argument to classify
      continue;
    }
    return token;
  }
  return undefined;
}

async function defaultGitUserName(): Promise<string | undefined> {
  const name = await execFileAsync("git", ["config", "user.name"])
    .then(({ stdout }) => stdout.trim())
    .catch(() => "");
  return name.length > 0 ? name : undefined;
}

export type ParseCorrectArgsOptions = {
  /** Test seam: the default reads the real `git config user.name` (see makeSandbox's resolveCcloopBin for the same shape). */
  gitUserName?: () => Promise<string | undefined>;
};

function requireValue(value: string | undefined, flagName: string): string {
  if (value === undefined) {
    throw new CorrectRejection(MISSING_REQUIRED_ARGUMENT, `${flagName} is required`);
  }
  return value;
}

function requireKind(value: string | undefined): CorrectionKind {
  const kind = requireValue(value, "--kind");
  if (!(CORRECTION_KINDS as readonly string[]).includes(kind)) {
    throw new CorrectRejection(
      MISSING_REQUIRED_ARGUMENT,
      `--kind must be one of ${CORRECTION_KINDS.join(", ")}, got ${JSON.stringify(kind)}`,
    );
  }
  return kind as CorrectionKind;
}

export async function parseCorrectArgs(
  argv: string[],
  options: ParseCorrectArgsOptions = {},
): Promise<ParsedCorrect> {
  const unknown = findUnknownToken(argv);
  if (unknown !== undefined) {
    throw new CorrectRejection(UNKNOWN_ARGUMENT, `unknown argument: ${unknown}`);
  }

  const flagValue = (name: string): string | undefined => {
    const index = argv.indexOf(name);
    return index === -1 ? undefined : argv[index + 1];
  };

  const repo = flagValue("--repo") ?? process.cwd();
  const decisionId = flagValue("--decision");
  const kindRaw = flagValue("--kind");
  const because = flagValue("--because");
  const choseInstead = flagValue("--chose-instead");
  const undoHow = flagValue("--undo-how");
  const undoCost = flagValue("--undo-cost");
  const undoBlastRadius = flagValue("--undo-blast-radius");
  const close = flagValue("--close");
  const again = argv.includes("--again");
  const recordOnly = argv.includes("--record-only");

  // Ruling 2: --close finishes a loop; --record-only asks not to. Both at
  // once is a contradiction, refused by the same code as the other
  // --close conflicts below.
  if (close !== undefined && recordOnly) {
    throw new CorrectRejection(
      CLOSE_ARG_CONFLICT,
      "--close and --record-only are mutually exclusive: --close finishes closing a loop, --record-only asks not to close it",
    );
  }

  let by = flagValue("--by");
  if (by === undefined) {
    const resolver = options.gitUserName ?? defaultGitUserName;
    by = await resolver();
    if (by === undefined) {
      throw new CorrectRejection(
        MISSING_IDENTITY,
        "no --by given and `git config user.name` returned nothing: pass --by, or set git config user.name",
      );
    }
  }

  if (close !== undefined) {
    // §14.4: --close is exclusive with the fields already on the stored row.
    // --chose-instead is NOT checked here -- it is conditionally exclusive
    // (allowed only when the stored row lacks it), which needs the store and
    // is Task 9's job.
    const conflicts: [string, boolean][] = [
      ["--decision", decisionId !== undefined],
      ["--kind", kindRaw !== undefined],
      ["--because", because !== undefined],
      ["--again", again],
    ];
    for (const [flagName, present] of conflicts) {
      if (present) {
        throw new CorrectRejection(
          CLOSE_ARG_CONFLICT,
          `--close cannot be combined with ${flagName}: that value already lives on the stored correction row`,
        );
      }
    }

    if (undoHow === undefined) {
      throw new CorrectRejection(
        MISSING_CLOSING_HALF,
        "--close requires --undo-how, which the stored row cannot supply: add --undo-how to close the loop",
      );
    }

    return {
      mode: "close-existing",
      repo,
      by,
      correctionId: close,
      choseInstead,
      undo: { how: undoHow, cost: undoCost, blastRadius: undoBlastRadius },
    };
  }

  const expressedClosingIntent = choseInstead !== undefined || undoHow !== undefined;

  if (!recordOnly && expressedClosingIntent) {
    if (undoHow === undefined) {
      throw new CorrectRejection(
        MISSING_CLOSING_HALF,
        "you gave --chose-instead but not --undo-how: add --undo-how to close the loop, or --record-only to just write it down",
      );
    }
    if (choseInstead === undefined) {
      throw new CorrectRejection(
        MISSING_CLOSING_HALF,
        "you gave --undo-how but not --chose-instead: add --chose-instead to close the loop, or --record-only to just write it down",
      );
    }

    return {
      mode: "close-new",
      repo,
      by,
      decisionId: requireValue(decisionId, "--decision"),
      kind: requireKind(kindRaw),
      because: requireValue(because, "--because"),
      choseInstead,
      again,
      undo: { how: undoHow, cost: undoCost, blastRadius: undoBlastRadius },
    };
  }

  return {
    mode: "record",
    repo,
    by,
    decisionId: requireValue(decisionId, "--decision"),
    kind: requireKind(kindRaw),
    because: requireValue(because, "--because"),
    choseInstead,
    again,
  };
}

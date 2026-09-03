import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

// Mirrors src/ledger/writer.ts's own RUN_ID validator character-for-character.
// Duplicated rather than imported: this task must not touch src/ledger/**,
// and the decision of what a legal run id looks like belongs to this module
// (spec §2.1 leaves allocation entirely to subsystem C). A taskId comes from
// a plan file and is only constrained to be a non-empty string — one
// containing a slash, a space, or a leading dot would otherwise produce a
// run id the ledger writer's appendEvent rejects, and it would fail far from
// here, on the first decision this run tries to record. Rejecting loudly at
// allocation time, rather than sanitising the taskId into something else,
// keeps the run id an honest reflection of the task it names.
const TASK_ID_SAFE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Pure derivation of a run id from a task id, a contract's bytes, and the
 * base commit the run starts from. Same three inputs, always the same
 * output — no I/O, no randomness. This is the half of run-id allocation
 * that "the same contract and base derive the same id" can be measured
 * against; it says nothing about collisions with a directory already on
 * disk, which is allocateRunId's job below.
 *
 * Shape: `orca-<taskId>-<hash8>`, spec §2.1. hash8 is derived from the
 * contract file's bytes plus the base commit, not from the taskId alone —
 * two tasks with the same id at different points in the plan's history (a
 * retried task, a rerun against a new base) must not collide just because
 * they share a name.
 */
export function deriveRunId(taskId: string, contractBytes: Buffer, baseCommit: string): string {
  if (!TASK_ID_SAFE.test(taskId)) {
    throw new Error(
      `orca: task id ${JSON.stringify(taskId)} would produce a run id the ledger writer rejects ` +
        `(must match ${TASK_ID_SAFE})`,
    );
  }

  // A null-byte separator between the contract bytes and the base commit
  // string keeps the two inputs from being hash-ambiguous with each other
  // (contract bytes ending in what would otherwise look like the start of
  // the base commit string, or vice versa).
  const hash = createHash("sha256");
  hash.update(contractBytes);
  hash.update(Buffer.from([0]));
  hash.update(baseCommit, "utf8");
  const hash8 = hash.digest("hex").slice(0, 8);

  return `orca-${taskId}-${hash8}`;
}

/**
 * Claims a fresh, on-disk run directory under runsDir. This is what the A'
 * ledger design's "conflicts are structurally impossible" guarantee (spec
 * §3.1) rests on: every agent writes only its own `.decisions/<run-id>.jsonl`,
 * and that only holds if run ids never collide. `mkdir` (non-recursive) is
 * the arbiter — atomic on every platform node runs on, and non-recursive on
 * purpose: a recursive mkdir succeeds against a directory that already
 * exists, which would silently hand out a colliding id. No database, lock
 * file, or `.claims/` sidecar directory is introduced (spec §2.2.1 measured
 * that ccloop's own `ensureFreshRunDir` is itself a recursive mkdir that does
 * not reject an existing empty directory — so this function claiming the
 * directory first does not fight it).
 *
 * `EEXIST` covers two situations at once, deliberately treated the same way:
 * the id was already taken earlier in this same round, or an earlier round
 * died and left a directory with data in it (e.g. a stray loop-state.json).
 * Either way the correct move is to step past it — try `-2`, `-3`, and so
 * on — never to reuse or clean up a directory this call did not create.
 */
export async function allocateRunId(
  runsDir: string,
  taskId: string,
  contractBytes: Buffer,
  baseCommit: string,
): Promise<string> {
  const base = deriveRunId(taskId, contractBytes, baseCommit);

  for (let attempt = 1; ; attempt++) {
    const candidate = attempt === 1 ? base : `${base}-${attempt}`;
    try {
      await mkdir(join(runsDir, candidate));
      return candidate;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") continue;
      throw err;
    }
  }
}

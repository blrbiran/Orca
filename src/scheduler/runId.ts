import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { RUN_ID } from "../ledger/writer.js";

// Shared, not mirrored, with src/ledger/writer.ts's own run-id validator
// (fix round 1: a hand-copied regex across a module boundary can drift out
// of sync with nothing going red — precisely the failure mode a preceding
// round in this repository collapsed for the reference-event name list). A
// taskId comes from a plan file and is only constrained to be a non-empty
// string — one containing a slash, a space, or a leading dot would otherwise
// produce a run id the ledger writer's appendEvent rejects, and it would
// fail far from here, on the first decision this run tries to record.
// Rejecting loudly at allocation time, rather than sanitising the taskId
// into something else, keeps the run id an honest reflection of the task it
// names.
const TASK_ID_SAFE = RUN_ID;

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
 *
 * ⚠️ ADDENDUM (2026-09-07, subsystem E): this function has a second caller
 * that is not a scheduled task — src/corrections/fields.ts derives a fix run
 * id as deriveRunId("fix", <the correction row's canonical JSON>, <the
 * correction id>). It passes a correction row where the doc above says
 * "contract bytes" and a correction id where it says "base commit". Nothing
 * about the behaviour changes; the shape and the guarantee ("same three
 * inputs, same output") are exactly what that caller wants. It does NOT go
 * through allocateRunId, so the EEXIST → -2/-3 escalation does not apply to
 * it: two colliding corrections would land two `<run>/1` decisions in one
 * file, which appendEvents' Check B refuses loudly (spec §14.16).
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

// Rule 12 ("fail loud"): termination is guaranteed in every realistic case,
// but an unbounded retry loop leaves one failure mode open that is worse than
// a thrown error — a silent hang. If something pathological (a permissions
// problem a platform happens to report as EEXIST, say) made every mkdir in
// runsDir fail, the process would spin forever with no output. This cap is
// generous enough to never be hit by the actual collision case (a same-round
// retry or a single crashed directory) and exists only to convert that
// pathological case into a named, visible error instead of a hang.
const MAX_ALLOCATE_ATTEMPTS = 1000;

export async function allocateRunId(
  runsDir: string,
  taskId: string,
  contractBytes: Buffer,
  baseCommit: string,
): Promise<string> {
  const base = deriveRunId(taskId, contractBytes, baseCommit);

  for (let attempt = 1; attempt <= MAX_ALLOCATE_ATTEMPTS; attempt++) {
    const candidate = attempt === 1 ? base : `${base}-${attempt}`;
    try {
      await mkdir(join(runsDir, candidate));
      return candidate;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") continue;
      throw err;
    }
  }

  throw new Error(
    `orca: could not allocate a run id under ${JSON.stringify(runsDir)} after ` +
      `${MAX_ALLOCATE_ATTEMPTS} attempts (last candidate: ${base}-${MAX_ALLOCATE_ATTEMPTS})`,
  );
}

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { deriveRows, derivePendingRows } from "../corrections/derive.js";
import { deriveFixRunId } from "../corrections/fields.js";
import type { DecisionEvent, OverturnedEvent } from "../ledger/schema.js";
import { appendEvents } from "../ledger/writer.js";
import { git } from "../scheduler/gitExec.js";
import { correctionClosedAtRef } from "./correctionState.js";
import { readDebugMark, type ClosingRecord } from "./debugChecks.js";
import type { DebugInputV1 } from "./debugInput.js";
import { savedReport } from "./executionDriver.js";
import { integrationTargetRef } from "./ledgerAtRef.js";
import { readGroup } from "./queries.js";
import { reportedDebugOf, type DebugResult } from "./reportedDecisions.js";
import { readCanonicalRecord } from "./snapshot.js";
import type { ControlStore } from "./store.js";
import { QUIET_GIT } from "./workspace.js";

/**
 * Debug-task design §5, §12.5, §12.6 / plan Task 9: a debug run's landing commit carries the rows that close its
 * correction. This writes them into the landing's `.decisions/` (the landing base's ledger, so check 5 sees the original
 * decision) and answers what it did; the caller stages the record and adds the file to the commit.
 */

/** Ruling 2: what the debug agent reported; an absent or malformed value is no value (the landing only needs `choseInstead`). */
export async function readDebugResult(store: ControlStore, runId: string): Promise<DebugResult> {
  const reported = reportedDebugOf(await savedReport(store, runId));
  return reported.kind === "object" ? reported.value : {};
}

/** Whether `<decisionsDir>/<fixRunId>.jsonl` already holds the closing decision `<fixRunId>/1`; an absent file holds nothing. */
async function landingTreeHolds(decisionsDir: string, fixRunId: string): Promise<boolean> {
  let text: string;
  try { text = await readFile(join(decisionsDir, `${fixRunId}.jsonl`), "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
  return text.split("\n").some((line) => {
    try {
      const row = JSON.parse(line) as { ev?: unknown; id?: unknown };
      return row.ev === "decision" && row.id === `${fixRunId}/1`;
    } catch { return false; }
  });
}

export async function writeDebugClosing(input: {
  store: ControlStore; run: { runId: string; groupId: string }; repo: string; decisionsDir: string;
  /** The commit the landing is made on (stepD's tip, the reconciliation's `old`): named when its tree already holds the rows. */
  base: string; attemptSha: string; now: () => Date;
}): Promise<{ written: string | null; record: ClosingRecord }> {
  const { store, run, repo, decisionsDir, attemptSha } = input;
  const mark = readDebugMark(readGroup(store, run.groupId));
  if (mark === null) throw new Error(`writeDebugClosing: group ${run.groupId} carries no debug mark`);
  // Ruling 3: the correction and its target come from the input frozen at open, never a fresh read.
  const frozen = JSON.parse(readCanonicalRecord(store, mark.inputHash)) as DebugInputV1;
  const { correction } = frozen;
  const { id: _id, ...row } = correction;
  const fixRunId = deriveFixRunId(row, correction.id);
  const none = (record: ClosingRecord) => ({ written: null, record });

  // Ruling C1: closed by hand first means the landing's own tree or the integration target holds the closing row. A
  // debug group's own branch (`orca/debug-<id>*`, an archived earlier group's included) never counts: it is not read.
  if (await landingTreeHolds(decisionsDir, fixRunId)) return none({ state: "closed-by-human-first", commit: input.base });
  // As the open verb (debugGroup.ts prepare): a group integrated under `keep` names no target, so HEAD stands for it.
  const ref = (await integrationTargetRef(store, run.groupId)) ?? "HEAD";
  if (await correctionClosedAtRef(repo, ref, correction.id, fixRunId)) {
    return none({ state: "closed-by-human-first", commit: (await git(repo, [...QUIET_GIT, "rev-parse", `${ref}^{commit}`])).trim() });
  }

  // §5 / §12.5: the human's values when given; otherwise the agent's chose_instead and Orca's revert of the attempt.
  const agentChose = correction.chose_instead === undefined ? (await readDebugResult(store, run.runId)).choseInstead : undefined;
  const choseInstead = correction.chose_instead ?? agentChose;
  if (choseInstead === undefined) return none({ state: "chose-instead-missing" });
  const authored = {
    choseInstead: correction.chose_instead === undefined ? "agent" as const : "human" as const,
    undoHow: mark.undoHow === null ? "orca" as const : "human" as const,
  };
  const undo = { how: mark.undoHow ?? `git revert --no-edit ${attemptSha}` };
  const at = input.now().toISOString();

  let rows: Array<DecisionEvent | OverturnedEvent>;
  if (frozen.decision !== null) {
    const { decision, overturned } = deriveRows({ correction, original: frozen.decision, choseInstead, undo, at, runId: fixRunId, authored });
    rows = [decision, overturned];
  } else if (frozen.pending !== null) {
    rows = [derivePendingRows({ correction, pending: frozen.pending, choseInstead, undo, at, runId: fixRunId, authored }).decision];
  } else {
    throw new Error(`writeDebugClosing: the frozen input of ${correction.id} names neither a decision nor a pending entry`);
  }

  // Straight to the writer, not writeRunLedger: closing rows are Orca's and never become pending items. A refusal (the
  // gate on a human's undo.how, check 5) leaves the correction open and the landing goes on without the file.
  try { await appendEvents(decisionsDir, fixRunId, rows); }
  catch (error) { return none({ state: "refused", reason: error instanceof Error ? error.message : String(error) }); }
  return { written: `${fixRunId}.jsonl`, record: { state: "written", relPath: `.decisions/${fixRunId}.jsonl`, fixRunId } };
}

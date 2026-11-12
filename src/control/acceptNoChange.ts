import type { AdmissionGate } from "./admissionGate.js";
import { writeArtifact } from "./archive.js";
import { applyWebCommand } from "./commandLedger.js";
import { commandPrincipalFor } from "./commandClient.js";
import { ControlError } from "./errors.js";
import { completeNoChangeInTransaction, type NoChangeCompletion } from "./noChange.js";
import { reopenEligibility } from "./reopenTask.js";
import { commandSuccess, groupCommandTarget } from "./stopIntent.js";
import type { ControlStore } from "./store.js";
import type { ArtifactRef } from "./types.js";
import type { CommandErrorBodyV1, CommandSuccessV1, RawAuthorityCommandV1 } from "./webProtocol.js";

/**
 * Tester follow-up G spec §10.1: a task stopped as a provable no change (no change twice, the goal judge unfunded or
 * failed, its re-run not startable) is accepted as done by a person or an orchestrating agent, with why. The proof is the
 * run's own no-change proof (acceptanceEvidence binds it), naming who decided.
 */
export type AcceptNoChangeCommand = Extract<RawAuthorityCommandV1, { verb: "accept-no-change" }>;

/** Who decides, as the record names it: an orchestrating agent by its principal, anyone else as a person. */
const decidedByOf = (command: AcceptNoChangeCommand): NoChangeCompletion["decidedBy"] => {
  const principal = commandPrincipalFor(command.commandId);
  return principal?.startsWith("agent:") ? principal as `agent:${string}` : "person";
};

/** Before the transaction (artifacts are written asynchronously): the acceptance proof, or null when the run has none. */
export async function writeAcceptNoChangeProof(store: ControlStore, command: AcceptNoChangeCommand): Promise<ArtifactRef | null> {
  const { runId, note } = command.payload;
  const row = store.db.prepare("SELECT body FROM runs WHERE id=?").get(runId);
  const noChange = row === undefined ? null : (JSON.parse(String(row.body)) as { drive?: { noChange?: { attempt: string } | null } }).drive?.noChange ?? null;
  if (noChange === null) return null;
  return writeArtifact(store, `acceptance-${runId}-${command.commandId}`, Buffer.from(JSON.stringify({ runId, checksPassed: true, landing: "no-change", commit: noChange.attempt, noChange,
    decidedBy: decidedByOf(command), note, intent: `accept-no-change:${command.commandId}` })));
}

export function applyAcceptNoChange(deps: { store: ControlStore; admissionGate?: AdmissionGate }, command: AcceptNoChangeCommand, source: ArtifactRef | null): CommandSuccessV1 | CommandErrorBodyV1 {
  const release = deps.admissionGate?.enter();
  try {
    return applyWebCommand<CommandSuccessV1 | CommandErrorBodyV1>(deps.store, {
      rawCommand: command,
      expand: () => ({ ...command, schema: "orca-authority-command-v1" }),
      apply: (context) => {
        const groupId = groupCommandTarget(command);
        const { taskId, runId, note } = command.payload;
        const eligibility = reopenEligibility(deps.store, groupId, taskId, runId);
        if (eligibility !== "blocked") throw new ControlError("no-change-not-acceptable", eligibility === "completed" ? "already-done" : eligibility);
        if (source === null) throw new ControlError("no-change-not-acceptable", "not-no-change");
        deps.store.db.prepare("INSERT INTO outbox VALUES (?, 'acceptance', ?, 1) ON CONFLICT(id) DO UPDATE SET body=excluded.body").run(`acceptance:${runId}`, JSON.stringify({ runId, accepted: true, source }));
        completeNoChangeInTransaction(deps.store, { groupId, taskId, runId, decidedBy: decidedByOf(command), explanation: null, note });
        return commandSuccess(context, { kind: "no-change-accepted", taskId, runId });
      },
    }).body;
  } finally { release?.(); }
}

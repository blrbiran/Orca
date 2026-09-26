import { applyWebCommand } from "./commandLedger.js";
import { canonicalBytes } from "./canonicalJson.js";
import { ControlError } from "./errors.js";
import type { AdmissionGate } from "./admissionGate.js";
import type { OperatorPreferences } from "./agentSelection.js";
import type { ControlStore } from "./store.js";
import { operatorPreferencesSchema, type CommandErrorBodyV1, type CommandSuccessV1, type RawAuthorityCommandV1 } from "./webProtocol.js";

export type SetAgentPreferencesCommand = Extract<RawAuthorityCommandV1, { verb: "set-agent-preferences" }>;
export interface StoredAgentPreferences { preferences: OperatorPreferences; revision: number }

/** Agent selection spec §6.2 layer 1: no row is the empty document at revision 0. A row that is not canonical is refused. */
export function readAgentPreferences(store: ControlStore, operatorId: string): StoredAgentPreferences {
  const row = store.db.prepare("SELECT revision,doc_json FROM agent_preferences WHERE operator_id=?").get(operatorId);
  if (!row) return { preferences: { perAgent: {} }, revision: 0 };
  const text = String(row.doc_json);
  let parsed: ReturnType<typeof operatorPreferencesSchema.safeParse>;
  try { parsed = operatorPreferencesSchema.safeParse(JSON.parse(text)); }
  catch { throw new ControlError("recovery-blocked", "agent-preferences-invalid"); }
  const revision = Number(row.revision);
  if (!parsed.success || canonicalBytes(parsed.data).toString("utf8") !== text || !Number.isSafeInteger(revision) || revision <= 0) {
    throw new ControlError("recovery-blocked", "agent-preferences-invalid");
  }
  return { preferences: parsed.data as OperatorPreferences, revision };
}

/**
 * Spec §6.2 / §12 I10: the operator's own setting, under its own revision (the ledger's `operator` scope).
 * It moves no group revision and no projection; identity is an interface for now (spec §2), so an actor may
 * set only the preferences keyed by its own id.
 */
export function applySetAgentPreferences(
  deps: { store: ControlStore; admissionGate?: AdmissionGate },
  command: SetAgentPreferencesCommand,
): CommandSuccessV1 | CommandErrorBodyV1 {
  const release = deps.admissionGate?.enter();
  try {
    return applyWebCommand<CommandSuccessV1 | CommandErrorBodyV1>(deps.store, {
      rawCommand: command,
      expand: () => ({ ...command, schema: "orca-authority-command-v1" }),
      authorityChanged: false,
      projectionGroupIds: [],
      apply: (context) => {
        const target = context.rawCommand.target;
        if (target.kind !== "operator" || target.operatorId !== context.rawCommand.actorId) throw new ControlError("control-target-not-allowed");
        const payload = context.effectiveCommand.payload as { preferences: OperatorPreferences };
        const docJson = canonicalBytes(payload.preferences).toString("utf8");
        if (canonicalBytes(readAgentPreferences(deps.store, target.operatorId).preferences).toString("utf8") === docJson) throw new ControlError("no-op-command");
        deps.store.db.prepare("INSERT INTO agent_preferences(operator_id,revision,doc_json) VALUES (?,?,?) ON CONFLICT(operator_id) DO UPDATE SET revision=excluded.revision,doc_json=excluded.doc_json")
          .run(target.operatorId, context.nextCommandRevision, docJson);
        return { status: 200, body: {
          schema: "orca-command-success-v1", commandId: context.rawCommand.commandId, actorId: context.rawCommand.actorId,
          verb: context.rawCommand.verb, target: context.rawCommand.target, commandRevision: context.nextCommandRevision, projectionSeq: null,
          effectivePayloadHash: context.effectivePayloadHash, authorityCommandHash: context.authorityCommandHash,
          result: { kind: "agent-preferences-set", operatorId: target.operatorId, revision: context.nextCommandRevision },
        } };
      },
    }).body;
  } finally { release?.(); }
}

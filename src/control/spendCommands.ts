import { applyWebCommand } from "./commandLedger.js";
import { commandPrincipalFor } from "./commandClient.js";
import { ControlError } from "./errors.js";
import type { AdmissionGate } from "./admissionGate.js";
import type { ControlStore } from "./store.js";
import type { CommandErrorBodyV1, CommandSuccessV1, RawAuthorityCommandV1 } from "./webProtocol.js";

export type SpendCommand = Extract<RawAuthorityCommandV1, { verb: "set-spend-cap" | "clear-spend-cap" | "set-usage-calendar" }>;

/**
 * Accounts spec §6.1, D5, D6: set or clear a spend cap, or set the usage calendar, under the spend scope's own revision
 * (spend_settings). It moves no group revision and no projection; the command ledger records the verb, payload and
 * principal, and the cap row names who set it.
 */
export function applySpendCommand(
  deps: { store: ControlStore; admissionGate?: AdmissionGate; now?: () => Date },
  command: SpendCommand,
): CommandSuccessV1 | CommandErrorBodyV1 {
  const release = deps.admissionGate?.enter();
  try {
    return applyWebCommand<CommandSuccessV1 | CommandErrorBodyV1>(deps.store, {
      rawCommand: command,
      expand: () => ({ ...command, schema: "orca-authority-command-v1" }),
      authorityChanged: false,
      projectionGroupIds: [],
      apply: (context) => {
        const raw = context.rawCommand;
        if (raw.target.kind !== "spend") throw new ControlError("control-target-not-allowed");
        const db = deps.store.db;
        let kind: "spend-cap-set" | "spend-cap-cleared" | "usage-calendar-set";
        if (raw.verb === "set-spend-cap") {
          const { scope, period, tokens } = raw.payload;
          const prior = db.prepare("SELECT tokens FROM spend_caps WHERE scope=? AND period=?").get(scope, period);
          if (prior && Number(prior.tokens) === tokens) throw new ControlError("no-op-command");
          db.prepare("INSERT INTO spend_caps(scope,period,tokens,updated_at,updated_by) VALUES (?,?,?,?,?) ON CONFLICT(scope,period) DO UPDATE SET tokens=excluded.tokens,updated_at=excluded.updated_at,updated_by=excluded.updated_by")
            .run(scope, period, tokens, (deps.now?.() ?? new Date()).getTime(), commandPrincipalFor(raw.commandId) ?? raw.actorId);
          kind = "spend-cap-set";
        } else if (raw.verb === "clear-spend-cap") {
          if (Number(db.prepare("DELETE FROM spend_caps WHERE scope=? AND period=?").run(raw.payload.scope, raw.payload.period).changes) === 0) throw new ControlError("no-op-command");
          kind = "spend-cap-cleared";
        } else if (raw.verb === "set-usage-calendar") {
          // Compared with the stored row, not the host default: setting the default explicitly pins it.
          const prior = db.prepare("SELECT time_zone,week_start FROM usage_calendar WHERE singleton=1").get();
          if (prior && String(prior.time_zone) === raw.payload.timeZone && Number(prior.week_start) === raw.payload.weekStart) throw new ControlError("no-op-command");
          db.prepare("INSERT INTO usage_calendar(singleton,time_zone,week_start) VALUES (1,?,?) ON CONFLICT(singleton) DO UPDATE SET time_zone=excluded.time_zone,week_start=excluded.week_start")
            .run(raw.payload.timeZone, raw.payload.weekStart);
          kind = "usage-calendar-set";
        } else throw new ControlError("control-target-not-allowed");
        db.prepare("INSERT INTO spend_settings(singleton,revision) VALUES (1,?) ON CONFLICT(singleton) DO UPDATE SET revision=excluded.revision")
          .run(context.nextCommandRevision);
        return { status: 200, body: {
          schema: "orca-command-success-v1", commandId: raw.commandId, actorId: raw.actorId,
          verb: raw.verb, target: raw.target, commandRevision: context.nextCommandRevision, projectionSeq: null,
          effectivePayloadHash: context.effectivePayloadHash, authorityCommandHash: context.authorityCommandHash,
          result: { kind, revision: context.nextCommandRevision },
        } };
      },
    }).body;
  } finally { release?.(); }
}

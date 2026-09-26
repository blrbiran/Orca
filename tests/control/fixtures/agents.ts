import { vi } from "vitest";
import { applySetAgentPreferences, readAgentPreferences } from "../../../src/control/agentPreferences.js";
import type { AgentResolution, OperatorPreferences, PartialSelection } from "../../../src/control/agentSelection.js";
import { canonicalBytes, sha256Canonical } from "../../../src/control/canonicalJson.js";
import { ControlError } from "../../../src/control/errors.js";
import type { ControlStore } from "../../../src/control/store.js";
import type { CapabilityViewV1 } from "../../../src/control/webProtocol.js";

/**
 * Agent selection spec §6.2 layer 1. The installation id the Web fixtures' ports answer for by default
 * (web.ts `FIXTURE_AGENT.agent`); named `_ID` so it never shadows web.ts's complete `FIXTURE_AGENT` selection.
 */
export const FIXTURE_AGENT_ID = "codex";
/** Agent selection plan T11: a second installation the fixture ports know, so a criterion can tell two selections apart. */
export const FIXTURE_OTHER_AGENT_ID = "claude";
/** Each known installation's descriptor default model; an id not here is refused as ccloop refuses one not in its table. */
const FIXTURE_DEFAULT_MODELS: Record<string, string> = { [FIXTURE_AGENT_ID]: "fixture-model", [FIXTURE_OTHER_AGENT_ID]: "fixture-claude-model" };

/**
 * A stand-in for ccloop's capabilities-v3 resolution (spec §4.6), as a mock a criterion can inspect or re-implement:
 * requested fields are echoed, the rest are the installation's defaults (no agent: the fixture agent), and an unknown
 * installation is refused by ccloop's own code. The capabilities are whatever `capabilities()` answers at call time.
 */
export function fixtureResolveAgent(capabilities: () => CapabilityViewV1, options: { killGraceMs?: number } = {}) {
  return vi.fn(async (partial: PartialSelection): Promise<AgentResolution> => {
    const agent = partial.agent ?? FIXTURE_AGENT_ID;
    if (!Object.hasOwn(FIXTURE_DEFAULT_MODELS, agent)) throw new ControlError("agent-installation-missing", agent);
    return {
      selection: { agent, model: partial.model ?? FIXTURE_DEFAULT_MODELS[agent]!, contextWindow: partial.contextWindow ?? "agent-default" },
      configHash: sha256Canonical({}), timeoutMs: 120_000, killGraceMs: options.killGraceMs ?? 5_000, capabilities: capabilities(),
    };
  });
}

/** Sets `operatorId`'s preferences through the real command (and its ledger row), as the panel would. */
export function seedPreferences(store: ControlStore, operatorId: string, preferences: OperatorPreferences, expectedRevision = 0): void {
  const result = applySetAgentPreferences({ store }, {
    schema: "orca-raw-command-v1", commandId: `seed-preferences-${expectedRevision}`, expectedRevision, actorId: operatorId,
    verb: "set-agent-preferences", target: { kind: "operator", operatorId }, payload: { preferences },
  });
  if ("error" in result) throw new Error(`preferences refused: ${JSON.stringify(result.error)}`);
}

/**
 * The same preferences row `seedPreferences` would leave, written without a command -- only for criteria that count
 * every row of the command ledger, where the seeding command would be one more. `readAgentPreferences` still
 * validates it on every read, so a row this writes that the product would not is refused, not trusted.
 */
export function writePreferencesRow(store: ControlStore, operatorId: string, preferences: OperatorPreferences): void {
  store.db.prepare("INSERT INTO agent_preferences(operator_id,revision,doc_json) VALUES (?,1,?)").run(operatorId, canonicalBytes(preferences).toString("utf8"));
}

/** The panel operator every mutation route acts as (controlApi.ts: meta.panelOperatorId), fixed so it can be given preferences. */
export const PANEL_OPERATOR = "operator-00000000-0000-4000-8000-000000000000";

/**
 * Fixes the panel's operator id before the mutation routes mint a random one, and gives that operator `preferences`
 * unless it already has some (a panel rebooted on the same state keeps both).
 */
export function seedPanelOperator(store: ControlStore, preferences: OperatorPreferences): void {
  store.db.prepare("INSERT INTO meta(key,value) VALUES ('panelOperatorId',?) ON CONFLICT(key) DO NOTHING").run(PANEL_OPERATOR);
  if (readAgentPreferences(store, PANEL_OPERATOR).revision === 0) seedPreferences(store, PANEL_OPERATOR, preferences);
}

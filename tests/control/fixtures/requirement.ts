import { sha256Canonical } from "../../../src/control/canonicalJson.js";
import { REQUIREMENT_LIMIT_DEFAULT } from "../../../src/control/requirementSchemas.js";
import type { ClarifyingGroupInput } from "../../../src/control/requirementRecords.js";
import type { FrozenSlot } from "../../../src/control/agentSelection.js";
import { fixtureAgent, caps } from "./store.js";

export { REQUIREMENT_LIMIT_DEFAULT };
/** A frozen estimator slot as estimatorSlotFor would freeze it for the fixture agent (agent selection spec §6.4). configHash is a real 64-hex hash (PR-I9). */
export const FIXTURE_SLOT: FrozenSlot = {
  selection: fixtureAgent, configHash: sha256Canonical({}), timeoutMs: 120_000, killGraceMs: 5_000, capabilities: caps,
  partial: { agent: "codex" }, provenance: { agent: "operator", model: "descriptor", contextWindow: "descriptor" },
} as unknown as FrozenSlot;
/** N1 spec §4.1: what requirement-open writes, for criteria that start from a clarifying group. */
export function clarifyingInput(groupId: string, overrides: Partial<ClarifyingGroupInput> = {}): ClarifyingGroupInput {
  return {
    groupId, repoId: "repo", idea: "Let people export their notes as Markdown.", limit: { ...REQUIREMENT_LIMIT_DEFAULT },
    contentLanguage: "en", createdOn: "2026-10-02", requirementId: "0123456789abcdef0123456789abcdef",
    profile: { profileId: "all", profileHash: "b".repeat(64) }, agentSlot: FIXTURE_SLOT, agentOverrides: {}, maxOutputTokens: 64_000, ...overrides,
  };
}

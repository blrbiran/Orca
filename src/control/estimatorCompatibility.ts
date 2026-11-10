import { ESTIMATE_INSTRUCTIONS } from "./estimatePrompt.js";
import type { AgentResolution } from "./agentSelection.js";
import type { ExecutionPort } from "./executionPort.js";
import { intersectCapabilities, type ObservedProfile } from "./profiles.js";

export type EstimatorMode = "strict" | "soft";
export type EstimatorCompatibilityReason =
  | "selection-unavailable" | "single-call-unavailable" | "preflight-unavailable" | "instruction-unknown"
  | "context-unavailable" | "context-unreported" | "usage-unavailable" | "budget-unavailable" | "handoff-unavailable" | "request-bound-unavailable"
  | `model-not-in-catalog: ${string}`;

/** At most this many listed models are named in a `model-not-in-catalog` reason; more are counted. */
const LISTED_NAMED = 12;

/**
 * Issue #124 (session 3cfc2e73): ccloop answers a codex single call and a context window only for a model its catalog
 * lists, so a codex resolution with neither is either a model the catalog does not list or a catalog that was not read
 * (#105). When ccloop's catalog view for the installation was read (source cache or probe) and lists models, but not the
 * chosen one, this names the model and the list; otherwise null and the capability codes stand. A catalog that cannot be
 * read stays not a refusal of its own (ccloop materialize.ts, plan issue 5).
 */
export async function catalogMissOf(port: Pick<ExecutionPort, "listModels">, resolution: AgentResolution | null): Promise<{ model: string; listed: string[] } | null> {
  if (resolution === null || resolution.singleCallExecution !== null || resolution.capabilities.contextWindowTokens !== null) return null;
  return selectorMissOf(port, resolution.selection);
}

/**
 * Issue #236: ccloop resolves a codex single call by the exact catalog selector (ccloop materialize.ts), so a requirement's
 * frozen selector that the read catalog no longer lists can only be refused at accept (single-call-unsupported). This
 * asks the catalog directly, whatever the resolution says: a read codex catalog that lists models but not this one names
 * it and the list; a catalog that was not or could not be read, or another kind, is null -- not a refusal (#124).
 */
export async function selectorMissOf(port: Pick<ExecutionPort, "listModels">, selection: { agent: string; model: string }): Promise<{ model: string; listed: string[] } | null> {
  if (port.listModels === undefined) return null;
  let view: Awaited<ReturnType<NonNullable<ExecutionPort["listModels"]>>>;
  try { view = await port.listModels(selection.agent, false); } catch { return null; }
  if (view.kind !== "codex" || view.source === "none" || view.models.length === 0) return null;
  if (view.models.some((entry) => entry.model === selection.model)) return null;
  return { model: selection.model, listed: view.models.map((entry) => entry.model) };
}

/** `<model> (listed: a b ... and N more)`: the miss in the words every path names it with. */
export const catalogMissText = (miss: { model: string; listed: string[] }): string => {
  const named = miss.listed.slice(0, LISTED_NAMED).join(" ");
  const more = miss.listed.length > LISTED_NAMED ? ` and ${miss.listed.length - LISTED_NAMED} more` : "";
  return `${miss.model} (listed: ${named}${more})`;
};

/** Issue #209: also the worker slots' refusal code (agentFreeze.ts), so both paths name the miss in the same words. */
export const catalogMissReason = (miss: { model: string; listed: string[] }): EstimatorCompatibilityReason => `model-not-in-catalog: ${catalogMissText(miss)}`;

/** Issue #236: the reason a requirement call is blocked with when its frozen selector left the catalog. */
export const SELECTOR_MISS_PREFIX = "agent-selection-invalid:";

const ACCEPT_UNSUPPORTED = /^accept-refused:[^:]*:single-call-unsupported(?=$|:|\s)/;
/**
 * Issue #236: a requirement call blocked because its frozen agent cannot run it -- Orca's catalog check at A2 named the
 * selector, or ccloop refused the call at accept before writing anything (exit 2) with `single-call-unsupported`. The one
 * test requirement-set-agent closes such a call by, and the views name that verb by (plan follow-up B, T10).
 */
export function blockedOnRequirementAgent(blockedAt: string | null | undefined, reason: string | null | undefined): boolean {
  const text = reason ?? "";
  return (blockedAt === "A2" && text.startsWith(SELECTOR_MISS_PREFIX)) || (blockedAt === "B" && ACCEPT_UNSUPPORTED.test(text));
}

/** One predicate for every required single-call action, evaluated against the chosen resolution only. */
export function estimatorCompatibility(
  resolution: Pick<ObservedProfile, "profile" | "observed" | "probeFailureCode" | "resolution" | "catalogMiss">,
  mode: EstimatorMode,
): { compatible: boolean; reasonCodes: EstimatorCompatibilityReason[] } {
  const reasons: EstimatorCompatibilityReason[] = [];
  if (resolution.probeFailureCode !== null || resolution.resolution === null) reasons.push("selection-unavailable");
  // Issue #124: a model the read catalog does not list is named once, in place of the single-call and context codes it causes.
  const miss = resolution.catalogMiss ?? null;
  if (miss !== null) reasons.push(catalogMissReason(miss));
  // Spec 2026-10-15 §6.2 (R2): strict requires "v1"; soft also accepts "v1-soft", whose output bound is checked after the fact.
  const execution = resolution.resolution?.singleCallExecution;
  if (miss === null && !(execution === "v1" || (mode === "soft" && execution === "v1-soft"))) reasons.push("single-call-unavailable");
  const preflight = resolution.profile.snapshot.profile.estimatorPreflight;
  if (!preflight) reasons.push("preflight-unavailable");
  else if (!Object.hasOwn(ESTIMATE_INSTRUCTIONS, preflight.instructionVersion)) reasons.push("instruction-unknown");
  const capabilities = intersectCapabilities(resolution.profile.snapshot.profile.capabilities, resolution.observed);
  // #105: ccloop answers a codex single call only for a catalog row it found (ccloop src/agents/codex.ts), so a null window
  // beside a single call is a listed model the catalog gives no window for -- what an installation's declaredContextWindow
  // fills (ccloop spec 2026-10-21) -- and a null window without one is a model the catalog does not list (or not read).
  if (miss === null && capabilities.contextWindowTokens === null) reasons.push((resolution.resolution?.singleCallExecution ?? null) === null ? "context-unavailable" : "context-unreported");
  if (capabilities.usageObservation === "unavailable") reasons.push("usage-unavailable");
  if (capabilities.budgetEnforcement === "unavailable" || (mode === "strict" && capabilities.budgetEnforcement !== "bounded")) reasons.push("budget-unavailable");
  if (capabilities.handoffControl !== "durable" || capabilities.handoffExecution === null) reasons.push("handoff-unavailable");
  if (mode === "strict" && !capabilities.requestBoundProof?.workDimensions.includes("tokens")) reasons.push("request-bound-unavailable");
  return { compatible: reasons.length === 0, reasonCodes: reasons };
}

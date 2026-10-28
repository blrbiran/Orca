import { ESTIMATE_INSTRUCTIONS } from "./estimatePrompt.js";
import { intersectCapabilities, type ObservedProfile } from "./profiles.js";

export type EstimatorMode = "strict" | "soft";
export type EstimatorCompatibilityReason =
  | "selection-unavailable" | "single-call-unavailable" | "preflight-unavailable" | "instruction-unknown"
  | "context-unavailable" | "context-unreported" | "usage-unavailable" | "budget-unavailable" | "handoff-unavailable" | "request-bound-unavailable";

/** One predicate for every required single-call action, evaluated against the chosen resolution only. */
export function estimatorCompatibility(
  resolution: Pick<ObservedProfile, "profile" | "observed" | "probeFailureCode" | "resolution">,
  mode: EstimatorMode,
): { compatible: boolean; reasonCodes: EstimatorCompatibilityReason[] } {
  const reasons: EstimatorCompatibilityReason[] = [];
  if (resolution.probeFailureCode !== null || resolution.resolution === null) reasons.push("selection-unavailable");
  // Spec 2026-10-15 §6.2 (R2): strict requires "v1"; soft also accepts "v1-soft", whose output bound is checked after the fact.
  const execution = resolution.resolution?.singleCallExecution;
  if (!(execution === "v1" || (mode === "soft" && execution === "v1-soft"))) reasons.push("single-call-unavailable");
  const preflight = resolution.profile.snapshot.profile.estimatorPreflight;
  if (!preflight) reasons.push("preflight-unavailable");
  else if (!Object.hasOwn(ESTIMATE_INSTRUCTIONS, preflight.instructionVersion)) reasons.push("instruction-unknown");
  const capabilities = intersectCapabilities(resolution.profile.snapshot.profile.capabilities, resolution.observed);
  // #105: ccloop answers a codex single call only for a catalog row it found (ccloop src/agents/codex.ts), so a null window
  // beside a single call is a listed model the catalog gives no window for -- what an installation's declaredContextWindow
  // fills (ccloop spec 2026-10-21) -- and a null window without one is a model the catalog does not list (or not read).
  if (capabilities.contextWindowTokens === null) reasons.push((resolution.resolution?.singleCallExecution ?? null) === null ? "context-unavailable" : "context-unreported");
  if (capabilities.usageObservation === "unavailable") reasons.push("usage-unavailable");
  if (capabilities.budgetEnforcement === "unavailable" || (mode === "strict" && capabilities.budgetEnforcement !== "bounded")) reasons.push("budget-unavailable");
  if (capabilities.handoffControl !== "durable" || capabilities.handoffExecution === null) reasons.push("handoff-unavailable");
  if (mode === "strict" && !capabilities.requestBoundProof?.workDimensions.includes("tokens")) reasons.push("request-bound-unavailable");
  return { compatible: reasons.length === 0, reasonCodes: reasons };
}

import { ESTIMATE_INSTRUCTIONS } from "./estimatePrompt.js";
import { intersectCapabilities, type ObservedProfile } from "./profiles.js";

export type EstimatorMode = "strict" | "soft";
export type EstimatorCompatibilityReason =
  | "selection-unavailable" | "single-call-unavailable" | "preflight-unavailable" | "instruction-unknown"
  | "context-unavailable" | "usage-unavailable" | "budget-unavailable" | "handoff-unavailable" | "request-bound-unavailable";

/** One predicate for every required single-call action, evaluated against the chosen resolution only. */
export function estimatorCompatibility(
  resolution: Pick<ObservedProfile, "profile" | "observed" | "probeFailureCode" | "resolution">,
  mode: EstimatorMode,
): { compatible: boolean; reasonCodes: EstimatorCompatibilityReason[] } {
  const reasons: EstimatorCompatibilityReason[] = [];
  if (resolution.probeFailureCode !== null || resolution.resolution === null) reasons.push("selection-unavailable");
  if (resolution.resolution?.singleCallExecution !== "v1") reasons.push("single-call-unavailable");
  const preflight = resolution.profile.snapshot.profile.estimatorPreflight;
  if (!preflight) reasons.push("preflight-unavailable");
  else if (!Object.hasOwn(ESTIMATE_INSTRUCTIONS, preflight.instructionVersion)) reasons.push("instruction-unknown");
  const capabilities = intersectCapabilities(resolution.profile.snapshot.profile.capabilities, resolution.observed);
  if (capabilities.contextWindowTokens === null) reasons.push("context-unavailable");
  if (capabilities.usageObservation === "unavailable") reasons.push("usage-unavailable");
  if (capabilities.budgetEnforcement === "unavailable" || (mode === "strict" && capabilities.budgetEnforcement !== "bounded")) reasons.push("budget-unavailable");
  if (capabilities.handoffControl !== "durable" || capabilities.handoffExecution === null) reasons.push("handoff-unavailable");
  if (mode === "strict" && !capabilities.requestBoundProof?.workDimensions.includes("tokens")) reasons.push("request-bound-unavailable");
  return { compatible: reasons.length === 0, reasonCodes: reasons };
}

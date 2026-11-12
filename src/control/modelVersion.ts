/**
 * Tester follow-up G spec §10.5 / §11: one marker on the group body names the model a group was created under. It is
 * stamped once, when the group is created (planImport.ts, the only place a budget proposal is inserted), and never
 * rewritten. A body without it was created before the release: Parts 2 (budget) and 3 (requirement review) keep the
 * rules it was created under.
 */
export const MODEL_VERSION_G = "followup-g" as const;

/** True only when the group body carries `modelVersion: "followup-g"`. */
export function isFollowupG(body: unknown): boolean {
  return typeof body === "object" && body !== null && (body as { modelVersion?: unknown }).modelVersion === MODEL_VERSION_G;
}

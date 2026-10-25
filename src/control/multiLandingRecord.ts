/**
 * Multi-directory projects spec §9.2, §9.3: the landing record and its schema. Kept apart from the pass (multiLanding.ts)
 * so a DB-only reader (groupEdges.ts's done check) does not pull the driver's git and folder machinery into its cycle.
 */
import { z } from "zod";
import { placementSchema } from "./dirGroup.js";
import { ControlError } from "./errors.js";
import { integrationSchemeSchema, type IntegrationScheme } from "./integrationScheme.js";

/** A folder member's scheme: DIR's placement, not an integration scheme. */
const placeScheme = z.object({ delivery: z.literal("place") }).strict();
const landingSchemeSchema = z.union([integrationSchemeSchema, placeScheme]);
export type LandingScheme = z.infer<typeof landingSchemeSchema>;
/** §9.2: what a member's delivery may be. `push-branch` / `github-pr` are refused at accept. */
export type PublishableScheme = Extract<IntegrationScheme, { delivery: "local" | "push-target" }>;
export type CarriedScheme = PublishableScheme | Extract<LandingScheme, { delivery: "place" }>;

const sha = z.string().regex(/^[0-9a-f]{40,64}$/);
export const planEntrySchema = z.object({
  key: z.string().min(1), kind: z.enum(["local", "push-target", "place"]), base: sha, next: sha, tip: sha,
}).strict();
export type MultiPlanEntry = z.infer<typeof planEntrySchema>;

export const landingSchema = z.object({
  delivery: z.array(z.object({ key: z.string().min(1), scheme: landingSchemeSchema }).strict()).superRefine((entries, context) => {
    entries.forEach((entry, index) => {
      if (entry.scheme.delivery === "push-branch" || entry.scheme.delivery === "github-pr") {
        context.addIssue({ code: z.ZodIssueCode.custom, path: [index, "scheme"], message: "multi-dir-delivery-unsupported" });
      }
    });
  }),
  state: z.enum(["idle", "prechecking", "landing", "landed", "partial", "blocked", "folder-changed", "folder-unwritable"]),
  pending: z.object({ plan: z.array(planEntrySchema), landed: z.array(z.string()), startedAt: z.number() }).strict().nullable(),
  lastLanded: z.record(sha),
  reason: z.string().nullable(), detail: z.string().nullable(), failedKey: z.string().nullable(),
  movedBeforeAny: z.union([z.literal(0), z.literal(1)]),
  resolution: z.object({
    action: z.enum(["retry-rest", "mark-resolved"]), by: z.string(), at: z.number(), unlanded: z.array(z.string()).optional(),
  }).strict().nullable(),
  /** §9.8: each `dir` member's DIR §8.2 record, by key. */
  placement: z.record(placementSchema).optional(),
  at: z.number(),
}).strict();
export type MultiLanding = z.infer<typeof landingSchema>;

/** §9.3: a stored landing record, or null when there is none; one that is there but malformed is loud (Rule 12). */
export function readMultiLanding(value: unknown): MultiLanding | null {
  if (value === undefined || value === null) return null;
  const parsed = landingSchema.safeParse(value);
  if (!parsed.success) throw new ControlError("recovery-blocked", `multi-landing-invalid:${parsed.error.issues[0]?.path.join(".") ?? "invalid"}`);
  return parsed.data;
}

/** §9.2: the record accept freezes; `at` is the accept's time. */
export function initialLanding(delivery: ReadonlyArray<{ key: string; scheme: LandingScheme }>, at: number): MultiLanding {
  return landingSchema.parse({
    delivery, state: "idle", pending: null, lastLanded: {}, reason: null, detail: null, failedKey: null, movedBeforeAny: 0, resolution: null, at,
  });
}

export const isCarried = (scheme: LandingScheme): scheme is CarriedScheme =>
  scheme.delivery === "local" || scheme.delivery === "push-target" || scheme.delivery === "place";

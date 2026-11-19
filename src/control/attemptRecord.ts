import { z } from "zod";

/**
 * Change-sized runs spec 2026-11-19 §6.1 (P2; #363 #366), as ccloop P1 built it (ccloop 633534c, `attemptRecord.ts`): how a
 * run's current attempt ended, recorded by ccloop as a commit. collect answers it at the top level iff the envelope carried
 * `work.attemptDelivery: "ref-v1"` and there is a candidate. Mirrored strictly, so a record of another shape refuses the
 * whole answer rather than reaching step C.
 *
 * As built (ccloop protocol Correction, P1 review): `base` is `attempt^` -- the HEAD the attempt was captured on -- and not
 * the run's start base; when the agent committed inside its worktree it is the agent's commit. `head` is the worktree's HEAD
 * at capture for a live capture and the attempt itself for a published one.
 */
const oid = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);
const safe = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const attemptRecordSchema = z.union([
  z.object({
    attempt: safe.refine((n) => n >= 1), sha: oid, base: oid, tree: oid, ref: z.string().regex(/^refs\/ccloop\/[^/]+\/attempts\/\d+$/), head: oid,
    capture: z.enum(["published", "live"]), worktree: z.enum(["removed", "retained"]),
  }).strict(),
  z.object({ attempt: safe, sha: z.null(), reason: z.enum(["not-started", "skills-cleanup-pending", "record-failed"]), detail: z.string().max(512).optional() }).strict(),
]);
export type AttemptRecordV1 = z.infer<typeof attemptRecordSchema>;

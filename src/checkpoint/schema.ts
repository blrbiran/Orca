import { z } from "zod";

export const CHECKPOINT_DIR = ".orca/checkpoints";
/** D-launch spec §6.1: chain records, committed by `orca chain` only. Here so resume can exclude them (review M4). */
export const CHAIN_RECORDS_DIR = ".orca/chains";
export const AWAITING_KINDS = ["irreversible", "tied-evidence", "named-authorization", "ccloop-change"] as const;

const Sha = z.string().regex(/^[0-9a-f]{40}$/);
const Text = z.string().min(1);
const Awaiting = z.object({ kind: z.enum(AWAITING_KINDS), what: Text }).strict();

export const CHAIN_STATUSES = ["continue", "done", "blocked"] as const;
export type ChainStatus = (typeof CHAIN_STATUSES)[number];
const ChainMarkSchema = z.object({ status: z.enum(CHAIN_STATUSES), why: Text }).strict();
export type ChainMark = z.infer<typeof ChainMarkSchema>;

/**
 * D-launch spec §3.1 (review M6): `next` may be empty only when the chain is done, and a blocked chain must name what
 * waits for a human. One function for the draft and the checkpoint, so the two cannot drift.
 */
function chainRules(value: { next: string[]; awaitingHuman: unknown[]; chain?: ChainMark }, ctx: z.RefinementCtx): void {
  if (value.next.length === 0 && value.chain?.status !== "done") {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["next"], message: "must name at least one next step unless chain.status is done" });
  }
  if (value.chain?.status === "blocked" && value.awaitingHuman.length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["awaitingHuman"], message: "must not be empty when chain.status is blocked" });
  }
}

/** What the agent writes: only the judgment (D spec 5 step 2). Everything measurable is filled in by code. */
export const DraftSchema = z
  .object({
    next: z.array(Text),
    open: z.array(Text).default([]),
    awaitingHuman: z.array(Awaiting).default([]),
    measure: z.array(Text).default([]),
    chain: ChainMarkSchema.optional(),
  })
  .strict()
  .superRefine(chainRules);
export type Draft = z.infer<typeof DraftSchema>;

const LevelRecordSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("reading"),
      level: z.number().int().nonnegative(),
      windowTokens: z.number().int().positive(),
      t1: z.number().int().positive(),
      t2: z.number().int().positive(),
      band: z.union([z.literal(0), z.literal(1), z.literal(2)]),
    })
    .strict(),
  z.object({ kind: z.literal("no-reading"), reason: Text }).strict(),
]);

// Main spec 2.2: an observation is {command, value, commit}, so "commit is behind" is machine-decidable.
const MeasurementSchema = z
  .object({ command: Text, exitCode: z.number().int(), commit: Sha, observedAt: z.string().datetime(), outputPath: Text })
  .strict();

export const CheckpointSchema = z
  .object({
    v: z.literal(1),
    runId: z.string().regex(/^orca-dev-[0-9a-f]{8}$/),
    runtime: z.literal("claude-code"),
    sessionRef: Text,
    writtenAt: z.string().datetime(),
    head: Sha,
    level: LevelRecordSchema,
    next: z.array(Text),
    open: z.array(Text),
    awaitingHuman: z.array(Awaiting),
    measurements: z.array(MeasurementSchema),
    chain: ChainMarkSchema.optional(),
  })
  .strict()
  .superRefine(chainRules);
export type Checkpoint = z.infer<typeof CheckpointSchema>;
export type LevelRecord = Checkpoint["level"];

export class CheckpointRejection extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly exitCode = 1,
  ) {
    super(message);
  }
}

export function runIdFor(sessionRef: string): string | null {
  const match = /^([0-9a-f]{8})/.exec(sessionRef);
  return match === null ? null : `orca-dev-${match[1]}`;
}

export function describeLevel(level: LevelRecord): string {
  return level.kind === "reading"
    ? `level ${level.level} of ${level.windowTokens} (T1 ${level.t1}, T2 ${level.t2}, band ${level.band})`
    : `no reading (${level.reason})`;
}

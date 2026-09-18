import { z } from "zod";
import { CHAIN_ID_PATTERN } from "./paths.js";

const NonBlank = z.string().refine((s) => s.trim() !== "", "must not be blank");

/**
 * D-launch spec §2, §5.1-4: ONE schema for `orca chain start` and POST /api/chains. The limits have no defaults.
 * The goal is kept exactly as given — it is the chain's authorization (spec §1 R8).
 */
export const ChainStartSchema = z
  .object({
    repo: NonBlank,
    by: NonBlank,
    goal: NonBlank,
    maxSessions: z.number().int().positive(),
    maxCostUsd: z.number().positive().finite(),
    sessionTimeoutMin: z.number().positive().finite().optional(),
    chainId: z.string().regex(CHAIN_ID_PATTERN).optional(),
    via: z.enum(["cli", "panel"]),
  })
  .strict();
export type ChainStartArgs = z.infer<typeof ChainStartSchema>;

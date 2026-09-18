import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { CHAIN_RECORDS_DIR, CHAIN_STATUSES } from "../checkpoint/schema.js";
import { STOP_CATEGORIES } from "./decide.js";
import { CHAIN_ID_PATTERN, chainRecordRelPath } from "./paths.js";
import { ChainRejection } from "./rejection.js";

const Iso = z.string().datetime();
export const SessionEntrySchema = z
  .object({
    n: z.number().int().positive(),
    sessionRef: z.string().min(1),
    startedAt: Iso,
    endedAt: Iso,
    outcome: z.enum(["exited", "timeout", "launch-failed"]),
    exitCode: z.number().int().nullable(),
    subtype: z.string().nullable(),
    costUsd: z.number().nonnegative().nullable(),
    exitCheckpoint: z.string().nullable(),
    chain: z.object({ status: z.enum(CHAIN_STATUSES), why: z.string().min(1) }).strict().nullable(),
    commits: z.number().int().nonnegative(),
    leftoverProcesses: z.number().int().nonnegative(),
  })
  .strict();

/** D-launch spec §6.1, plus `stop.detail` (plan PC-4). Unreadable or absent values are null, never guessed (Rule 14). */
export const ChainRecordSchema = z
  .object({
    v: z.literal(1),
    chainId: z.string().regex(CHAIN_ID_PATTERN),
    repo: z.string().min(1),
    startedBy: z.object({ via: z.enum(["cli", "panel"]), by: z.string().min(1) }).strict(),
    goal: z.string().min(1),
    limits: z
      .object({ maxSessions: z.number().int().positive(), maxCostUsd: z.number().positive(), sessionTimeoutMin: z.number().positive() })
      .strict(),
    model: z.string().min(1),
    startedAt: Iso,
    startHead: z.string().regex(/^[0-9a-f]{40}$/),
    branch: z.string().min(1),
    supervisorPid: z.number().int().positive(),
    sessions: z.array(SessionEntrySchema),
    state: z.enum(["running", "stopped"]),
    stop: z
      .object({ reason: z.string().min(1), category: z.enum(STOP_CATEGORIES), at: Iso, awaitingHuman: z.array(z.string()), detail: z.string().nullable() })
      .strict()
      .nullable(),
  })
  .strict();
export type ChainRecord = z.infer<typeof ChainRecordSchema>;
export type SessionEntry = z.infer<typeof SessionEntrySchema>;

/** Reads the worktree copy (the supervisor and `unlock` are its only writers, spec §6.1). */
export async function readChainRecord(repo: string, chainId: string): Promise<ChainRecord> {
  const rel = chainRecordRelPath(chainId);
  let text: string;
  try {
    text = await readFile(join(repo, rel), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") throw new ChainRejection("chain-not-found", `no chain record ${rel} in ${repo}`);
    throw err;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new ChainRejection("chain-record-invalid", `${rel} is not JSON: ${(err as Error).message}`);
  }
  const parsed = ChainRecordSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ChainRejection("chain-record-invalid", `${rel}: ${parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`);
  }
  return parsed.data;
}

/** Every record in the repository; one that cannot be read is named in `problems`, never silently dropped. */
export async function listChainRecords(repo: string): Promise<{ records: ChainRecord[]; problems: string[] }> {
  let names: string[];
  try {
    names = (await readdir(join(repo, CHAIN_RECORDS_DIR))).filter((n) => n.endsWith(".json")).sort();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { records: [], problems: [] };
    throw err;
  }
  const records: ChainRecord[] = [];
  const problems: string[] = [];
  for (const name of names) {
    const chainId = name.slice(0, -".json".length);
    try {
      if (!CHAIN_ID_PATTERN.test(chainId)) throw new ChainRejection("chain-record-invalid", `${CHAIN_RECORDS_DIR}/${name} is not named chain-<8 hex>.json`);
      records.push(await readChainRecord(repo, chainId));
    } catch (err) {
      problems.push((err as Error).message);
    }
  }
  return { records, problems };
}

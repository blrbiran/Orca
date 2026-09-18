import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { CHAIN_RECORDS_DIR } from "../checkpoint/schema.js";
import { chainGit as git } from "./git.js";

/** D-launch spec §2 (review I10): the only shape a chain id may have — it becomes part of paths. */
export const CHAIN_ID_PATTERN = /^chain-[0-9a-f]{8}$/;
export const CHAIN_LOGS_DIR = ".orca/chain-logs";

export const newChainId = (): string => `chain-${randomBytes(4).toString("hex")}`;
export const chainRecordRelPath = (chainId: string): string => `${CHAIN_RECORDS_DIR}/${chainId}.json`;
export const chainLogDir = (repo: string, chainId: string): string => join(repo, CHAIN_LOGS_DIR, chainId);

/**
 * Plan PC-1: spec §2 puts the lock and stop requests under `.git/orca-chain/`. In a linked worktree `.git` is a file,
 * so this is the worktree's own git dir (`git rev-parse --absolute-git-dir`) — `.git` itself in an ordinary checkout.
 * Either way outside the worktree, where a session's cleanup cannot reach it.
 */
export async function chainStateDir(repo: string): Promise<string> {
  return join((await git(repo, ["rev-parse", "--absolute-git-dir"])).trim(), "orca-chain");
}
export const chainLockDir = async (repo: string): Promise<string> => join(await chainStateDir(repo), "lock");
export const stopRequestPath = async (repo: string, chainId: string): Promise<string> => join(await chainStateDir(repo), chainId, "stop");
